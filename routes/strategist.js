/**
 * routes/strategist.js
 *
 * AI Content Strategist — the orchestration spine.
 *
 * Two endpoints, both gated by the same shared secret as /api/generate and
 * /api/outline (header x-generate-secret, env GENERATE_SECRET):
 *
 *   POST /api/strategist/preview
 *     Cheap, no charge, no AI, no SERP. Resolves the tier palette, expands the
 *     cadence into concrete dates, and returns the item count + credit cost.
 *     This is what powers the "≈ 13 posts · 3 credits" line BEFORE the user
 *     commits.
 *
 *   POST /api/strategist/plan
 *     The real run. Gate + charge credits (mirrors /api/generate's
 *     deduct-first / refund-on-failure pattern), fan out SERP research per seed
 *     keyword (reuses lib/serp), pull time-bound events (lib/serp-events), run
 *     ONE structured Claude planning pass, then return a reviewable plan.
 *     NOTHING is written to the Content Diary here — the diary lives in
 *     WordPress and the plugin writes the approved items after the human review
 *     gate. This route only proposes.
 *
 * DESIGN NOTES THAT MATTER:
 *   • Dates are computed HERE, deterministically, from the cadence primitives —
 *     never invented by the model. The planner fills each pre-assigned slot with
 *     a topic; we stitch our authoritative date back in afterwards. This keeps
 *     the cost preview honest and stops the AI drifting dates.
 *   • The palette reuses content-types.js as the single source of truth
 *     (canAccessContentType + per-type credits). No second gating table.
 *   • Heavy SERP grounding is NOT persisted onto the plan — generate.js
 *     re-fetches it live at generation time, fresher. The plan carries only the
 *     cheap, durable, decision-useful metadata.
 *
 * Env: ANTHROPIC_API_KEY, GENERATE_SECRET, DATABASE_URL,
 *      SERP_API_KEY (optional), SERP_DEFAULT_GL (optional, default 'us').
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const { CONTENT_TYPES, canAccessContentType } = require('../content-types');
const serp        = require('../lib/serp');
const serpEvents  = require('../lib/serp-events');
const creditsCache = require('../lib/credits-cache');
const creditLedger = require('../lib/credit-ledger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─── tunables (the decisions Ibbz signed off) ───────────────────────────────
const TIER_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };

// Timespan ceiling per tier, in months (spec §7, real tier names).
const TIMESPAN_CEILING_MONTHS = { free: 1, starter: 3, pro: 12, agency: 12 };

// The 7 web-facing, keyword-led types a site owner would deliberately calendar.
// Everything else (About Us, WooCommerce, newsletters, L&D set, etc.) is excluded
// per spec §5. Tier gating + credit cost come from content-types.js, not here.
const STRATEGIST_TYPES = [
  'blog_post', 'tutorial', 'explainer_guide', 'faq_page',   // informational
  'service_page', 'landing_page', 'review_comparison',      // commercial
];
const INTENT = {
  blog_post: 'informational', tutorial: 'informational',
  explainer_guide: 'informational', faq_page: 'informational',
  service_page: 'commercial', landing_page: 'commercial', review_comparison: 'commercial',
};

const MAX_ITEMS         = 40;   // hard cap — daily-for-3-months would be ~90; brutal to review + spend
const INFO_RATIO        = 0.8;  // 80/20 informational:commercial auto-mix default
const PLAN_COST_DIVISOR = 5;    // cost = clamp(ceil(items / 5), 1, 10)
const PLAN_COST_FLOOR   = 1;
const PLAN_COST_CEIL    = 10;   // also the deduct route's hard cap; keeps the charge in one batch
const RESEARCH_TTL_MS   = 6 * 60 * 60 * 1000; // cache SERP grounding per keyword for 6h (spec §11)
const MAX_SEED_KEYWORDS = 12;

// ─── helpers: secret gate, JSON parse, Claude call (mirror outline.js) ───────
function unauthorised(req) {
  const secret = process.env.GENERATE_SECRET;
  return secret && req.headers['x-generate-secret'] !== secret;
}

function parseJsonLoose(text) {
  let t = String(text || '').trim().replace(/```json\s*|\s*```/g, '');
  const start = t.indexOf('{');
  const end   = t.lastIndexOf('}');
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function callClaude(prompt, maxTokens = 8000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const txt = data?.content?.map(b => b.text || '').join('');
  if (!txt) throw new Error('Empty response from Anthropic API');
  return txt;
}

// ─── tier + palette ──────────────────────────────────────────────────────────
function normaliseTier(raw) {
  const t = String(raw || '').toLowerCase().trim();
  return TIER_RANK[t] !== undefined ? t : 'free';
}

/**
 * Allowed palette = the 7 Strategist types the user's tier can access, optionally
 * narrowed to the types the user asked to include. Reuses canAccessContentType so
 * content-types.js stays the single source of truth for gating + credits.
 */
