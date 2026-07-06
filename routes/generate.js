/**
 * POST /api/generate
 *
 * Native generation engine — replaces Make.com entirely.
 *
 * Flow:
 *  1. Validate license key + check credits
 *  2. Deduct credits atomically (before generation — prevents over-use)
 *  3. Call YouTube Data API — search for up to 3 videos
 *  4. Call OpenAI API    — generate featured image (gpt-image-1.5)
 *  5. Call Anthropic API — generate article content
 *  6. POST results back to WordPress /wp-json/ai-content/v1/publish
 *  7. On any failure after credit deduction — refund credits
 *
 * Environment variables required (set in Railway):
 *   ANTHROPIC_API_KEY
 *   OPENAI_API_KEY
 *   YOUTUBE_API_KEY
 *   GENERATE_SECRET   (shared secret WordPress sends to authenticate requests)
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const { CONTENT_TYPES, canAccessContentType, buildPrompt, resolveTargetWords, maxTokensFor } = require('../content-types');
const { scoreSeo, parseSeoBlock } = require('../lib/seo-score');
const serp = require('../lib/serp');
const creditsCache = require('../lib/credits-cache');
const creditLedger = require('../lib/credit-ledger');
const costLog = require('../lib/cost-log');

// The one text model and image configuration this route uses. Single constants
// so the API call, the publish payload and the cost row can never disagree.
// Changing model/size/quality here REQUIRES a matching entry in lib/pricing.js
// (an unknown key prices as null and logs loudly — see cost instrumentation).
const TEXT_MODEL  = 'claude-sonnet-4-6';
const IMAGE_MODEL = 'gpt-image-1.5';
const IMAGE_SIZE  = '1536x1024';
const IMAGE_QUALITY = 'medium';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Content types that benefit from live SERP grounding (web-facing, keyword-led).
// Others (quizzes, SOPs, listings, etc.) skip grounding — it would add noise.
const SERP_GROUNDING_TYPES = new Set([
    'blog_post', 'tutorial', 'faq_page', 'service_page', 'about_us',
    'landing_page', 'review_comparison', 'explainer_guide',
]);

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Deduct credits across batches in expiry order (soonest-to-expire first), via the
 * shared ledger. Spending can SPAN batches so a split balance (e.g. 5 monthly + 5
 * bundle) covers a 2–3 credit post — the gate already sums across batches, so the
 * deduction must too. Then logs the usage row.
 * Returns { success, allocations:[{batch_id,amount}], credits_deducted } or { success:false, error }.
 */
async function deductCredits(client, licenseKey, credits, domain, postTitle, contentType, styleProfileName) {
    const ded = await creditLedger.deductSpanning(client, licenseKey, credits);
    if (!ded.success) {
        return { success: false, error: ded.error || 'Insufficient credits' };
    }

    // RETURNING id: this attempt's own row. Cost data (tokens, provider spend,
    // succeeded flag) is attached to it once the pipeline resolves — one row
    // per attempt, so regenerations append rather than overwrite (each regen
    // deducts again and therefore creates its own row).
    const ins = await client.query(`
        INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, style_profile_used, created_at)
        VALUES (
            (SELECT id FROM license_keys WHERE license_key = $1),
            $2, $3, $4, $5, $6, NOW()
        )
        RETURNING id
    `, [licenseKey, domain || 'unknown', postTitle || 'Untitled', credits, contentType || 'blog_post', styleProfileName || null]);

    return { success: true, allocations: ded.allocations, credits_deducted: credits, usage_log_id: ins.rows[0]?.id ?? null };
}

/**
 * Search YouTube for up to 3 videos matching the title.
 * Returns array of YouTube URLs (may be empty if API key missing or no results).
 */
async function searchYouTube(title) {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
        console.warn('[generate] YOUTUBE_API_KEY not set — skipping YouTube search');
        return [];
    }

    try {
        const params = new URLSearchParams({
            part: 'snippet',
            q: title,
            type: 'video',
            maxResults: '3',
            key: apiKey,
        });

        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
        if (!res.ok) {
            console.warn('[generate] YouTube API error:', res.status, await res.text());
            return [];
        }

        const data = await res.json();
        const items = data.items || [];
        return items
            .map(item => item?.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : null)
            .filter(Boolean);
    } catch (err) {
        console.warn('[generate] YouTube search failed:', err.message);
        return [];
    }
}

