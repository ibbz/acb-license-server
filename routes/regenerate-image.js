/**
 * POST /api/regenerate-image
 *
 * Image-ONLY regeneration for an existing diary entry. Generates a fresh
 * featured image and appends it to the entry's image_history in WordPress —
 * WITHOUT touching the post's text, SEO score, or body. Closes the "I like the
 * text but not the picture, why must I regenerate everything?" gap: a full post
 * regen costs ~$0.11 of Claude text to change a ~$0.05 image and risks the copy
 * the user was happy with. This route changes only the image, for 1 credit.
 *
 * It is essentially routes/generate.js with the entire text pipeline removed:
 *   1. Validate licence + resolve tier (same block as generate).
 *   2. Resolve the tier's image policy (shared lib/image-gen.js — free→mini).
 *      A no-image tier (model:null) returns a clean 400.
 *   3. Deduct 1 credit atomically (RETURNING the usage_logs row id).
 *   4. Respond immediately (async-after-response, same as generate — WP mustn't
 *      time out waiting on the image).
 *   5. Async: generateImage → uploadImageToWordPress → plugin /append-image.
 *      Cost is attached on success AND failure (a failed upload after a
 *      successful generate still paid OpenAI — that waste stays visible).
 *      On failure the 1 credit is refunded.
 *
 * Secured by the shared GENERATE_SECRET, same as /api/generate. The plugin's
 * trigger_regenerate_image proxy is the only caller (server-to-server); the
 * browser can't reach the licence server directly.
 *
 * Env: OPENAI_API_KEY, GENERATE_SECRET, DATABASE_URL.
 */

const { wpFetch } = require('../lib/wp-endpoint');
const { requireGenerateSecret } = require('../lib/require-generate-secret');
const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const creditsCache = require('../lib/credits-cache');
const creditLedger = require('../lib/credit-ledger');
const costLog = require('../lib/cost-log');
// Shared image concerns — the SAME tier→policy map, OpenAI generation, and WP
// upload that /api/generate uses (extracted to lib/image-gen.js). Using the
// shared module is what guarantees a free-tier regen runs mini, exactly like a
// free-tier full generation, with no chance of the two policies diverging.
const { imagePolicyFor, generateImage, uploadImageToWordPress, isValidLayout } = require('../lib/image-gen');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Deduct exactly 1 credit for an image regen, spanning batches in expiry order
 * (soonest-to-expire first) via the shared ledger — identical to generate.js so
 * the gate and the deduction can never disagree. Writes one usage_logs row
 * (content_type='image_regen') and RETURNs its id so cost is attached to THIS
 * attempt's own row (each regen deducts again → its own row → the admin's
 * cost-by-event split can see image_regen adoption and spend).
 */
async function deductOneCredit(client, licenseKey, domain, postTitle, costEvent) {
    const ded = await creditLedger.deductSpanning(client, licenseKey, 1);
    if (!ded.success) {
        return { success: false, error: ded.error || 'Insufficient credits' };
    }
    // content_type mirrors cost_event so the admin dashboard's by-type and
    // by-event splits agree. AICOBR_INBODY_IMAGES_2026_08 adds 'image_body' —
    // separating in-body adoption and spend from featured-image regeneration
    // from day one, exactly as image_regen was separated from generate.
    const ins = await client.query(`
        INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
        VALUES (
            (SELECT id FROM license_keys WHERE license_key = $1),
            $2, $3, 1, $4, NOW()
        )
        RETURNING id
    `, [licenseKey, domain || 'unknown', postTitle || 'Untitled', costEvent || 'image_regen']);

    return { success: true, allocations: ded.allocations, usage_log_id: ins.rows[0]?.id ?? null };
}

/**
 * Append a freshly-uploaded attachment to the entry's image_history via the
 * plugin's server-to-server /append-image endpoint. Returns true on success.
 * Never throws — a failed append is handled by the caller (refund + cost row).
 */