function resolvePalette(tier, requestedTypes) {
  let allowed = STRATEGIST_TYPES.filter(t => canAccessContentType(t, tier));
  if (Array.isArray(requestedTypes) && requestedTypes.length) {
    const want = new Set(requestedTypes);
    const narrowed = allowed.filter(t => want.has(t));
    if (narrowed.length) allowed = narrowed; // ignore an empty/garbage narrowing
  }
  return allowed.map(t => ({
    type: t,
    intent: INTENT[t],
    credits: CONTENT_TYPES[t]?.credits ?? 2,
    label: CONTENT_TYPES[t]?.label || CONTENT_TYPES[t]?.name || t,
  }));
}

// ─── cadence → concrete dates (pure, deterministic, drives the cost preview) ──
// cadence: { mode:'interval'|'weekday', interval_days, weekdays:[0..6], week_stride }
//   interval : every N days from the start.
//   weekday  : these weekdays (0=Sun..6=Sat), every `week_stride` weeks.
// Every preset the UI offers (daily, every N days, twice/3x a week, weekly,
// fortnightly, weekends) collapses into one of these two primitives.
function iso(d) { return d.toISOString().slice(0, 10); }
function tomorrowUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function addMonthsUTC(d, n) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}
function clampTimespan(months, tier) {
  const ceil = TIMESPAN_CEILING_MONTHS[tier] ?? 1;
  const m = parseInt(months, 10) || 1;
  return Math.min(Math.max(1, m), ceil);
}

function expandCadence(cadence = {}, timespanMonths, startDate) {
  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : tomorrowUTC();
  if (isNaN(start)) return [];
  const end = addMonthsUTC(start, timespanMonths);
  const dates = [];

  if (cadence.mode === 'interval') {
    const step = Math.max(1, parseInt(cadence.interval_days, 10) || 7);
    for (let d = new Date(start); d < end && dates.length < MAX_ITEMS; d.setUTCDate(d.getUTCDate() + step)) {
      dates.push(iso(d));
    }
  } else {
    // weekday mode
    const wds = (Array.isArray(cadence.weekdays) && cadence.weekdays.length ? cadence.weekdays : [1])
      .map(n => ((parseInt(n, 10) % 7) + 7) % 7);
    const stride = Math.max(1, parseInt(cadence.week_stride, 10) || 1);
    // Anchor to the Monday of the start's week so strides are stable week-to-week.
    const weekStart = new Date(start);
    const dow = weekStart.getUTCDay();              // 0=Sun..6=Sat
    const backToMon = (dow + 6) % 7;                // days since Monday
    weekStart.setUTCDate(weekStart.getUTCDate() - backToMon);
    while (weekStart < end && dates.length < MAX_ITEMS) {
      for (const wd of wds) {
        const day = new Date(weekStart);
        const offset = (wd + 6) % 7;                // Monday-based offset within the week
        day.setUTCDate(day.getUTCDate() + offset);
        if (day >= start && day < end && dates.length < MAX_ITEMS) dates.push(iso(day));
      }
      weekStart.setUTCDate(weekStart.getUTCDate() + 7 * stride);
    }
  }

  // unique + sorted + capped
  return [...new Set(dates)].sort().slice(0, MAX_ITEMS);
}

