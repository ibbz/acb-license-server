/**
 * POST /api/image-suggestions
 *
 * AICOBR_INBODY_IMAGES_2026_08
 *
 * The RETROACTIVE half of in-body images: given an article that already exists,
 * ask Claude which images would help it and where they should go. This is what
 * makes the feature work on the hundreds of posts a user generated before it
 * shipped — the case no competitor covers.
 *
 * Suggestions are DESCRIPTIONS. Nothing is generated here, nothing is uploaded,
 * and NO CREDIT IS DEDUCTED. The user picks one in the image modal, and that is
 * where the 1-credit generation happens. Browsing is free; spending is a button
 * press. Modelled directly on routes/outline.js, which has the same shape: free
 * to the user, real money to us, so the cost row is the whole point.
 *
 * Secured by the shared GENERATE_SECRET, same as /api/generate. The plugin's
 * image_suggestions proxy is the only caller (server-to-server) — the browser
 * cannot reach the licence server directly, and the article body is read
 * plugin-side with get_post() rather than trusted from the browser.
 *
 * Env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

const express = require('express');
const { requireGenerateSecret } = require('../lib/require-generate-secret');
const router  = express.Router();
const { Pool } = require('pg');
const costLog = require('../lib/cost-log');
const { fetchWithRetry } = require('../lib/http-retry');
const imageSuggestions = require('../lib/image-suggestions');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TEXT_MODEL = 'claude-sonnet-4-6';

// A very long post would push both cost and latency up for no benefit — the
// headings and their opening paragraphs are what placement actually needs. Well
// above GLOBAL_MAX_WORDS (4000 words ≈ 26k chars) so a normal ACB article is
// never truncated; this only bites on something pathological.
const MAX_ARTICLE_CHARS = 60000;

async function callClaude(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    // Bounded retry on transient network faults and 429/5xx/529 — same policy as
    // /api/outline, and for the same reason: the user is sitting in the image
    // modal waiting, so fail within ~4 minutes rather than stretching towards
    // the diary's stuck threshold.
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: TEXT_MODEL,
            // Three suggestions is a small JSON array; 2000 is ample. Truncation
            // is surfaced explicitly below rather than reaching the parser as a
            // confusing "unparseable JSON".
            max_tokens: 2000,
            temperature: 0.6,
            messages: [{ role: 'user', content: prompt }],
        }),
    }, {
        label:         'image-suggestions:anthropic',
        attempts:      3,
        timeoutMs:     120000,  // 2 min/attempt
        totalBudgetMs: 240000,  // 4 min total; interactive, keep the wait honest
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const text = data?.content?.map(b => b.text || '').join('');
    if (!text) throw new Error('Empty response from Anthropic API');
    return {
        text,
        truncated:   data?.stop_reason === 'max_tokens',
        usage:       data?.usage || null,
        stop_reason: data?.stop_reason || null,
    };
}

router.post('/', async (req, res) => {
    // Same shared-secret gate as /api/generate.
    // AICOBR_FAILCLOSED_SECRET_2026_08 — fail closed (was: skipped when unset)
    if (!requireGenerateSecret(req, res)) return;

    const { title, content, content_type, count, license_key, domain } = req.body || {};

    const article = String(content || '');
    if (!article.trim()) {
        return res.status(400).json({ success: false, error: 'content is required' });
    }

    // Eligibility is decided HERE, not by the browser. The module mirrors the
    // formatter's article/doc tiers — a floated figure in a WooCommerce product
    // description is wrong however the request was made.
    const activeType = content_type || 'blog_post';
    if (!imageSuggestions.IMAGE_SUGGESTION_TYPES.has(activeType)) {
        return res.status(400).json({
            success: false,
            code:    'type_ineligible',
            error:   'In-body images are not available for this content type.',
        });
    }

    // The article must have headings to anchor against. Checking before the API
    // call saves a pointless spend on a post that could never produce a usable
    // suggestion (the parser would drop every one for having no anchor).
    const headings = imageSuggestions.extractHeadings(article);
    if (headings.length === 0) {
        return res.status(400).json({
            success: false,
            code:    'no_headings',
            error:   'This post has no section headings, so there is nowhere to place an image.',
        });
    }

    // Word count drives the ceiling exactly as it does at generation time, so a
    // short post gets one suggestion and a long one gets three.
    const words = article.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    const n = imageSuggestions.resolveSuggestionCount(activeType, words, count);
    if (n < 1) {
        return res.status(400).json({ success: false, code: 'type_ineligible', error: 'In-body images are not available for this content type.' });
    }

    // Cost context. FREE to the user — credits are taken at generation — but it
    // spends real Anthropic money on every run. Recording it is the whole point:
    // pure cost, zero credit revenue, visible in /api/admin/costs from day one
    // under its own event, exactly like 'outline'.
    const costCtx = { usage: null, stop_reason: null };
    const recordCost = (succeeded) => {
        costLog.resolveLicenseId(pool, license_key).then(licenseKeyId =>
            costLog.insertCostRow(pool, {
                licenseKeyId,
                domain:      domain || 'unknown',
                postTitle:   title || 'Untitled',
                contentType: 'image_suggest',
                model:       TEXT_MODEL,
                usage:       costCtx.usage,
                stop_reason: costCtx.stop_reason,
                image:       null,
                serpCalls:   0,
                costEvent:   'image_suggest',
                succeeded,
            })
        ).catch(() => {}); // insertCostRow already swallows; belt-and-braces
    };

    try {
        const prompt = imageSuggestions.buildRetroPrompt(
            article.slice(0, MAX_ARTICLE_CHARS),
            title,
            n
        );

        const { text, truncated, usage, stop_reason } = await callClaude(prompt);
        costCtx.usage       = usage;
        costCtx.stop_reason = stop_reason;

        if (truncated) {
            console.warn('[image-suggestions] ⚠ TRUNCATED: stop_reason=max_tokens — suggestions incomplete.');
            recordCost(false); // paid for a response we cannot use
            return res.status(502).json({ success: false, error: 'The suggestions were cut short. Please try again.' });
        }

        // Parse against the REAL article, so every suggestion is validated
        // against headings that actually exist. A suggestion whose anchor cannot
        // be resolved is dropped rather than kept: the insertion step matches on
        // that heading, and a bad anchor is worse than no image.
        const parsed = imageSuggestions.parseSuggestionBlock(text, { max: n, article });

        if (parsed.parseError) {
            console.warn('[image-suggestions] parse failed:', parsed.parseError);
            recordCost(false);
            return res.status(502).json({ success: false, error: 'Could not read the suggestions. Please try again.' });
        }

        recordCost(true);
        console.log(`[image-suggestions] ${parsed.suggestions.length}/${n} suggestion(s) for "${title || 'Untitled'}"`);

        return res.json({
            success:     true,
            suggestions: parsed.suggestions,
            requested:   n,
        });
    } catch (err) {
        console.error('[image-suggestions] failed:', err.message);
        recordCost(false); // whatever spend happened before the throw is captured
        return res.status(500).json({ success: false, error: 'Could not generate image suggestions.' });
    }
});

module.exports = router;