async function appendImageToWordPress(domain, { entry_id, attachment_id, set_active, role, layout, placement, alt_text, caption, suggestion_id }, generateSecret) {
    try {
        const res = await wpFetch(domain, '/append-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-generate-secret': generateSecret || '',
            },
            body: JSON.stringify({
                entry_id,
                attachment_id,
                // An in-body image must NOT become the featured image, so the
                // plugin's append_image is told the role explicitly rather than
                // inferring it from set_active.
                set_active: role === 'body' ? false : (set_active !== false),
                role:          role || 'featured',
                layout:        layout || null,
                placement:     placement || null,
                alt_text:      alt_text || '',
                caption:       caption || '',
                suggestion_id: suggestion_id || '',
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            console.warn(`[regenerate-image] /append-image failed (${res.status}):`, err.substring(0, 200));
            return false;
        }
        const data = await res.json();
        if (data?.success) {
            console.log(`[regenerate-image] Appended attachment ${attachment_id} to entry ${entry_id}`);
            return true;
        }
        console.warn('[regenerate-image] /append-image unexpected response:', JSON.stringify(data).substring(0, 200));
        return false;
    } catch (err) {
        console.warn('[regenerate-image] /append-image error:', err.message);
        return false;
    }
}

// ─── main route ─────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
    const startTime = Date.now();

    // Same shared-secret gate as /api/generate.
    // AICOBR_FAILCLOSED_SECRET_2026_08 — fail closed (was: skipped when unset)
    if (!requireGenerateSecret(req, res)) return;

    const {
        license_key,
        entry_id,
        domain,
        title,
        image_prompt,
        image_style,
        serp_gl,
        post_id,
        set_active,
        // AICOBR_INBODY_IMAGES_2026_08 — in-body image request. `role: 'body'`
        // selects the portrait/landscape size via the layout, the in-body prompt
        // shape, and a cost_event of its own. Absent, this route behaves exactly
        // as it did: a featured-image regeneration.
        role,
        layout,
        section_heading,
        style_anchor,
        caption,
        alt_text,
        suggestion_id,
    } = req.body || {};

    // Basic validation — entry_id + post_id are what the plugin needs to append
    // the image to the right entry/post; domain is where WP lives.
    if (!license_key || !domain || !entry_id) {
        return res.status(400).json({
            success: false,
            error: 'license_key, domain, and entry_id are required',
        });
    }

    // AICOBR_INBODY_IMAGES_2026_08 — normalise once, up front, so the policy,
    // the prompt, the cost row and the append call can never disagree about what
    // kind of image this is.
    const imageRole  = role === 'body' ? 'body' : 'featured';
    const reqLayout  = imageRole === 'body' && isValidLayout(layout) ? layout : undefined;
    const costEvent  = imageRole === 'body' ? 'image_body' : 'image_regen';

    console.log(`[regenerate-image] START — entry ${entry_id} | role: ${imageRole}${reqLayout ? '/' + reqLayout : ''} | domain: ${domain} | post_id: ${post_id ?? 'n/a'}`);

    // ── Step 1: validate licence + resolve tier (mirrors generate.js) ───────
    let licenseTier = 'free';
    try {
        const licResult = await pool.query(`
            SELECT lk.id, lk.tier, lk.status,
                   COALESCE(SUM(cb.credits_remaining), 0) AS credits_remaining
            FROM license_keys lk
            LEFT JOIN credit_batches cb
                ON cb.license_key_id = lk.id AND cb.expiry_date > CURRENT_DATE
            WHERE lk.license_key = $1 AND lk.status = 'active'
            GROUP BY lk.id, lk.tier, lk.status
        `, [license_key]);

        if (licResult.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Invalid or inactive license key' });
        }

        const lic = licResult.rows[0];

        // Normalise tier — same rules as generate.js.
        const rawTier = (lic.tier || '').toString().toLowerCase().trim();
        let normTier = 'free';
        if (rawTier.includes('agency')) normTier = 'agency';
        else if (rawTier.includes('pro'))     normTier = 'pro';
        else if (rawTier.includes('starter')) normTier = 'starter';
        licenseTier = normTier;
        console.log(`[regenerate-image] License tier: raw="${rawTier}" normalised="${normTier}"`);

        if (parseInt(lic.credits_remaining) < 1) {
            return res.status(402).json({ success: false, error: 'Insufficient credits', credits_remaining: parseInt(lic.credits_remaining) });
        }
    } catch (err) {
        console.error('[regenerate-image] License check failed:', err.message);
        return res.status(500).json({ success: false, error: 'License validation error' });
    }

    // ── Step 2: resolve the tier's image policy ─────────────────────────────
    // A no-image tier ({ model: null }) can't regenerate an image — say so
    // cleanly with a code the plugin proxy forwards to the UI. (No tier is
    // configured this way today, but the guard is correct and cheap.)
    // Layout selects the SIZE (an inline figure that text wraps around needs
    // portrait, not the featured 3:2). A free licence is resolved back to a band
    // by the shared module, because gpt-image-1-mini has no priced portrait row —
    // policy.layout is the layout that ACTUALLY applies and is what gets stored,
    // so the CSS class always matches the file that was generated.
    const imagePolicy = imagePolicyFor(licenseTier, reqLayout);
    if (imagePolicy.downgraded) {
        console.log(`[regenerate-image] layout ${reqLayout} downgraded to ${imagePolicy.layout} on tier ${licenseTier}`);
    }
    if (!imagePolicy.model) {
        return res.status(400).json({
            success: false,
            code: 'no_image_plan',
            error: "Images aren't included on your current plan.",
        });
    }

    // ── Step 3: deduct 1 credit atomically ──────────────────────────────────
    const client = await pool.connect();
    let allocations = null;
    let usageLogId  = null;
    try {
        await client.query('BEGIN');
        const deduction = await deductOneCredit(client, license_key, domain, title, costEvent);
        if (!deduction.success) {
            await client.query('ROLLBACK');
            return res.status(402).json({ success: false, error: deduction.error });
        }
        allocations = deduction.allocations;
        usageLogId  = deduction.usage_log_id;
        await client.query('COMMIT');
        creditsCache.invalidate(license_key);
        console.log(`[regenerate-image] Deducted 1 credit across ${allocations.length} batch(es)`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[regenerate-image] Credit deduction failed:', err.message);
        return res.status(500).json({ success: false, error: 'Credit deduction failed' });
    } finally {
        client.release();
    }

    // Respond immediately so the plugin proxy (and the browser behind it) doesn't
    // block on image generation — same async-after-response pattern as generate.
    res.json({
        success: true,
        message: 'Image generation started',
        credits_deducted: 1,
        role: imageRole,
        // The layout that actually applies after any tier downgrade.
        layout: imageRole === 'body' ? imagePolicy.layout : null,
        layout_downgraded: !!imagePolicy.downgraded,
    });

    // ── Step 4: async image pipeline ────────────────────────────────────────
    let imageBase64 = null;
    try {
        // No text, no serp, no YouTube — image only.
        imageBase64 = await generateImage(
            title || 'featured-image',
            image_prompt,
            image_style,
            serp_gl,
            imagePolicy,
            {
                role:           imageRole,
                sectionHeading: section_heading,
                // The featured image's own prompt, so a set of in-body images
                // reads as one commission rather than four unrelated stock
                // photos. Optional — the prompt degrades cleanly without it.
                styleAnchor:    style_anchor,
            },
        ).catch(() => null);

        if (!imageBase64) {
            throw new Error('Image generation returned no image');
        }

        const attachmentId = await uploadImageToWordPress(
            domain,
            imageBase64,
            title || 'featured-image',
            post_id || 0,
            process.env.GENERATE_SECRET || '',
        );
        if (!attachmentId) {
            throw new Error('Image upload to WordPress failed');
        }

        const appended = await appendImageToWordPress(
            domain,
            {
                entry_id,
                attachment_id: attachmentId,
                set_active,
                role:      imageRole,
                layout:    imageRole === 'body' ? imagePolicy.layout : null,
                placement: imageRole === 'body'
                    // AICOBR_INBODY_POSITION_DEFAULT_2026_08 — 'end-of-section'
                    // was retired in 2.9.0 because a figure with no prose after
                    // it inside its section has nothing to wrap against; default
                    // to the surviving position instead of the dead one.
                    ? { section_heading: section_heading || '', position: req.body?.position || 'after-heading' }
                    : null,
                alt_text:  alt_text || '',
                caption:   caption  || '',
                suggestion_id,
            },
            process.env.GENERATE_SECRET || '',
        );
        if (!appended) {
            throw new Error('Appending image to entry history failed');
        }

        console.log(`[regenerate-image] COMPLETE — entry ${entry_id}, attachment ${attachmentId}`);

        // ── Cost instrumentation: success ──
        // No usage (no Anthropic call) and no serp — the image line is the whole
        // cost. Prices via the ACTUAL policy that ran (mini for free), so a free
        // regen costs $0.015, not $0.05. One row per attempt; cost_event splits
        // image_regen out on the admin dashboard.
        await costLog.attachCost(pool, usageLogId, {
            model:       null,
            usage:       null,
            stop_reason: null,
            image:       { model: imagePolicy.model, size: imagePolicy.size, quality: imagePolicy.quality },
            serpCalls:   0,
            costEvent:   costEvent,
            succeeded:   true,
            generationSeconds: Math.round((Date.now() - startTime) / 1000),
        });

    } catch (err) {
        console.error(`[regenerate-image] Pipeline failed for entry ${entry_id}:`, err.message);

        // Refund the 1 credit. MUST NOT throw out of here — this runs after
        // res.json(), so an escaping rejection is unhandled (see generate.js).
        if (allocations) {
            try {
                await creditLedger.refundSpanning(pool, allocations);
                creditsCache.invalidate(license_key);
            } catch (refundErr) {
                console.error('[regenerate-image] Refund failed (non-fatal, manual review):', refundErr.message);
            }
        }

        // ── Cost instrumentation: failure ──
        // The refund returned the customer's credit; it did not refund what we
        // paid OpenAI. If a b64 came back but the upload/append failed, the image
        // still cost money — record it as succeeded=false so the admin's waste
        // metric sees it. If generation itself returned nothing, imageBase64 is
        // null → no image cost billed (a failed generate isn't charged).
        await costLog.attachCost(pool, usageLogId, {
            model:       null,
            usage:       null,
            stop_reason: null,
            image:       imageBase64 ? { model: imagePolicy.model, size: imagePolicy.size, quality: imagePolicy.quality } : null,
            serpCalls:   0,
            costEvent:   costEvent,
            succeeded:   false,
            generationSeconds: Math.round((Date.now() - startTime) / 1000),
        });
    }
});

module.exports = router;