function planCost(itemCount) {
  return Math.min(PLAN_COST_CEIL, Math.max(PLAN_COST_FLOOR, Math.ceil(itemCount / PLAN_COST_DIVISOR)));
}

// ─── dedupe helpers ───────────────────────────────────────────────────────────
function normaliseKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ─── research (reuses lib/serp + lib/serp-events), cached per keyword ────────
const researchCache = new Map(); // normalisedKeyword -> { expires, grounding }

async function groundKeyword(kw, gl) {
  const key = `${normaliseKey(kw)}|${gl}`;
  const hit = researchCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.grounding;
  let grounding = null;
  if (serp.enabled()) {
    grounding = await serp.getSerpGrounding(kw, { gl }).catch(() => null);
  }
  researchCache.set(key, { expires: Date.now() + RESEARCH_TTL_MS, grounding });
  return grounding;
}

async function runResearch(seeds, gl, industry, location, windowStart, windowEnd) {
  const grounded = {};
  // Sequential keeps us gentle on Serper + the competitor page fetches; the list
  // is capped at MAX_SEED_KEYWORDS so worst case is bounded.
  for (const kw of seeds) {
    grounded[kw] = await groundKeyword(kw, gl);
  }
  const events = await serpEvents.getTimeboundEvents(industry, location, windowStart, windowEnd)
    .catch(() => []);
  return { grounded, events };
}

// ─── planning prompt ──────────────────────────────────────────────────────────
function buildPlanningPrompt({ business, palette, seeds, grounded, events, slots, exclude }) {
  const paletteLines = palette
    .map(p => `  - ${p.type} (${p.intent}, ${p.credits} credits): ${p.label}`)
    .join('\n');

  const groundingLines = seeds.map(kw => {
    const g = grounded[kw];
    if (!g) return `- "${kw}": no live search data (use best-practice judgement).`;
    const parts = [];
    if (g.commonTopics?.length)    parts.push(`competitors cover: ${g.commonTopics.slice(0, 8).join('; ')}`);
    if (g.peopleAlsoAsk?.length)   parts.push(`people also ask: ${g.peopleAlsoAsk.slice(0, 6).join(' | ')}`);
    if (g.relatedSearches?.length) parts.push(`related searches: ${g.relatedSearches.slice(0, 6).join('; ')}`);
    return `- "${kw}": ${parts.join('  ||  ') || 'thin data.'}`;
  }).join('\n');

  const eventLines = events.length
    ? events.map(e => `  - ${e.name}${e.date ? ` (around ${e.date}, UNVERIFIED)` : ' (date unknown)'}`).join('\n')
    : '  (none found — do not invent events.)';

  const slotLines = slots.map(s => `  ${s.i}: ${s.date}`).join('\n');

  const excludeTitles = (exclude.titles || []).slice(0, 200).map(normaliseKey).filter(Boolean);
  const excludeKw     = (exclude.focus_keywords || []).slice(0, 200).map(normaliseKey).filter(Boolean);
  const excludeBlock = (excludeTitles.length || excludeKw.length)
    ? `\nDO NOT propose anything matching these already-covered topics (the user already has them):\nTitles: ${excludeTitles.join(' | ') || '(none)'}\nKeywords: ${excludeKw.join(' | ') || '(none)'}\n`
    : '';

  const infoPct = Math.round(INFO_RATIO * 100);

  return `You are an expert SEO content strategist building a publishing calendar for a specific business.

BUSINESS
  What it does/sells: ${business.what || '(not given)'}
  Industry/sector:    ${business.industry || '(not given)'}
  Location:           ${business.location || '(not given)'}

SEED KEYWORDS the owner cares about:
${seeds.map(s => `  - ${s}`).join('\n')}

LIVE SEARCH RESEARCH (per seed — use to find real topics, sub-topics and the gaps competitors miss; do NOT copy competitor wording):
${groundingLines}

UPCOMING INDUSTRY EVENTS in the window (dates UNVERIFIED — only anchor a post if a slot date falls roughly 1–2 weeks BEFORE the event; never invent events or dates):
${eventLines}

ALLOWED CONTENT TYPES (use ONLY these — they are gated to the user's plan):
${paletteLines}
${excludeBlock}
TASK
  Build a topic-cluster content plan using the pillar-and-cluster model: grow the
  seed keywords into clusters, and fill EACH dated slot below with exactly one
  planned post. Aim for roughly ${infoPct}% informational (traffic-building) and
  ${100 - infoPct}% commercial (converting), within the allowed types. Give each
  post a single focus keyphrase plus a few secondary keywords. Vary the content
  type sensibly across the plan. If a slot date sits ~1–2 weeks before a listed
  event, you MAY make that post an event preview and set event_anchor.

  There are ${slots.length} slots:
${slotLines}

OUTPUT
  Return ONLY valid JSON, no commentary, no markdown fences, in EXACTLY this shape.
  "items" MUST have exactly ${slots.length} entries, one per slot, in slot order
  (item[0] is slot 0, etc.). Do NOT include dates — the system assigns them.

{
  "items": [
    {
      "title": "compelling, specific post title (<= 65 chars, no clickbait)",
      "focus_keyphrase": "the single primary keyword for this post",
      "secondary_keywords": ["2-4 supporting terms"],
      "content_type": "one of the allowed type ids above",
      "cluster": "the pillar topic this post rolls up to",
      "content_gap": "one angle/insight competitors miss that this post should own",
      "rationale": "one short line: why this post earns a slot",
      "event_anchor": null
    }
  ]
}

  For an event-anchored post set:
    "event_anchor": { "name": "the event", "date": "YYYY-MM-DD or null", "unverified": true }`;
}

