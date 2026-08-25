/**
 * POST /api/outline
 *
 * SEO outline-review step. Given a keyword + title, fetches live SERP grounding
 * and asks Claude for a structured, editable outline (headings, points, FAQ,
 * and the content gap competitors miss). The plugin renders this for the user
 * to tweak, then sends the approved outline to /api/generate.
 *
 * Cheap: one SERP call + one small Claude call. No credits deducted here —
 * the credit is taken at generation. Secured by the shared generate secret,
 * same as /api/generate.
 *
 * Env: ANTHROPIC_API_KEY, SERP_API_KEY (optional — grounding degrades to
 * best-practice structure if absent), SERP_DEFAULT_GL (optional, default 'us').
 */

const express = require('express');
const { requireGenerateSecret } = require('../lib/require-generate-secret');
const router  = express.Router();
const serp    = require('../lib/serp');
const { Pool } = require('pg');
const costLog = require('../lib/cost-log');
const { fetchWithRetry } = require('../lib/http-retry');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TEXT_MODEL = 'claude-sonnet-4-6';

// Strip ```json fences and parse, tolerating any preamble/trailing prose.
function parseJsonLoose(text) {
    let t = String(text || '').trim().replace(/```json\s*|\s*```/g, '');
    const start = t.indexOf('{');
    const end   = t.lastIndexOf('}');
    if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
    return JSON.parse(t);
}

async function callClaude(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    // Bounded retry on transient network faults and 429/5xx/529 — same policy
    // as /api/generate (see lib/http-retry.js). Tighter budget than generation:
    // the user is sitting in the outline modal waiting, so fail within ~4 min
    // rather than stretching towards the diary's stuck threshold.
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: TEXT_MODEL,
            // Grounded, multi-section outlines (especially from richer Strategist
            // briefs) can exceed a tight ceiling and truncate mid-array, which then
            // surfaces downstream as a confusing "JSON parse" error rather than the
            // real cause. 2000 was too tight; 8000 comfortably fits any realistic
            // outline while staying well within model limits.
            max_tokens: 8000,
            temperature: 0.5,
            messages: [{ role: 'user', content: prompt }],
        }),
    }, {
        label:         'outline:anthropic',
        attempts:      3,
        timeoutMs:     120000,  // 2 min/attempt — an 8k-token outline is well inside this
        totalBudgetMs: 240000,  // 4 min total; interactive, keep the wait honest
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const text = data?.content?.map(b => b.text || '').join('');
    if (!text) throw new Error('Empty response from Anthropic API');
    // Surface truncation explicitly. If the model hit the token ceiling the JSON
    // is incomplete; callers should report that plainly rather than as a parse bug.
    // usage/stop_reason returned for cost instrumentation (lib/cost-log.js).
    return { text, truncated: data?.stop_reason === 'max_tokens', usage: data?.usage || null, stop_reason: data?.stop_reason || null };
}

router.post('/', async (req, res) => {
    // Same shared-secret gate as /api/generate
    // AICOBR_FAILCLOSED_SECRET_2026_08 — fail closed (was: skipped when unset)
    if (!requireGenerateSecret(req, res)) return;

    // license_key + domain are sent by plugin builds from 2026-07 onward (the
    // outline proxy in ai-content-bridge.php) purely for cost attribution.
    // Older builds omit them — the cost row is still written, unattributed
    // (license_key_id NULL; see add-cost-columns.sql). Never gate on them.
    const { keyword, title, serp_gl, serp_hl, license_key, domain, source_content } = req.body || {};
    const kw = (keyword || title || '').trim();
    if (!kw) {
        return res.status(400).json({ success: false, error: 'keyword or title is required' });
    }
    const refreshSource = String(source_content || '').trim();

    // Cost context — the outline is FREE to the user (credits are taken at
    // generation) but it spends real Anthropic + Serper money on every run.
    // Recording it is the whole point: pure cost, zero credit revenue.
    const costCtx = { usage: null, stop_reason: null, serpCalls: 0 };
    const recordCost = (succeeded) => {
        // Fire-and-forget: cost logging must never delay or fail the response.
        costLog.resolveLicenseId(pool, license_key).then(licenseKeyId =>
            costLog.insertCostRow(pool, {
                licenseKeyId,
                domain:      domain || 'unknown',
                postTitle:   kw,
                contentType: 'outline',
                model:       TEXT_MODEL,
                usage:       costCtx.usage,
                stop_reason: costCtx.stop_reason,
                image:       null,
                serpCalls:   costCtx.serpCalls,
                costEvent:   'outline',
                succeeded,
            })
        ).catch(() => {}); // insertCostRow already swallows; belt-and-braces
    };

    try {
        // 1. live SERP grounding (null if SERP_API_KEY unset or anything fails)
        let ground = null;
        if (serp.enabled()) {
            costCtx.serpCalls += 1; // billed on attempt, even if grounding returns null
            ground = await serp.getSerpGrounding(kw, {
                gl: serp_gl || process.env.SERP_DEFAULT_GL || 'us',
                hl: serp_hl || 'en',
            });
        }

        // 2. structured outline from Claude
        let prompt  = serp.buildOutlinePrompt(kw, title, ground);
        // AICOBR_REFRESH_2026_08 — when refreshing an existing post, give the
        // outliner the current article so the outline IMPROVES it: keep the
        // sections that work, and specifically add the gaps the SERP shows
        // competitors covering that this article currently misses.
        if (refreshSource) {
            prompt += `\n\n---\n\nThis is a REFRESH of an existing published article. Below is its CURRENT content. Produce an outline for an IMPROVED version of THIS article: keep the sections and angles that already work, drop or merge weak/redundant ones, and — most importantly — add the topics and questions the SERP data above shows competitors covering that this article is currently missing. In "content_gap", name what this specific article most needs to add to compete. Do not propose a generic outline that ignores what the article already does well.\n\nCURRENT ARTICLE:\n${refreshSource}`;
            console.log('[outline] Refresh mode — outline informed by existing article');
        }
        const { text: rawText, truncated, usage, stop_reason } = await callClaude(prompt);
        costCtx.usage       = usage;
        costCtx.stop_reason = stop_reason;

        if (truncated) {
            // The model ran out of output budget — the JSON is genuinely incomplete.
            // Report the real cause instead of letting it fall through to a parse error.
            console.warn('[outline] ⚠ TRUNCATED: stop_reason=max_tokens — outline incomplete. Consider a shorter brief or higher budget.');
            recordCost(false); // paid for a full response we can't use
            return res.status(502).json({ success: false, error: 'The outline was too long to complete. Please retry, or simplify the brief.' });
        }

        let outline;
        try {
            outline = parseJsonLoose(rawText);
        } catch (e) {
            console.warn('[outline] JSON parse failed:', e.message);
            recordCost(false);
            return res.status(502).json({ success: false, error: 'Could not parse outline. Please retry.' });
        }

        recordCost(true);
        return res.json({
            success: true,
            grounded: !!ground,
            outline,
            // lightweight extras the UI can show as keyword ideas (free byproduct)
            people_also_ask:  ground ? ground.peopleAlsoAsk  : [],
            related_searches: ground ? ground.relatedSearches : [],
            competitors:      ground ? ground.competitors.map(c => ({ title: c.title, url: c.url })) : [],
        });
    } catch (err) {
        console.error('[outline] failed:', err.message);
        recordCost(false); // whatever spend happened before the throw (serp, or a billed-but-empty Claude call) is captured
        return res.status(500).json({ success: false, error: 'Outline generation failed' });
    }
});

module.exports = router;