/**
 * Generate a featured image via OpenAI gpt-image-1.5.
 * Returns base64 PNG string or null on failure.
 */
// Translate a SERP region code (gl) into an image-locale instruction so the
// model renders region-appropriate scenes — currency, signage, vehicles,
// architecture — instead of defaulting to US visual clichés (e.g. dollar bills).
// Returns '' when the code is unset/unknown, so behaviour is unchanged unless a
// region is explicitly configured (never forces the wrong locale).
function localeClause(gl) {
    if (!gl) return '';
    const place = {
        gb: 'the United Kingdom', uk: 'the United Kingdom', us: 'the United States',
        ca: 'Canada', au: 'Australia', ie: 'Ireland', nz: 'New Zealand',
        in: 'India', za: 'South Africa', sg: 'Singapore', ae: 'the United Arab Emirates',
        de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy', nl: 'the Netherlands',
        se: 'Sweden', no: 'Norway', dk: 'Denmark', pt: 'Portugal',
    }[String(gl).toLowerCase().trim()];
    if (!place) return '';
    return ` The scene must be set in ${place}: any currency, signage, vehicles, architecture and everyday details should be appropriate to ${place}, not another country — for example, do not show US dollar bills unless ${place} is the United States.`;
}

async function generateImage(title, imagePrompt, imageStyle, gl) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[generate] OPENAI_API_KEY not set — skipping image generation');
        return null;
    }

    const styleDescriptions = {
        professional:  'professional and clean',
        cinematic:     'cinematic and dramatic with moody lighting',
        minimalist:    'minimalist and modern with lots of white space',
        warm:          'warm and inviting with golden tones',
        corporate:     'corporate and trustworthy, business-like',
        vintage:       'vintage and nostalgic with retro styling',
        bold:          'bold and energetic with vivid colours',
        dreamy:        'soft and dreamy with pastel tones',
        moody:         'dark and moody with deep shadows',
        playful:       'bright and playful with vibrant colours',
        luxury:        'elegant and luxurious with premium styling',
        futuristic:    'tech-forward and futuristic with neon accents',
        natural:       'natural and organic with earthy tones',
        editorial:     'news editorial style, documentary feel',
        artistic:      'artistic and creative, painterly quality',
    };

    const styleDesc = styleDescriptions[imageStyle] || 'professional and clean';
    const loc = localeClause(gl);
    const prompt = imagePrompt
        ? `Create a ${styleDesc} featured image for a blog post. ${imagePrompt}. Title: "${title}".${loc} High quality, eye-catching, suitable for a professional blog.`
        : `Create a ${styleDesc} featured image for a blog post titled: "${title}".${loc} High quality, professional, and eye-catching. No text overlays.`;

    try {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: IMAGE_MODEL,
                prompt,
                n: 1,
                size: IMAGE_SIZE,
                quality: IMAGE_QUALITY,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.warn('[generate] OpenAI image error:', res.status, err);
            return null;
        }

        const data = await res.json();
        // gpt-image-1.5 returns b64_json by default
        return data?.data?.[0]?.b64_json || null;
    } catch (err) {
        console.warn('[generate] Image generation failed:', err.message);
        return null;
    }
}

/**
 * Generate article content via Anthropic Claude.
 * Returns the text response string or throws on failure.
 */

/**
 * Parse the ---QUIZ_DATA_START--- block from Claude's quiz response.
 * Returns { quizData, cleanContent } — cleanContent has the block stripped out.
 */