// ─── normalise + validate a returned item against the palette ────────────────
function sanitiseItem(raw, palette, slotDate) {
  const allowedTypes = new Set(palette.map(p => p.type));
  const fallbackInfo = palette.find(p => p.intent === 'informational')?.type || palette[0]?.type || 'blog_post';

  let type = String(raw?.content_type || '').trim();
  if (!allowedTypes.has(type)) type = fallbackInfo; // coerce anything off-palette
  const focus = String(raw?.focus_keyphrase || raw?.title || '').trim();
  const title = String(raw?.title || focus || 'Untitled').trim().slice(0, 120);

  const secondary = Array.isArray(raw?.secondary_keywords)
    ? raw.secondary_keywords.map(s => String(s).trim()).filter(Boolean).slice(0, 5)
    : [];

  const contentGap = String(raw?.content_gap || '').trim();
  const rationale  = String(raw?.rationale || '').trim();
  const intent     = INTENT[type] || 'informational';

  let eventAnchor = null;
  if (raw?.event_anchor && typeof raw.event_anchor === 'object' && raw.event_anchor.name) {
    eventAnchor = {
      name: String(raw.event_anchor.name).trim(),
      date: raw.event_anchor.date ? String(raw.event_anchor.date).trim() : null,
      unverified: true, // always — we never trust a scraped/derived event date
    };
  }

  // Bucket B — the human-readable steer the writer actually reads (special_instructions
  // IS injected into the generate prompt). Composed here so the plugin can drop it
  // straight onto the diary entry.
  const siParts = [];
  if (secondary.length) siParts.push(`Work in these secondary keywords naturally where they fit: ${secondary.join(', ')}.`);
  if (contentGap)        siParts.push(`Angle to own (competitors miss this): ${contentGap}`);
  if (eventAnchor)       siParts.push(`This is a preview ahead of "${eventAnchor.name}"${eventAnchor.date ? ` (~${eventAnchor.date}, confirm the date)` : ''} — frame it as upcoming and give readers a reason to plan around it.`);
  const specialInstructions = siParts.join('\n');

  const credits = CONTENT_TYPES[type]?.credits ?? 2;

  return {
    title,
    focus_keyphrase: focus,
    primary_keyword: focus,      // convenience: maps to the diary entry field
    seo_focus_keyword: focus,    // convenience: feeds the SEO pipeline on publish
    content_type: type,
    intent,
    cluster: String(raw?.cluster || '').trim(),
    secondary_keywords: secondary,
    content_gap: contentGap,
    rationale,
    event_anchor: eventAnchor,
    suggested_date: slotDate,    // AUTHORITATIVE — our date, not the model's
    credits,                     // per-post GENERATION cost (for grid totals)
    special_instructions: specialInstructions,             // Bucket B
    content_type_meta: {                                   // Bucket C (review + future use)
      strategist: {
        intent, cluster: String(raw?.cluster || '').trim(),
        content_gap: contentGap, rationale, event_anchor: eventAnchor,
        planned_at: new Date().toISOString(),
      },
    },
  };
}

