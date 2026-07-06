/**
 * lib/pricing.js
 *
 * Single source of truth for every provider unit price ACB pays. All cost
 * figures written to usage_logs are computed HERE, at generation time, and
 * stamped with PRICE_VERSION — so a future provider price change never
 * rewrites history (raw tokens are stored alongside for re-derivation).
 *
 * Pure module: no DB, no env, no network — unit-testable standalone
 * (see test-pricing.js, same convention as test-resolve-interval.js).
 *
 * Prices verified 2026-07-06:
 *   Anthropic claude-sonnet-4-6 — $3/M input, $15/M output.
 *     Prompt caching (Anthropic pricing docs): 5-min cache WRITE = 1.25x base
 *     input, cache READ = 0.10x base input. Response usage fields:
 *     cache_creation_input_tokens / cache_read_input_tokens. Note that
 *     usage.input_tokens EXCLUDES cached tokens, so summing all four
 *     components does not double-count.
 *   OpenAI gpt-image-1.5 — per-image, from the official model page
 *     (platform.openai.com/docs/models/gpt-image-1.5).
 *   Serper — $0.30–$1.00 per 1,000 searches; priced at the conservative
 *     $1/1k ($0.001/search). Competitor-page fetches are free egress.
 *
 * When a provider changes prices: update the table, bump PRICE_VERSION.
 * The companion spreadsheet (ACB_Unit_Economics_Model.xlsx) mirrors these
 * numbers by hand — update both.
 */

const PRICE_VERSION = '2026-07';

// ── Anthropic text models ($ per 1M tokens) ──────────────────────────────────
const TEXT = {
    'claude-sonnet-4-6': {
        inPerM:         3.00,
        outPerM:        15.00,
        cacheWriteMult: 1.25,  // 5-minute ephemeral cache (the only kind ACB uses)
        cacheReadMult:  0.10,
    },
};

// ── OpenAI image models ($ per image), keyed model|size|quality ───────────────
const IMAGE = {
    'gpt-image-1.5|1536x1024|medium': 0.050,
    'gpt-image-1.5|1024x1536|medium': 0.050,
    'gpt-image-1.5|1024x1024|medium': 0.034,
    'gpt-image-1.5|1536x1024|low':    0.013,
    'gpt-image-1.5|1024x1024|low':    0.009,
    'gpt-image-1.5|1536x1024|high':   0.200,
    'gpt-image-1-mini|1536x1024|medium': 0.015,
    'gpt-image-1-mini|1536x1024|low':    0.006,
};

// ── Serper ($ per search) ─────────────────────────────────────────────────────
const SERP_PER_SEARCH = 0.001;

// Round to 5 dp — matches the numeric(10,5) columns; avoids float dust.
function r5(n) { return Math.round(n * 1e5) / 1e5; }

/**
 * Text cost from an Anthropic usage object. Unknown model logs loudly and
 * returns null (NOT 0 — a null cost is visibly "unpriced"; a silent 0 would
 * corrupt margin sums downstream).
 */
function textCostUsd({ model, input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0 } = {}) {
    const p = TEXT[model];
    if (!p) {
        console.error(`[pricing] UNKNOWN TEXT MODEL "${model}" — cost not computed. Add it to lib/pricing.js.`);
        return null;
    }
    return r5(
        (input_tokens       / 1e6) * p.inPerM +
        (output_tokens      / 1e6) * p.outPerM +
        (cache_write_tokens / 1e6) * p.inPerM * p.cacheWriteMult +
        (cache_read_tokens  / 1e6) * p.inPerM * p.cacheReadMult
    );
}

/**
 * Image cost. No image (null/undefined model) is legitimately $0.
 * A PRESENT but unknown model|size|quality logs loudly and returns null so a
 * new size/quality can never silently cost $0.
 */
function imageCostUsd({ model, size, quality } = {}) {
    if (!model) return 0;
    const key = `${model}|${size}|${quality}`;
    const price = IMAGE[key];
    if (price === undefined) {
        console.error(`[pricing] UNKNOWN IMAGE KEY "${key}" — cost not computed. Add it to lib/pricing.js.`);
        return null;
    }
    return r5(price);
}

function serpCostUsd(count = 0) {
    return r5(Math.max(0, count) * SERP_PER_SEARCH);
}

/**
 * Sum the three lines. Null-propagating: if any component is null (unpriced),
 * the total is null — never a silently-low number.
 */
function totalCostUsd(text, image, serp) {
    if (text === null || image === null || serp === null) return null;
    return r5((text || 0) + (image || 0) + (serp || 0));
}

function priceVersion() { return PRICE_VERSION; }

module.exports = { textCostUsd, imageCostUsd, serpCostUsd, totalCostUsd, priceVersion, TEXT, IMAGE, SERP_PER_SEARCH };