function parseQuizData(text) {
    const startMarker = '---QUIZ_DATA_START---';
    const endMarker   = '---QUIZ_DATA_END---';
    const startIdx    = text.indexOf(startMarker);
    const endIdx      = text.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
        console.log('[generate] No QUIZ_DATA block found in response');
        return { quizData: null, cleanContent: text };
    }

    const jsonStr = text.slice(startIdx + startMarker.length, endIdx).trim();

    // For the post content, we only want the intro — not the full Q&A.
    // The intro is everything before the first question line (Q1. or **Q1)
    const criticalLine = '---CRITICAL:';
    const critIdx = text.indexOf(criticalLine);
    const beforeBlock = text.slice(0, critIdx !== -1 ? critIdx : startIdx).trim();

    // Extract just the intro — stop at first question marker
    const questionMarkers = ['Q1.', 'Q1)', '**Q1', 'Question 1:', '1.'];
    let introEnd = -1;
    for (const marker of questionMarkers) {
        const idx = beforeBlock.indexOf(marker);
        if (idx !== -1 && (introEnd === -1 || idx < introEnd)) introEnd = idx;
    }
    const introOnly = introEnd > 10 ? beforeBlock.slice(0, introEnd).trim() : beforeBlock;

    const cleanContent = introOnly || beforeBlock;

    try {
        const quizData = JSON.parse(jsonStr);
        console.log('[generate] Parsed quiz data: ' + (quizData.questions?.length || 0) + ' questions');
        return { quizData, cleanContent };
    } catch (e) {
        console.warn('[generate] Failed to parse quiz JSON:', e.message);
        // On parse failure still strip the block but keep intro only
        return { quizData: null, cleanContent };
    }
}

/**
 * Turn an approved outline (from the /api/outline review step) into a prompt
 * block instructing Claude to follow that structure.
 */
function renderApprovedOutline(outline) {
    if (!outline || typeof outline !== 'object') return '';
    const lines = ['**FOLLOW THIS APPROVED OUTLINE — the user has reviewed and confirmed this structure. Honour the headings and points; expand each into full content.**'];
    if (outline.suggested_title) lines.push(`\nWorking title: ${outline.suggested_title}`);
    if (Array.isArray(outline.sections)) {
        outline.sections.forEach((s, i) => {
            lines.push(`\n${i + 1}. ${s.heading || ''}`);
            if (Array.isArray(s.points)) s.points.forEach(p => lines.push(`   - ${p}`));
        });
    }
    if (Array.isArray(outline.faq) && outline.faq.length) {
        lines.push(`\nInclude an FAQ section answering: ${outline.faq.join(' | ')}`);
    }
    if (outline.content_gap) {
        lines.push(`\nIMPORTANT differentiator — make sure the article delivers this angle that competitors miss: ${outline.content_gap}`);
    }
    return lines.join('\n');
}