// Drop items that duplicate the exclude list or each other (normalised title or focus kw).
function dedupePlan(items, exclude) {
  const seenTitle = new Set((exclude.titles || []).map(normaliseKey).filter(Boolean));
  const seenKw    = new Set((exclude.focus_keywords || []).map(normaliseKey).filter(Boolean));
  const out = [];
  for (const it of items) {
    const tk = normaliseKey(it.title);
    const kk = normaliseKey(it.focus_keyphrase);
    if ((tk && seenTitle.has(tk)) || (kk && seenKw.has(kk))) continue;
    if (tk) seenTitle.add(tk);
    if (kk) seenKw.add(kk);
    out.push(it);
  }
  return out;
}

// ─── credit gate + deduct (mirrors generate.js: deduct-first, refund-on-fail) ─
async function gateAndDeduct(client, licenseKey, cost) {
  await client.query('BEGIN');

  // Gate on the SUM across active non-expired batches (same as generate.js).
  const lic = await client.query(`
    SELECT lk.id, lk.tier, lk.status,
           COALESCE(SUM(cb.credits_remaining) FILTER (WHERE cb.expiry_date > CURRENT_DATE), 0) AS credits_remaining
    FROM license_keys lk
    LEFT JOIN credit_batches cb ON cb.license_key_id = lk.id
    WHERE lk.license_key = $1
    GROUP BY lk.id, lk.tier, lk.status
  `, [licenseKey]);

  if (lic.rows.length === 0 || lic.rows[0].status !== 'active') {
    await client.query('ROLLBACK');
    return { ok: false, code: 403, error: 'License not active' };
  }
  const row = lic.rows[0];
  if (parseInt(row.credits_remaining, 10) < cost) {
    await client.query('ROLLBACK');
    return { ok: false, code: 402, error: 'Insufficient credits', credits_remaining: parseInt(row.credits_remaining, 10) };
  }

  // Deduct across batches in expiry order via the shared ledger. The gate above
  // already proved the SUM is enough, so this only fails on a rare concurrent
  // race (credits spent between the SUM read and the locked deduct) — surfaced as
  // a clean 402, never an over-spend.
  const ded = await creditLedger.deductSpanning(client, licenseKey, cost);
  if (!ded.success) {
    await client.query('ROLLBACK');
    return { ok: false, code: 402, error: 'Insufficient credits', credits_remaining: parseInt(row.credits_remaining, 10) };
  }

  return { ok: true, licenseId: row.id, tier: normaliseTier(row.tier), allocations: ded.allocations };
}

