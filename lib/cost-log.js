/**
 * lib/cost-log.js
 *
 * Writes true per-call provider cost onto usage_logs. Two shapes:
 *
 *   attachCost(pool, usageLogId, data)  — UPDATE an existing row (generate and
 *     strategist insert their usage row at deduction time, before the work;
 *     the cost is attached to that same row once the pipeline resolves).
 *
 *   insertCostRow(pool, data)           — INSERT a fresh row for paths that
 *     have no deduction-time row (outline, extract-style, support-chat).
 *
 * Both are best-effort by contract: they log-and-swallow their own errors.
 * Cost logging must NEVER fail a generation, a refund, or a support reply —
 * these run inside fire-and-forget pipelines (see the v2.7 resilience notes
 * in generate.js) where an escaping rejection crashes the process.
 *
 * Correctness rules encoded here (see ACB-cost-instrumentation-scope):
 *   - rows are written on FAILURE too (succeeded=false): a credit refund
 *     returns the customer's credits, not what we paid the providers.
 *   - one row per ATTEMPT: callers never overwrite a previous attempt's row —
 *     attachCost only ever targets the row its own attempt created.
 */

const pricing = require('./pricing');

function computeLines({ model, usage, image, serpCalls }) {
    // No Anthropic response = nothing billed for text (failed API calls aren't
    // charged) — cost is genuinely 0. Skipping textCostUsd here also avoids a
    // misleading "unknown model" error log on every failed-early attempt.
    const text  = usage ? pricing.textCostUsd({
        model,
        input_tokens:       usage.input_tokens       || 0,
        output_tokens:      usage.output_tokens      || 0,
        cache_read_tokens:  usage.cache_read_input_tokens     || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
    }) : 0;
    const img   = pricing.imageCostUsd(image || {});
    const serp  = pricing.serpCostUsd(serpCalls || 0);
    return { text, img, serp, total: pricing.totalCostUsd(text, img, serp) };
}

/**
 * Attach cost data to an existing usage_logs row (by id).
 * data: { model, usage, stop_reason, image:{model,size,quality}|null,
 *         serpCalls, costEvent, succeeded, generationSeconds }
 */
async function attachCost(pool, usageLogId, data) {
    if (!usageLogId) return;
    try {
        const { model, usage, stop_reason, image, serpCalls, costEvent, succeeded, generationSeconds } = data;
        // No usage AND no image AND no serp = the attempt died before any
        // provider was called; still stamp the row so it reads as a costed,
        // failed attempt at $0 rather than an unpriced legacy row.
        const lines = computeLines({ model, usage, image, serpCalls });

        await pool.query(`
            UPDATE usage_logs SET
                model               = $2,
                input_tokens        = $3,
                output_tokens       = $4,
                cache_read_tokens   = $5,
                cache_write_tokens  = $6,
                stop_reason         = $7,
                image_model         = $8,
                image_size          = $9,
                image_quality       = $10,
                serp_search_count   = $11,
                text_cost_usd       = $12,
                image_cost_usd      = $13,
                serp_cost_usd       = $14,
                total_cost_usd      = $15,
                price_version       = $16,
                cost_event          = $17,
                succeeded           = $18,
                generation_time_seconds = COALESCE($19, generation_time_seconds)
            WHERE id = $1
        `, [
            usageLogId,
            usage ? model : null,
            usage?.input_tokens       ?? null,
            usage?.output_tokens      ?? null,
            usage?.cache_read_input_tokens     ?? null,
            usage?.cache_creation_input_tokens ?? null,
            stop_reason || null,
            image?.model   || null,
            image?.size    || null,
            image?.quality || null,
            serpCalls || 0,
            lines.text,
            lines.img,
            lines.serp,
            lines.total,
            pricing.priceVersion(),
            costEvent,
            succeeded === true,
            (generationSeconds ?? null),
        ]);
    } catch (err) {
        console.error('[cost-log] attachCost failed (non-fatal):', err.message);
    }
}

/**
 * Insert a standalone cost row for paths with no deduction-time usage row.
 * data: { licenseKeyId (nullable), domain, postTitle, contentType,
 *         model, usage, stop_reason, image, serpCalls, costEvent, succeeded }
 */
async function insertCostRow(pool, data) {
    try {
        const { licenseKeyId, domain, postTitle, contentType,
                model, usage, stop_reason, image, serpCalls, costEvent, succeeded } = data;
        const lines = computeLines({ model, usage, image, serpCalls });

        await pool.query(`
            INSERT INTO usage_logs (
                license_key_id, domain, post_title, content_type, credits_used,
                model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                stop_reason, image_model, image_size, image_quality, serp_search_count,
                text_cost_usd, image_cost_usd, serp_cost_usd, total_cost_usd,
                price_version, cost_event, succeeded, created_at
            ) VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
        `, [
            licenseKeyId ?? null,
            domain || 'unknown',
            postTitle || 'Untitled',
            contentType || 'other',
            usage ? model : null,
            usage?.input_tokens       ?? null,
            usage?.output_tokens      ?? null,
            usage?.cache_read_input_tokens     ?? null,
            usage?.cache_creation_input_tokens ?? null,
            stop_reason || null,
            image?.model   || null,
            image?.size    || null,
            image?.quality || null,
            serpCalls || 0,
            lines.text,
            lines.img,
            lines.serp,
            lines.total,
            pricing.priceVersion(),
            costEvent,
            succeeded === true,
        ]);
    } catch (err) {
        console.error('[cost-log] insertCostRow failed (non-fatal):', err.message);
    }
}

/** Resolve a licence key string to its id; null if missing/unknown. */
async function resolveLicenseId(pool, licenseKey) {
    if (!licenseKey) return null;
    try {
        const r = await pool.query(`SELECT id FROM license_keys WHERE license_key = $1 LIMIT 1`, [licenseKey]);
        return r.rows[0]?.id ?? null;
    } catch { return null; }
}

module.exports = { attachCost, insertCostRow, resolveLicenseId };