async function generateContent(payload, costCtx) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    const {
        title, primary_keyword, target_word_count,
        special_instructions, brand_voice, tone, style_profile,
        content_type, content_type_meta,
        approved_outline, serp_gl, serp_hl,
    } = payload;

    // Build the user prompt using the content type template
    const activeContentType = content_type || 'blog_post';
    // Resolve the requested word count into this type's length band (clamped,
    // with a global backstop). Used for the prompt, max_tokens, and SEO scoring.
    const effectiveWordCount = resolveTargetWords(activeContentType, target_word_count);
    let userPrompt = buildPrompt(activeContentType, title, primary_keyword, effectiveWordCount, content_type_meta);
    console.log(`[generate] Content type: ${activeContentType}`);

    // ── SEO grounding ───────────────────────────────────────────────────────
    // If an approved outline was supplied (outline-review flow) it already carries
    // its SERP grounding — inject it and skip a second SERP call. Otherwise, for
    // keyword-led web content, fetch live SERP grounding so the article covers
    // what's actually ranking. Both are advisory and fail soft.
    if (approved_outline) {
        userPrompt = renderApprovedOutline(approved_outline) + '\n\n---\n\n' + userPrompt;
        console.log('[generate] Using approved outline from review step');
    } else if (serp.enabled() && primary_keyword && SERP_GROUNDING_TYPES.has(activeContentType)) {
        try {
            // Cost note: the Serper search is billed on attempt (an empty result
            // still consumes a Serper credit), so count it here, not on success.
            // Competitor-page fetches inside getSerpGrounding are free egress.
            if (costCtx) costCtx.serpCalls += 1;
            const ground = await serp.getSerpGrounding(primary_keyword, {
                gl: serp_gl || process.env.SERP_DEFAULT_GL || 'us',
                hl: serp_hl || 'en',
            });
            if (ground) {
                userPrompt = serp.groundingToPromptBlock(ground) + '\n\n---\n\n' + userPrompt;
                console.log(`[generate] SERP grounding applied: ${ground.competitors.length} pages, ${ground.commonTopics.length} common topics, ${ground.peopleAlsoAsk.length} PAA`);
            }
        } catch (e) {
            console.warn('[generate] SERP grounding skipped (non-fatal):', e.message);
        }
    }

    // Build system prompt — includes brand voice, tone, and active style profile
    const styleProfileBlock = style_profile?.profile ? `
<writing_style_profile name="${style_profile.name || 'Custom'}">
VOICE: ${style_profile.profile.voice || ''}
TONE: ${style_profile.profile.tone || ''}
SENTENCE STRUCTURE: ${style_profile.profile.sentence_structure || ''}
SIGNATURE MOVES: ${style_profile.profile.signature_moves || ''}
NEVER DO: ${style_profile.profile.forbidden || ''}
</writing_style_profile>
` : '';

    const systemPrompt = `You are an expert content writer and brand voice specialist.

<brand_voice>
${brand_voice || '{"voice": "Professional yet approachable"}'}
</brand_voice>

<tone>
${tone || 'professional'}
</tone>
${styleProfileBlock}
${special_instructions ? `<special_instructions>\n${special_instructions}\n</special_instructions>\n` : ''}
${style_profile?.profile ? `The writing style profile above is CRITICAL. Every sentence must authentically reflect the voice, tone, sentence structure and signature moves described. Readers should feel they are reading content written in that specific style.` : `The brand voice, tone, and special instructions above are MANDATORY. They override any default writing tendencies you have. Before writing, internalise them completely — every sentence must reflect them.`}`;

    // Debug — log whether style profile is being applied
    if (style_profile?.profile) {
        console.log(`[generate] Style profile active: "${style_profile.name}"`);
        console.log(`[generate] Style profile voice: ${style_profile.profile.voice?.substring(0, 80)}...`);
    } else {
        console.log('[generate] No style profile active — using brand voice only');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: TEXT_MODEL,
            max_tokens: maxTokensFor(activeContentType),
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    // Cost instrumentation: capture the real token usage + stop_reason onto the
    // shared context BEFORE any further processing can throw, so the cost row is
    // accurate even when a later step (upload, publish) fails. Failed API calls
    // never reach here and aren't billed — text cost is genuinely 0 for those.
    if (costCtx) {
        costCtx.model       = TEXT_MODEL;
        costCtx.usage       = data?.usage || null;
        costCtx.stop_reason = data?.stop_reason || null;
    }
    if (data?.stop_reason === 'max_tokens') {
        // Hit the token ceiling — output is truncated. With per-type max_tokens this
        // should be rare; log loudly so it's visible in Railway rather than shipping
        // a half-finished article (or, for quiz/assessment, unparseable JSON).
        console.warn(`[generate] ⚠ TRUNCATED: stop_reason=max_tokens for type="${activeContentType}" (target ${effectiveWordCount}w, budget ${maxTokensFor(activeContentType)} tok). Output is incomplete.`);
    }
    const text = data?.content?.map(b => b.text || '').join('');
    if (!text) throw new Error('Empty response from Anthropic API');
    return text;
}

/**
 * Best-effort progress beacon to WordPress. Never throws — a missed stage
 * update must never affect generation. Used to drive the live status UI.
 */
async function postStage(domain, { title, post_id, stage }, secret) {
    try {
        await fetch(`https://${domain}/wp-json/ai-content/v1/generation-stage`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-generate-secret': secret },
            body:    JSON.stringify({ title, post_id: post_id || 0, stage }),
        });
    } catch (e) {
        console.warn('[generate] stage beacon failed (non-fatal):', e.message);
    }
}