// ─── shared input parsing ─────────────────────────────────────────────────────
function parsePlanInputs(body) {
  const b = body || {};
  const business = {
    what: String(b.business_context?.what || '').trim(),
    industry: String(b.business_context?.industry || '').trim(),
    location: String(b.business_context?.location || '').trim(),
  };
  const seeds = [...new Set(
    (Array.isArray(b.seed_keywords) ? b.seed_keywords : [])
      .map(s => String(s || '').trim()).filter(Boolean)
  )].slice(0, MAX_SEED_KEYWORDS);

  const params = b.params || {};
  const tier = normaliseTier(b.tier); // resolved authoritatively from DB later; this is a hint only
  const exclude = {
    titles: Array.isArray(b.exclude?.titles) ? b.exclude.titles : [],
    focus_keywords: Array.isArray(b.exclude?.focus_keywords) ? b.exclude.focus_keywords : [],
  };
  return { business, seeds, params, tier, exclude, license_key: b.license_key, serp_gl: b.serp_gl };
}

// ═══ POST /api/strategist/preview ════════════════════════════════════════════
// No charge, no AI, no SERP. Resolves palette + dates + cost for the commit screen.
router.post('/preview', async (req, res) => {
  if (unauthorised(req)) return res.status(401).json({ success: false, error: 'Unauthorised' });

  try {
    const { params, license_key } = parsePlanInputs(req.body);

    // Resolve tier from the DB (don't trust a client-sent tier).
    let tier = 'free';
    if (license_key) {
      const r = await pool.query(`SELECT tier FROM license_keys WHERE license_key = $1 AND status = 'active' LIMIT 1`, [license_key]);
      if (r.rows.length) tier = normaliseTier(r.rows[0].tier);
    }

    const timespan = clampTimespan(params.timespan_months, tier);
    const dates = expandCadence(params.cadence, timespan, params.start_date);
    // Always return the FULL tier palette for the picker. Narrowing by the user's
    // selection is a plan-time concern and has no effect on the cost or post count,
    // so it must not shrink the list of choices shown to them.
    const palette = resolvePalette(tier, []);
    const cost = planCost(dates.length);

    const requested = parseInt(params.timespan_months, 10) || timespan;
    const capped = dates.length >= MAX_ITEMS || requested > timespan;

    return res.json({
      success: true,
      tier,
      item_count: dates.length,
      credits_cost: cost,
      timespan_months: timespan,
      timespan_ceiling: TIMESPAN_CEILING_MONTHS[tier],
      palette,
      capped,
      capped_reason: capped
        ? (requested > timespan
            ? `Your plan allows up to ${TIMESPAN_CEILING_MONTHS[tier]} month(s); timespan trimmed to fit.`
            : `That cadence would exceed ${MAX_ITEMS} posts — capped at ${MAX_ITEMS}. Shorten the span or ease the cadence.`)
        : null,
    });
  } catch (err) {
    console.error('[strategist/preview] failed:', err.message);
    return res.status(500).json({ success: false, error: 'Preview failed' });
  }
});

