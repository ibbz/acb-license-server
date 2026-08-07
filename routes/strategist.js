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
const { fetchWithRetry } = require('../lib/http-retry');
const costLog      = require('../lib/cost-log');

const TEXT_MODEL = 'claude-sonnet-4-6'; // must have a matching entry in lib/pricing.js

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─── tunables (the decisions Ibbz signed off) ───────────────────────────────
const TIER_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };

// Timespan ceiling per tier, in months (spec §7, real tier names).
// ACB_STRATEGIST_PRO_CEILING_6_2026_07_19: pro dropped 12 → 6 for a clean
// 1 → 3 → 6 → 12 upgrade ladder (Agency keeps the 12-month exclusive).
const TIMESPAN_CEILING_MONTHS = { free: 1, starter: 3, pro: 6, agency: 12 };

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
  // Bounded retry on transient network faults and 429/5xx/529. This is the one
  // route besides /api/generate that consumes credits, so it gets the same
  // generous budget as generation: a plan run destroyed by a sub-second DNS
  // blip loses real money, not just a retry-able page view. Plans can run to
  // 16k tokens (token-scaling patch), hence the generation-scale timeout.
  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      max_tokens: maxTokens,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, {
    label:         'strategist:anthropic',
    attempts:      3,
    timeoutMs:     300000,  // 5 min/attempt — 16k-token plans are the ceiling
    totalBudgetMs: 540000,  // 9 min total, mirroring routes/generate.js
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const txt = data?.content?.map(b => b.text || '').join('');
  if (!txt) throw new Error('Empty response from Anthropic API');
  // usage/stop_reason returned for cost instrumentation (lib/cost-log.js).
  return { text: txt, usage: data?.usage || null, stop_reason: data?.stop_reason || null };
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

async function groundKeyword(kw, gl, tally) {
  const key = `${normaliseKey(kw)}|${gl}`;
  const hit = researchCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.grounding; // cache hit — no Serper spend
  let grounding = null;
  if (serp.enabled()) {
    if (tally) tally.serpCalls += 1; // billed on attempt, cache misses only
    grounding = await serp.getSerpGrounding(kw, { gl }).catch(() => null);
  }
  researchCache.set(key, { expires: Date.now() + RESEARCH_TTL_MS, grounding });
  return grounding;
}

async function runResearch(seeds, gl, industry, location, windowStart, windowEnd, tally) {
  const grounded = {};
  // Sequential keeps us gentle on Serper + the competitor page fetches; the list
  // is capped at MAX_SEED_KEYWORDS so worst case is bounded.
  for (const kw of seeds) {
    grounded[kw] = await groundKeyword(kw, gl, tally);
  }
  // Cost note: lib/serp-events runs up to 2 search queries + 1 news query per
  // sweep. Counted as 3 when enabled — a deliberate upper bound (early-exit on
  // MAX_EVENTS can make it fewer). At $0.001/search the imprecision is < 0.3¢.
  if (tally && serpEvents.enabled()) tally.serpCalls += 3;
  const events = await serpEvents.getTimeboundEvents(industry, location, windowStart, windowEnd)
    .catch(() => []);
  return { grounded, events };
}

// ─── planning prompt ──────────────────────────────────────────────────────────
function buildPlanningPrompt({ business, palette, seeds, researchSeeds, grounded, events, slots, exclude, pillar }) {
  // AICOBR_CLUSTER_SEEDLESS_2026_08 — grounding is keyed by researchSeeds (which
  // falls back to the pillar title), NOT the user's seeds. Mapping over `seeds`
  // here would silently drop every SERP result when planning a cluster with no
  // keywords entered — research paid for and thrown away.
  const gSeeds = (researchSeeds && researchSeeds.length) ? researchSeeds : seeds;
  const paletteLines = palette
    .map(p => `  - ${p.type} (${p.intent}, ${p.credits} credits): ${p.label}`)
    .join('\n');

  const groundingLines = gSeeds.map(kw => {
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
  // AICOBR_CLUSTER_INTENT_DEDUPE_2026_08
  // String dedupe (excludeBlock below, plus dedupePlan afterwards) catches exact
  // repeats. It cannot catch "boiler service pricing explained" proposed when
  // "how much does a boiler service cost" already exists — different words, one
  // search intent, two pages that cannibalise each other rather than adding
  // coverage. Judging intent equivalence is something the model is good at; it
  // just has to be asked. Only same-pillar spokes are listed: overlap matters
  // within a cluster, and dumping the whole site in would bloat every request.
  const siblings = Array.isArray(exclude.cluster_siblings) ? exclude.cluster_siblings.slice(0, 60) : [];
  const siblingBlock = siblings.length ? `
THIS PILLAR ALREADY HAS THESE SUPPORTING PAGES:
${siblings.map(sb => `  - ${String(sb.title || '').trim()}${sb.keyword ? `  [targets: ${String(sb.keyword).trim()}]` : ''}`).join('\n')}

Do not propose a post that serves the SAME SEARCH INTENT as any of the above,
even if worded differently. Two pages answering one question compete with each
other and both rank worse than a single page would.

  SAME intent (reject): "how much does a boiler service cost" vs "boiler
    servicing prices" vs "cost of a commercial boiler service" — one question.
  DIFFERENT intent (fine): "how much does a boiler service cost" vs "what
    happens during a boiler service" vs "is a boiler service worth it" —
    a price, a process and a judgement are three different questions.

Your job on this run is to fill the GAPS around what already exists: the
questions a visitor would still have after reading those pages. If you cannot
find enough genuinely distinct angles to fill every slot, return FEWER items
rather than padding with near-duplicates.
` : '';

  const excludeBlock = (excludeTitles.length || excludeKw.length)
    ? `\nDO NOT propose anything matching these already-covered topics (the user already has them):\nTitles: ${excludeTitles.join(' | ') || '(none)'}\nKeywords: ${excludeKw.join(' | ') || '(none)'}\n`
    : '';

  const infoPct = Math.round(INFO_RATIO * 100);

  // AICOBR_CLUSTER_PILLAR_2026_08
  // When the user picked an existing page, every planned post becomes a SPOKE
  // supporting it. This is the differentiating half of the feature: the plan is
  // no longer "posts about your keywords", it's "the pages this page is missing".
  // The page's own copy is included so the model can plan around what it ALREADY
  // says rather than duplicating it — the gap is the value.
  const pillarBlock = pillar ? `
PILLAR PAGE — this plan builds a supporting cluster UNDERNEATH an existing page
  Title: ${pillar.title}
  URL:   ${pillar.url}
${pillar.excerpt ? `  What that page already covers:\n    ${pillar.excerpt.slice(0, 1200).replace(/\n+/g, ' ')}` : '  (page copy unavailable — plan from the title and the business context)'}
` : '';

  const pillarTask = pillar ? `
  EVERY post in this plan is a SPOKE supporting the pillar page above. That means:
    - Each post must target a DISTINCT, more specific search than the pillar itself.
      Do not propose a post that competes with or restates the pillar page.
    - Prefer the questions a visitor to that page would still have afterwards:
      how-to, comparison, cost/pricing, problem-diagnosis, examples, objections.
    - Do NOT duplicate what the pillar page already covers (see its copy above) —
      go a level deeper, or sideways into an adjacent question it doesn't answer.
    - Set "cluster" to exactly "${pillar.title}" for every item.
  Each spoke will automatically link up to the pillar page when it is generated,
  so plan them as a coherent set that collectively supports that one page.
` : '';

  return `You are an expert SEO content strategist building a publishing calendar for a specific business.

BUSINESS
  What it does/sells: ${business.what || '(not given)'}
  Industry/sector:    ${business.industry || '(not given)'}
  Location:           ${business.location || '(not given)'}
${pillarBlock}
${seeds.length
  ? `SEED KEYWORDS the owner cares about:\n${seeds.map(s => `  - ${s}`).join('\n')}`
  : `SEED KEYWORDS: none given. The owner chose the pillar page above and asked you to work out what
it needs. Derive the topics from that page's subject and its copy — do not invent an unrelated theme,
and do not propose a post that simply restates the pillar page itself.`}

LIVE SEARCH RESEARCH (per seed — use to find real topics, sub-topics and the gaps competitors miss; do NOT copy competitor wording):
${groundingLines}

UPCOMING INDUSTRY EVENTS in the window (dates UNVERIFIED — only anchor a post if a slot date falls roughly 1–2 weeks BEFORE the event; never invent events or dates):
${eventLines}

ALLOWED CONTENT TYPES (use ONLY these — they are gated to the user's plan):
${paletteLines}
${excludeBlock}${siblingBlock}
TASK
  Build a topic-cluster content plan using the pillar-and-cluster model: grow the
  seed keywords into clusters, and fill EACH dated slot below with exactly one
  planned post. Aim for roughly ${infoPct}% informational (traffic-building) and
  ${100 - infoPct}% commercial (converting), within the allowed types. Give each
  post a single focus keyphrase plus a few secondary keywords. Vary the content
  type sensibly across the plan. If a slot date sits ~1–2 weeks before a listed
  event, you MAY make that post an event preview and set event_anchor.
${pillarTask}
  ORDERING: keep each cluster CONTIGUOUS — finish every post in one cluster before
  starting the next. Do not interleave clusters across the calendar. A cluster that
  completes sooner starts working sooner. Cluster order is a hard constraint; event
  anchoring is opportunistic and yields to it (skip the anchor if no slot fits).

  There are ${slots.length} slots:
${slotLines}

OUTPUT
  Return ONLY valid JSON, no commentary, no markdown fences, in EXACTLY this shape.
  "items" MUST have exactly ${slots.length} entries, one per slot, in slot order${siblings.length ? `
  (The ONE exception: the same-intent rule above wins. If there are not enough
   genuinely distinct angles left for this pillar, return fewer items — filling
   slots with near-duplicates is worse than a shorter plan.)` : ''}
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
function sanitiseItem(raw, palette, slotDate, pillar = null) {
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

  // AICOBR_CLUSTER_PILLAR_2026_08
  // When a pillar page was chosen, the cluster name is OURS, not the model's.
  // The prompt asks it to echo the pillar title, but models paraphrase — and a
  // paraphrased cluster name means the same cluster planned twice produces two
  // different groups. Forcing it here keeps cluster identity stable and makes
  // the grouped review view reliable.
  const cluster = pillar
    ? pillar.title
    : String(raw?.cluster || '').trim();

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
    cluster,
    secondary_keywords: secondary,
    content_gap: contentGap,
    rationale,
    event_anchor: eventAnchor,
    suggested_date: slotDate,    // AUTHORITATIVE — our date, not the model's
    credits,                     // per-post GENERATION cost (for grid totals)
    special_instructions: specialInstructions,             // Bucket B
    content_type_meta: {                                   // Bucket C (review + future use)
      strategist: {
        intent, cluster,
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
  // AICOBR_CLUSTER_PILLAR_2026_08
  // Optional: an EXISTING page on the user's site that this plan should build a
  // supporting cluster underneath. Supplied by the plugin's /pages picker, so
  // post_id/url/title are already the site's own values — we validate shape only.
  // The excerpt is the page's own copy, trimmed, and is used to ground planning
  // so the spokes genuinely support THIS page rather than being guessed from the
  // title. Anything malformed degrades to "no pillar" (an ordinary plan).
  let pillar = null;
  const rawPillar = b.pillar;
  if (rawPillar && typeof rawPillar === 'object') {
    const pid   = parseInt(rawPillar.post_id, 10);
    const url   = String(rawPillar.url   || '').trim();
    const title = String(rawPillar.title || '').trim();
    if (pid > 0 && title && /^https?:\/\//i.test(url)) {
      pillar = {
        post_id: pid,
        title:   title.slice(0, 300),
        url:     url.slice(0, 2000),
        excerpt: String(rawPillar.excerpt || '').trim().slice(0, 2000),
      };
    }
  }

  // AICOBR_CLUSTER_SEEDLESS_2026_08
  // Keywords are optional WHEN a pillar page was chosen. Selecting the page the
  // cluster supports already tells us more than three typed keywords would: its
  // title, URL and actual copy all reach the planning prompt. Requiring keywords
  // on top of that is friction, and worse — a user forced to type something will
  // most likely type the pillar's own topic, which pushes the planner toward
  // posts that RESTATE the pillar instead of supporting it.
  //
  // researchSeeds is what the SERP fan-out grounds on; seeds stays as the user's
  // own list so the prompt can keep telling them apart (explicit asks vs a seed
  // we derived). Both are empty only when there is no pillar either, which the
  // route still rejects.
  const researchSeeds = seeds.length ? seeds : (pillar ? [pillar.title] : []);

  return { business, seeds, researchSeeds, params, tier, exclude, pillar, license_key: b.license_key, serp_gl: b.serp_gl };
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
      // AICOBR_AGENCY_TRIAL_2026_08: while the free trial batch has balance the
      // palette is the Agency palette; afterwards the real tier's palette.
      const r = await pool.query(
        `SELECT lk.tier,
                COALESCE((SELECT SUM(credits_remaining) FROM credit_batches
                          WHERE license_key_id = lk.id AND notes = 'free_tier_initial'
                            AND expiry_date > CURRENT_DATE), 0) AS trial_remaining
         FROM license_keys lk WHERE lk.license_key = $1 AND lk.status = 'active' LIMIT 1`, [license_key]);
      if (r.rows.length) {
        tier = normaliseTier(r.rows[0].tier);
        if (tier === 'free' && parseInt(r.rows[0].trial_remaining) > 0) tier = 'agency';
      }
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

  const { business, seeds, researchSeeds, params, exclude, pillar, license_key, serp_gl } = parsePlanInputs(req.body);

  // ── validation gate (before any charge) ──
  if (!license_key) return res.status(400).json({ success: false, error: 'license_key is required' });
  if (!business.location) return res.status(400).json({ success: false, error: 'Business location is required before the first plan run.' });
  // AICOBR_CLUSTER_SEEDLESS_2026_08 — a chosen pillar page IS the seed.
  if (researchSeeds.length === 0) {
    return res.status(400).json({ success: false, error: 'Add at least one target keyword, or choose a page to build a cluster around.' });
  }

  const client = await pool.connect();
  let charged = null; // { allocations } once we deduct

  // Cost instrumentation — hoisted so the outer catch can also stamp the row.
  // usageLogId stays null until the charge row is inserted; attachCost no-ops
  // on a null id, so pre-charge failures record nothing (nothing was spent).
  let usageLogId = null;
  const costCtx = { usage: null, stop_reason: null, serpCalls: 0 };
  const recordCost = (succeeded) => costLog.attachCost(pool, usageLogId, {
    model:       TEXT_MODEL,
    usage:       costCtx.usage,
    stop_reason: costCtx.stop_reason,
    image:       null,
    serpCalls:   costCtx.serpCalls,
    costEvent:   'strategist_plan',
    succeeded,
  });

  try {
    // Resolve tier + compute the slot dates + cost up front (all pure / cheap).
    const lkRow = await client.query(
      `SELECT lk.tier,
              COALESCE((SELECT SUM(credits_remaining) FROM credit_batches
                        WHERE license_key_id = lk.id AND notes = 'free_tier_initial'
                          AND expiry_date > CURRENT_DATE), 0) AS trial_remaining
       FROM license_keys lk WHERE lk.license_key = $1 AND lk.status = 'active' LIMIT 1`, [license_key]);
    if (lkRow.rows.length === 0) {
      client.release();
      return res.status(403).json({ success: false, error: 'License not active' });
    }
    const tier = normaliseTier(lkRow.rows[0].tier);
    // AICOBR_AGENCY_TRIAL_2026_08: trial opens the TYPE palette (Agency), but
    // plan LENGTH stays on the real tier — the trial is type-scoped by design.
    const trialActive = tier === 'free' && parseInt(lkRow.rows[0].trial_remaining) > 0;
    const paletteTier = trialActive ? 'agency' : tier;
    const timespan = clampTimespan(params.timespan_months, tier);
    const dates = expandCadence(params.cadence, timespan, params.start_date);
    if (dates.length === 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'That cadence produced no dates — check the cadence and timespan.' });
    }
    const palette = resolvePalette(paletteTier, params.content_types);
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
    // RETURNING id: this attempt's own row — token/Serper cost is attached to it
    // once the run resolves (success or refund), one row per attempt.
    const usageIns = await client.query(`
      INSERT INTO usage_logs (license_key_id, domain, post_title, content_type, credits_used, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
    `, [gate.licenseId, business.location || 'strategist', `Content plan (${dates.length} posts)`, 'strategist_plan', cost]);
    const usageLogIdRow = usageIns.rows[0]?.id ?? null;
    usageLogId = usageLogIdRow;
    await client.query('COMMIT');
    creditsCache.invalidate(license_key);
    charged = { allocations: gate.allocations };

    // ── the work (research + planning). Any throw here triggers a refund. ──
    const gl = serp_gl || process.env.SERP_DEFAULT_GL || 'us';
    const windowStart = dates[0];
    const windowEnd   = dates[dates.length - 1];
    const { grounded, events } = await runResearch(researchSeeds, gl, business.industry, business.location, windowStart, windowEnd, costCtx);

    const slots = dates.map((date, i) => ({ i, date }));
    const prompt = buildPlanningPrompt({ business, palette, seeds, researchSeeds, grounded, events, slots, exclude, pillar });

    // ── ACB_STRATEGIST_TOKENS_SCALE_2026_07_19 ──────────────────────────────
    // The plan's output size scales with SLOT COUNT, not months: each item is
    // ~120–200 output tokens of JSON. The old fixed 8,000 cap left zero headroom
    // for a 40-item (MAX_ITEMS) plan, so dense-cadence runs could truncate,
    // fail parseJsonLoose, and burn provider spend on every retry. Budget
    // ~250 tokens/item + 2,000 for the JSON envelope, floored at the old 8,000
    // so small plans behave exactly as before. max_tokens is a ceiling, not a
    // spend — unused headroom costs nothing.
    const planMaxTokens = Math.max(8000, Math.min(2000 + slots.length * 250, 16000));

    let parsed;
    try {
      const claudeRes = await callClaude(prompt, planMaxTokens);
      costCtx.usage       = claudeRes.usage;
      costCtx.stop_reason = claudeRes.stop_reason;
      // Truncated output is amputated JSON — fail BEFORE parsing so it can
      // never half-parse into a mangled plan. Throwing here lands in the
      // existing catch: refund, cache invalidation, cost recorded as waste.
      if (claudeRes.stop_reason === 'max_tokens') {
        throw new Error(`plan truncated at max_tokens=${planMaxTokens} (${slots.length} slots)`);
      }
      parsed = parseJsonLoose(claudeRes.text);
    } catch (e) {
      console.warn('[strategist/plan] planning parse failed:', e.message);
      if (charged) await creditLedger.refundSpanning(pool, charged.allocations);
      creditsCache.invalidate(license_key);
      // Refund returns the customer's credits — the Anthropic/Serper spend
      // already happened and is recorded as waste (succeeded=false).
      await recordCost(false);
      return res.status(502).json({ success: false, error: 'Could not build the plan. Your credits were not charged — please retry.' });
    }

    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    if (rawItems.length === 0) {
      if (charged) await creditLedger.refundSpanning(pool, charged.allocations);
      creditsCache.invalidate(license_key);
      await recordCost(false); // full Claude pass paid for, nothing usable back
      return res.status(502).json({ success: false, error: 'The plan came back empty. Your credits were not charged — please retry.' });
    }

    // Stitch our authoritative dates back in (item i -> slot i), sanitise, dedupe.
    let items = rawItems
      .slice(0, slots.length)
      .map((raw, i) => sanitiseItem(raw, palette, slots[i].date, pillar));
    items = dedupePlan(items, exclude);

    const infoCount = items.filter(i => i.intent === 'informational').length;

    await recordCost(true); // stamp the true provider cost onto the charge row

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
    // Stamp whatever provider spend happened before the throw (no-op if the
    // charge row was never created). attachCost never throws.
    await recordCost(false);
    return res.status(500).json({ success: false, error: 'Plan generation failed. Any charge has been refunded — please retry.' });
  } finally {
    client.release();
  }
});

module.exports = router;

// Mount in server.js alongside the others:
//   app.use('/api/strategist', require('./routes/strategist'));
// (Optionally rate-limit /api/strategist/plan like /api/generate.)