/**
 * POST the completed generation back to the WordPress /publish endpoint.
 */
/**
 * Upload image to WordPress via the plugin's own /upload-image REST endpoint.
 * No WordPress credentials needed — the endpoint is secured by the generate secret.
 * Returns attachment ID or null on failure.
 */
async function uploadImageToWordPress(domain, imageBase64, title, postId, generateSecret) {
    if (!imageBase64) return null;

    try {
        console.log(`[generate] Uploading image via /upload-image endpoint...`);

        const res = await fetch(`https://${domain}/wp-json/ai-content/v1/upload-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-generate-secret': generateSecret || '',
            },
            body: JSON.stringify({
                image_b64: imageBase64,
                title:     title || 'featured-image',
                post_id:   postId || 0,
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.warn(`[generate] /upload-image failed (${res.status}):`, err.substring(0, 200));
            return null;
        }

        const data = await res.json();
        if (data?.success && data?.attachment_id) {
            console.log(`[generate] Image uploaded: attachment_id=${data.attachment_id}`);
            return data.attachment_id;
        }

        console.warn('[generate] /upload-image unexpected response:', JSON.stringify(data).substring(0, 200));
        return null;
    } catch (err) {
        console.warn('[generate] /upload-image error:', err.message);
        return null;
    }
}

async function postToWordPress(domain, publishPayload, generateSecret, attempt = 1) {
    const url = `https://${domain}/wp-json/ai-content/v1/publish`;

    console.log(`[generate] Posting to WordPress: ${url} (attempt ${attempt})`);
    console.log(`[generate] Payload keys: ${Object.keys(publishPayload).join(', ')}`);
    console.log(`[generate] content length: ${(publishPayload.content || '').length}, post_id: ${publishPayload.post_id}`);

    try {
        const res = await fetch(url, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-generate-secret': generateSecret || '',
            },
            body:    JSON.stringify(publishPayload),
        });

        const responseText = await res.text();
        console.log(`[generate] WordPress /publish response: ${res.status} — ${responseText.substring(0, 200)}`);

        if (!res.ok) {
            throw new Error(`WordPress publish failed (${res.status}): ${responseText}`);
        }

        try { return JSON.parse(responseText); }
        catch { return { success: true }; }

    } catch (err) {
        // Retry once after a 3s delay before giving up
        if (attempt < 2) {
            console.warn(`[generate] WordPress /publish attempt ${attempt} failed — retrying in 3s: ${err.message}`);
            await new Promise(r => setTimeout(r, 3000));
            return postToWordPress(domain, publishPayload, generateSecret, attempt + 1);
        }
        throw err;
    }
}