// ═══ POST /api/strategist/plan ═══════════════════════════════════════════════
router.post('/plan', async (req, res) => {
  if (unauthorised(req)) return res.status(401).json({ success: false, error: 'Unauthorised' });

  const { business, seeds, params, exclude, license_key, serp_gl } = parsePlanInputs(req.body);

  // ── validation gate (before any charge) ──
  if (!license_key) return res.status(400).json({ success: false, error: 'license_key is required' });
  if (!business.location) return res.status(400).json({ success: false, error: 'Business location is required before the first plan run.' });
  if (seeds.length === 0) return res.status(400).json({ success: false, error: 'At least one seed keyword is required.' });

  const client = await pool.connect();
  let charged = null; // { allocations } once we deduct

  try {
    // Resolve tier + compute the slot dates + cost up front (all pure / cheap).
    const lkRow = await client.query(`SELECT tier FROM license_keys WHERE license_key = $1 AND status = 'active' LIMIT 1`, [license_key]);
    if (lkRow.rows.length === 0) {
      client.release();
      return res.status(403).json({ success: false, error: 'License not active' });
    }
    const tier = normaliseTier(lkRow.rows[0].tier);
    const timespan = clampTimespan(params.timespan_months, tier);
    const dates = expandCadence(params.cadence, timespan, params.start_date);
    if (dates.length === 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'That cadence produced no dates — check the cadence and timespan.' });
    }
    const palette = resolvePalette(tier, params.content_types);
    if (palette.length === 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'No content types are available on this plan.' });
    }
    const cost = planCost(dates.length);

    // ── charge first (mirror generate.js) ──
    const gate = await gateAndDeduct(client, license_key, cost);
    if (!gate.ok) {
      await client.query('ROLLBACK').catch(() => {});
      // Log the (failed) attempt? No — nothing was deducted. Just report.
      const payload = { success: false, error: gate.error };
      if (gate.credits_remaining !== undefined) payload.credits_remaining = gate.credits_remaining;
      return res.status(gate.code).json(payload);
    }

    // Record the plan-run charge in usage_logs, then commit + invalidate cache.
    await client.query(`
      INSERT INTO usage_logs (license_key_id, domain, post_title, content_type, credits_used, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [gate.licenseId, business.location || 'strategist', `Content plan (${dates.length} posts)`, 'strategist_plan', cost]);
    await client.query('COMMIT');
    creditsCache.invalidate(license_key);
    charged = { allocations: gate.allocations };

    // ── the work (research + planning). Any throw here triggers a refund. ──
    const gl = serp_gl || process.env.SERP_DEFAULT_GL || 'us';
    const windowStart = dates[0];
    const windowEnd   = dates[dates.length - 1];
    const { grounded, events } = await runResearch(seeds, gl, business.industry, business.location, windowStart, windowEnd);

    const slots = dates.map((date, i) => ({ i, date }));
    const prompt = buildPlanningPrompt({ business, palette, seeds, grounded, events, slots, exclude });

    let parsed;
    try {
      parsed = parseJsonLoose(await callClaude(prompt));
    } catch (e) {
      console.warn('[strategist/plan] planning parse failed:', e.message);
      if (charged) await creditLedger.refundSpanning(pool, charged.allocations);
      creditsCache.invalidate(license_key);
      return res.status(502).json({ success: false, error: 'Could not build the plan. Your credits were not charged — please retry.' });
    }

    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    if (rawItems.length === 0) {
      if (charged) await creditLedger.refundSpanning(pool, charged.allocations);
      creditsCache.invalidate(license_key);
      return res.status(502).json({ success: false, error: 'The plan came back empty. Your credits were not charged — please retry.' });
    }

    // Stitch our authoritative dates back in (item i -> slot i), sanitise, dedupe.
    let items = rawItems
      .slice(0, slots.length)
      .map((raw, i) => sanitiseItem(raw, palette, slots[i].date));
    items = dedupePlan(items, exclude);

    const infoCount = items.filter(i => i.intent === 'informational').length;

    return res.json({
      success: true,
      grounded: serp.enabled() && Object.values(grounded).some(Boolean),
      plan: {
        items,
        summary: {
          item_count: items.length,
          requested_slots: slots.length,
          credits_charged: cost,                 // the plan-run fee (already taken)
          generation_credits_total: items.reduce((n, it) => n + it.credits, 0), // if ALL are later generated
          informational: infoCount,
          commercial: items.length - infoCount,
          timespan_months: timespan,
          tier,
          events_found: events.length,
        },
      },
    });
  } catch (err) {
    console.error('[strategist/plan] failed:', err.message);
    // We may have committed the charge before the throw — refund it.
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (charged) { await creditLedger.refundSpanning(pool, charged.allocations); creditsCache.invalidate(license_key); }
    return res.status(500).json({ success: false, error: 'Plan generation failed. Any charge has been refunded — please retry.' });
  } finally {
    client.release();
  }
});

module.exports = router;

// Mount in server.js alongside the others:
//   app.use('/api/strategist', require('./routes/strategist'));
// (Optionally rate-limit /api/strategist/plan like /api/generate.)