// ─── main route ─────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
    const startTime = Date.now();

    // Optional shared secret check — set GENERATE_SECRET in Railway env
    const secret = process.env.GENERATE_SECRET;
    if (secret && req.headers['x-generate-secret'] !== secret) {
        return res.status(401).json({ success: false, error: 'Unauthorised' });
    }

    const {
        license_key,
        domain,
        title,
        primary_keyword,
        target_word_count,
        special_instructions,
        brand_voice,
        tone,
        image_style,
        image_prompt,
        include_youtube,
        include_image,
        mailpoet_list_id,
        tnp_list_id,
        tec_start_date,
        tec_end_date,
        tec_cost,
        tec_url,
        tec_venue,
        tec_organiser,
        post_id,
        post_type,
        acf_field_key,
        style_profile,
        content_type,
        content_type_meta,
        // LMS integration
        lms_type,
        lms_course_id,
        lms_lesson_id,
        lms_section_id,
        ld_post_type,
        // SEO outline-review flow (optional)
        approved_outline,
        serp_gl,
        serp_hl,
        // Round-tripped back to /publish so WordPress matches the exact diary entry
        entry_id,
    } = req.body;

    // Basic validation
    if (!license_key || !domain || !title) {
        return res.status(400).json({
            success: false,
            error: 'license_key, domain, and title are required'
        });
    }

    const activeContentType = content_type || 'blog_post';
    const typeCredits = (CONTENT_TYPES[activeContentType]?.credits) || 2;
    const imageCredits = (include_image === true || include_image === 'true') ? 1 : 0;
    const credits = typeCredits + imageCredits;

    console.log(`[generate] START — "${title}" | domain: ${domain} | credits: ${credits}`);

    // ── Step 1: validate license + check credits ───────────────────────────
    let licenseId;
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

        // Normalise tier — DB may store as 'Agency', 'AGENCY', 'agency_plan' etc.
        const rawTier = (lic.tier || '').toString().toLowerCase().trim();
        let normTier = 'free';
        if (rawTier.includes('agency')) normTier = 'agency';
        else if (rawTier.includes('pro'))     normTier = 'pro';
        else if (rawTier.includes('starter')) normTier = 'starter';
        lic.tier = normTier;
        console.log(`[generate] License tier: raw="${rawTier}" normalised="${normTier}"`);

        if (parseInt(lic.credits_remaining) < credits) {
            return res.status(402).json({ success: false, error: 'Insufficient credits', credits_remaining: parseInt(lic.credits_remaining) });
        }

        // Check content type is accessible on this tier
        if (!canAccessContentType(activeContentType, lic.tier)) {
            return res.status(403).json({
                success: false,
                error: `The "${activeContentType}" content type is not available on your current plan. Please upgrade to access it.`,
                code: 'content_type_locked',
            });
        }

        licenseId = lic.id;
    } catch (err) {
        console.error('[generate] License check failed:', err.message);
        return res.status(500).json({ success: false, error: 'License validation error' });
    }

    // ── Step 2: deduct credits atomically ─────────────────────────────────
    const client = await pool.connect();
    let allocations = null;
    let usageLogId  = null;

    try {
        await client.query('BEGIN');
        const deduction = await deductCredits(client, license_key, credits, domain, title, activeContentType, style_profile?.name || null);

        if (!deduction.success) {
            await client.query('ROLLBACK');
            return res.status(402).json({ success: false, error: deduction.error });
        }

        allocations = deduction.allocations;
        usageLogId  = deduction.usage_log_id;
        await client.query('COMMIT');
        creditsCache.invalidate(license_key); // balance changed — next /credits poll reads fresh
        console.log(`[generate] Deducted ${credits} credits across ${allocations.length} batch(es)`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[generate] Credit deduction failed:', err.message);
        return res.status(500).json({ success: false, error: 'Credit deduction failed' });
    } finally {
        client.release();
    }

    // Respond immediately so WordPress doesn't time out — generation continues async
    res.json({ success: true, message: 'Generation started', credits_deducted: credits });

    // ── Steps 3-6: generation pipeline (async after response) ─────────────
    let imageBase64 = null;
    let youtubeVideos = [];
    let articleText = '';

    // Cost instrumentation context — mutated as the pipeline progresses so
    // whatever provider spend happened before a throw is still captured. The
    // cost row is attached to THIS attempt's usage_logs row (usageLogId) in
    // both the success and failure paths below.
    const costCtx = { model: null, usage: null, stop_reason: null, serpCalls: 0 };

    try {
        // Kick off all three independent steps at once. Content is the long pole
        // and is fatal (its rejection must surface), so we start it here and await
        // it after the best-effort image/YouTube steps settle. Net wall-clock is
        // max(content, image, youtube) instead of the old image-then-content sum.
        postStage(domain, { title, post_id, stage: 'writing' }, process.env.GENERATE_SECRET || '');
        console.log('[generate] Starting content + image + YouTube concurrently...');

        const contentPromise = generateContent({
            title, primary_keyword, target_word_count,
            special_instructions, brand_voice, tone, style_profile,
            content_type, content_type_meta,
            approved_outline, serp_gl, serp_hl,
        }, costCtx);
        // Attach a handler immediately. generateContent can reject *before* its first
        // await (a missing config value, a synchronous throw). Because we await the
        // best-effort image/YouTube steps below before awaiting contentPromise, such a
        // fast rejection would otherwise be flagged as an unhandled rejection and crash
        // the process (this whole pipeline runs after res.json, so nothing else catches
        // it). The no-op handler defuses that; real handling still happens at the await.
        contentPromise.catch(() => {});

        let ytResults = [], imgResult = null;
        try {
            [ytResults, imgResult] = await Promise.all([
                include_youtube ? searchYouTube(title).catch(() => []) : Promise.resolve([]),
                include_image !== false ? generateImage(title, image_prompt, image_style, serp_gl).catch(() => null) : Promise.resolve(null),
            ]);
        } catch (parallelErr) {
            console.warn('[generate] Parallel step error (non-fatal):', parallelErr.message);
        }

        youtubeVideos = ytResults;
        imageBase64   = imgResult;
        console.log(`[generate] YouTube: ${youtubeVideos.length} results | Image: ${include_image === false ? 'SKIPPED (include_image=false)' : imageBase64 ? 'OK (' + Math.round(imageBase64.length/1024) + 'KB b64)' : 'failed'}`);

        // Await the article (throws on failure → outer catch → refund + 'failed')
        const rawArticleText = await contentPromise;
        console.log(`[generate] Article generated (${rawArticleText.length} chars)`);

        // For quiz content types, extract structured quiz data from Claude's response
        let quizData = null;
        if (activeContentType === 'quiz_assessment') {
            const parsed = parseQuizData(rawArticleText);
            quizData    = parsed.quizData;
            articleText = parsed.cleanContent;
            console.log(`[generate] Quiz data extracted: ${quizData ? quizData.questions?.length + ' questions' : 'not found — will use markdown only'}`);
        } else {
            articleText = rawArticleText;
        }

        // ── SEO score ─────────────────────────────────────────────────────
        // Deterministic, dependency-free. Runs on every content type. Parses
        // the SEO_DATA block Claude emitted, then scores the article against it.
        let seoReport = null;
        try {
            const seoMeta = parseSeoBlock(rawArticleText);
            seoReport = scoreSeo({
                content:         articleText,
                title,
                metaTitle:       seoMeta.metaTitle,
                metaDescription: seoMeta.metaDescription,
                focusKeyword:    seoMeta.focusKeyword || primary_keyword || title,
                targetWordCount: resolveTargetWords(activeContentType, target_word_count) || 600,
                hasImage:        !!imageBase64,
                videoCount:      youtubeVideos.length,
            });
            console.log(`[generate] SEO score ${seoReport.score}/100 (${seoReport.grade})`);
        } catch (e) {
            console.warn('[generate] SEO scoring skipped (non-fatal):', e.message);
        }

        // Upload image to WordPress via the plugin's /upload-image endpoint
        // No WP credentials needed — secured by the shared generate secret
        let featuredImageId = null;
        if (imageBase64) {
            featuredImageId = await uploadImageToWordPress(
                domain,
                imageBase64,
                title,
                post_id || 0,
                process.env.GENERATE_SECRET || ''
            );
        }

        // Build publish payload
        const publishPayload = {
            title,
            content: articleText,
            status: 'draft',
            // Exact diary entry that requested this — WordPress matches on it first
            // so a duplicate title can't attach the result to the wrong entry.
            entry_id:           entry_id   || null,
            post_id:            post_id    || null,
            post_type:          post_type  || 'post',
            acf_field_key:      acf_field_key || '',
            // Content type — REQUIRED by the WordPress publish handler to route to
            // the correct integration (MailPoet/TNP newsletters, TEC events, the
            // training-module knowledge-check auto-quiz). Without it those gates
            // all fail silently and the content lands as a plain post.
            content_type:       activeContentType,
            content_type_meta:  content_type_meta || {},
            ai_model:           TEXT_MODEL,
            image_model:        IMAGE_MODEL,
            credits_used:       credits,
            execution_time:     Math.round((Date.now() - startTime) / 1000),
            include_youtube:    !!include_youtube,
            image_style:        image_style || 'professional',
            // Send attachment ID — PHP sets it as featured image directly
            featured_image_attachment_id: featuredImageId || null,
            // YouTube results
            youtube_video:      youtubeVideos[0] || '',
            youtube_video_2:    youtubeVideos[1] || '',
            youtube_video_3:    youtubeVideos[2] || '',
            // LMS integration — pass through to WordPress publish handler
            lms_type:           lms_type        || '',
            lms_course_id:      lms_course_id   || 0,
            lms_lesson_id:      lms_lesson_id   || 0,
            lms_section_id:     lms_section_id  || 0,
            ld_post_type:       ld_post_type    || '',
            // Structured quiz data (null for non-quiz content types)
            quiz_data:          quizData        || null,
            // SEO score + checklist (null if scoring failed)
            seo_score:          seoReport ? seoReport.score : null,
            seo_grade:          seoReport ? seoReport.grade : null,
            seo_report:         seoReport       || null,
            mailpoet_list_id:   mailpoet_list_id || 0,
            tnp_list_id:        tnp_list_id      || 0,
            tec_start_date:     tec_start_date   || '',
            tec_end_date:       tec_end_date     || '',
            tec_cost:           tec_cost         || '',
            tec_url:            tec_url          || '',
            tec_venue:          tec_venue        || '',
            tec_organiser:      tec_organiser    || '',
        };

        await postStage(domain, { title, post_id, stage: 'publishing' }, process.env.GENERATE_SECRET || '');
        await postToWordPress(domain, publishPayload, process.env.GENERATE_SECRET || '');
        console.log(`[generate] COMPLETE — "${title}" in ${publishPayload.execution_time}s`);

        // ── Cost instrumentation: stamp this attempt's true provider cost ──
        // Image is only charged when a b64 actually came back (failed image
        // calls return null and aren't billed). Best-effort by contract.
        await costLog.attachCost(pool, usageLogId, {
            model:       costCtx.model,
            usage:       costCtx.usage,
            stop_reason: costCtx.stop_reason,
            image:       imageBase64 ? { model: IMAGE_MODEL, size: IMAGE_SIZE, quality: IMAGE_QUALITY } : null,
            serpCalls:   costCtx.serpCalls,
            costEvent:   'generate',
            succeeded:   true,
            generationSeconds: publishPayload.execution_time,
        });

    } catch (err) {
        console.error(`[generate] Pipeline failed for "${title}":`, err.message);
        console.error(`[generate] Stack:`, err.stack);

        // Refund credits on failure. This MUST NOT throw out of the catch — the
        // pipeline runs after res.json(), so an escaping rejection here is unhandled
        // and crashes the process, stranding the entry on 'generating'.
        if (allocations) {
            try {
                await creditLedger.refundSpanning(pool, allocations);
                creditsCache.invalidate(license_key); // balance restored — drop the stale cached value
            } catch (refundErr) {
                console.error('[generate] Refund failed (non-fatal, manual review):', refundErr.message);
            }
        }

        // Notify WordPress of the failure so the entry shows 'failed' status
        try {
            await postToWordPress(domain, {
                title,
                post_id:    post_id || null,
                status:     'failed',
                error:      err.message,
                post_type:  post_type || 'post',
            }, process.env.GENERATE_SECRET || '');
        } catch (notifyErr) {
            console.error('[generate] Failed to notify WordPress of error:', notifyErr.message);
        }

        // ── Cost instrumentation: the failure path still cost real money ──
        // The refund above returned the CUSTOMER's credits; it did not refund
        // what we paid Anthropic/OpenAI/Serper before the throw. Record it as
        // succeeded=false so the admin's waste metric sees it. costCtx holds
        // whatever was captured before the failure (tokens null if the
        // Anthropic call itself failed — those aren't billed). attachCost
        // never throws (see lib/cost-log.js) — safe inside this catch.
        await costLog.attachCost(pool, usageLogId, {
            model:       costCtx.model,
            usage:       costCtx.usage,
            stop_reason: costCtx.stop_reason,
            image:       imageBase64 ? { model: IMAGE_MODEL, size: IMAGE_SIZE, quality: IMAGE_QUALITY } : null,
            serpCalls:   costCtx.serpCalls,
            costEvent:   'generate',
            succeeded:   false,
            generationSeconds: Math.round((Date.now() - startTime) / 1000),
        });
    }
});

module.exports = router;