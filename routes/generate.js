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
 *  6. POST results back to the plugin /publish route (aicobr/v1, legacy fallback)
 *  7. On any failure after credit deduction — refund credits
 *
 * Environment variables required (set in Railway):
 *   ANTHROPIC_API_KEY
 *   OPENAI_API_KEY
 *   YOUTUBE_API_KEY
 *   GENERATE_SECRET   (shared secret WordPress sends to authenticate requests)
 */

const { wpFetch } = require('../lib/wp-endpoint');
const { requireGenerateSecret } = require('../lib/require-generate-secret');
const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const { CONTENT_TYPES, canAccessContentType, buildPrompt, resolveTargetWords, maxTokensFor } = require('../content-types');
const { scoreSeo, parseSeoBlock } = require('../lib/seo-score');
// AICOBR_INBODY_IMAGES_2026_08 — shared definition of an in-body image
// suggestion. Used here (free, emitted alongside the SEO block by the model
// that just wrote the article) and by routes/image-suggestions.js for the
// retroactive case. Suggestions are DESCRIPTIONS only: nothing here generates
// an image or spends a credit.
const imageSuggestions = require('../lib/image-suggestions');
const serp = require('../lib/serp');
const creditsCache = require('../lib/credits-cache');
const creditLedger = require('../lib/credit-ledger');
const costLog = require('../lib/cost-log');
const { fetchWithRetry } = require('../lib/http-retry');

// The one text model this route uses. The image model/size/quality and the
// tier-gated policy now live in lib/image-gen.js so /api/generate and
// /api/regenerate-image share ONE source of truth (the free→mini decision can
// never diverge between them). Changing the text model here REQUIRES a matching
// entry in lib/pricing.js (an unknown key prices as null and logs loudly — see
// cost instrumentation); the same rule holds for the image keys in image-gen.js.
const TEXT_MODEL  = 'claude-sonnet-4-6';

// Image concerns (policy + OpenAI generation + WP upload) are shared with the
// image-only regeneration route via lib/image-gen.js — extracted verbatim so
// both routes resolve the identical tier→policy map. IMAGE_MODEL is still used
// below only as a defensive fallback in the publish payload.
const {
    IMAGE_MODEL,
    imagePolicyFor,
    generateImage,
    uploadImageToWordPress,
} = require('../lib/image-gen');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Global cap on concurrent generation pipelines for THIS instance. Normal load
// never touches it; it only engages during a burst (e.g. an influencer video)
// to stop hundreds of Claude/OpenAI/Serper calls and base64 images running at
// once. Tune with GENERATE_MAX_CONCURRENCY; default 10.
const { ConcurrencyGate } = require('../lib/concurrency-gate');
const generationGate = new ConcurrencyGate(process.env.GENERATE_MAX_CONCURRENCY || 10);

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

// generateImage() and localeClause() now live in lib/image-gen.js (imported at
// the top of this file) so the image-only regeneration route shares them.

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
        cluster_pillar,
        suggestion_count,
        source_content,   // AICOBR_REFRESH_2026_08 — the existing post being refreshed
    } = payload;

    // Build the user prompt using the content type template
    const activeContentType = content_type || 'blog_post';
    // Resolve the requested word count into this type's length band (clamped,
    // with a global backstop). Used for the prompt, max_tokens, and SEO scoring.
    const effectiveWordCount = resolveTargetWords(activeContentType, target_word_count);
    let userPrompt = buildPrompt(activeContentType, title, primary_keyword, effectiveWordCount, content_type_meta);
    console.log(`[generate] Content type: ${activeContentType}`);

    // ── In-body image suggestions (AICOBR_INBODY_IMAGES_2026_08) ────────────
    // Appended AFTER the type's own prompt (which ends with the SEO block
    // instruction) so the model emits it last, exactly like ---SEO_DATA---.
    // Returns '' when the count is 0, so ineligible types and opted-out runs
    // concatenate nothing. This costs a few hundred output tokens on a call we
    // are already making — there is no second request and no credit.
    const suggestionBlock = imageSuggestions.buildSuggestionBlock(suggestion_count);
    if (suggestionBlock) {
        userPrompt += suggestionBlock;
        console.log(`[generate] Requesting ${suggestion_count} in-body image suggestion(s)`);
    }

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

    // AICOBR_STYLE_TINT_2026_09 — a style profile reaches the model in the system
    // prompt, but the large SEO/structure brief in this user turn otherwise pulls the
    // prose back to a neutral blog voice. Re-assert the voice as the LAST thing the
    // model reads (its highest-weight position), and reconcile it with the answer-shape
    // and readability rules so the voice expresses WITHIN the SEO structure rather than
    // being flattened out. "Tint" mode: keep the shape, strengthen the voice inside it.
    if (style_profile?.profile) {
        userPrompt += `

---

**VOICE — read this last; it governs how every sentence sounds.**
Write this entire article in the voice defined by the <writing_style_profile> in the system prompt (${style_profile.name || 'the active profile'}): its voice, tone, sentence rhythm and signature moves. That distinctive voice is the point of this piece; a reader should recognise it from the first line.

Keep every structural and SEO rule above: the outline, the answer-first ordering, the Key Takeaways, the FAQ, the heading structure and the SEO_DATA block. Deliver them in this voice rather than a neutral generic-blog voice:
- Answer-first still applies, but write that opening answer IN this voice; do not flatten it into bland "plain language".
- Keep it readable, but readability is a goal, not a cap: when it conflicts with the voice, the voice wins over hitting a readability score.
- Headings, Key Takeaways and FAQ answers should sound like this voice too, not like a neutral template.
Structure it exactly as the rules above require; phrase every sentence as this voice would.`;
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

    // ── Internal linking (topic clusters) ───────────────────────────────────
    // AICOBR_CLUSTER_PILLAR_2026_08
    //
    // This article was planned by the Content Strategist as a SPOKE supporting an
    // existing page on the user's site (the "pillar"). That page already exists and
    // already has a URL, so the link can be written into the prose AS THE ARTICLE IS
    // WRITTEN — no post-processing, no second API call, no credit cost, and the anchor
    // text lands in a real sentence instead of a bolted-on "read more" list.
    //
    // The constraints below are load-bearing, not politeness:
    //   - "exactly once" — without it the model sprays the link through every section
    //   - "no list/related block" — without it it appends a link farm at the end,
    //     which is precisely the generic output this feature exists to beat
    //   - "no other internal links" — the model will otherwise invent plausible-looking
    //     internal URLs for pages that do not exist, producing 404s
    //   - "mid-article" — a link in the intro reads as an ad; buried in the body it
    //     reads as a reference, which is also where it carries more SEO weight
    const pillarUrl   = String(cluster_pillar?.url   || '').trim();
    const pillarTitle = String(cluster_pillar?.title || '').trim();
    const hasPillar   = /^https?:\/\//i.test(pillarUrl) && pillarTitle.length > 0;

    const internalLinkBlock = hasPillar ? `
<internal_link>
This article supports an existing page on the same website:
  Page title: ${pillarTitle}
  Page URL:   ${pillarUrl}

Link to that page EXACTLY ONCE, somewhere in the middle of the article, using
MARKDOWN link syntax: [natural anchor text](${pillarUrl})

Rules:
- Use markdown link syntax, NOT an HTML <a> tag. Raw HTML anchors are escaped by
  the publishing pipeline and will render as visible broken markup.
- The anchor text must be descriptive words that fit the sentence naturally.
  Never "click here", "this page", "read more", or the bare URL.
- The link must sit inside a normal body paragraph, at the point where a reader
  would genuinely want it. Do not put it in the introduction or the conclusion.
- Do NOT add a "related articles", "read next", "further reading" or similar
  list or section anywhere in the article.
- Do NOT link to any other internal page. You do not know what other pages exist
  on this site, and inventing internal URLs creates broken links.
- Do not mention that you were instructed to add a link.
</internal_link>
` : '';

    if (hasPillar) {
        console.log(`[generate] Cluster spoke — linking up to pillar: ${pillarTitle} (${pillarUrl})`);
    }

    // ── Refresh: improve an existing article (AICOBR_REFRESH_2026_08) ─────────
    // When source_content is present this is a REFRESH, not a fresh write. The
    // SERP-grounded outline/template above still defines the TARGET; the block
    // below is the BASE to improve. Framed as improvement so the model updates
    // and completes the real article rather than producing a look-alike, and so
    // it preserves the elements that earn (shortcodes, tables, links, specifics).
    const sourceContent = String(source_content || '').trim();
    const refreshBlock = sourceContent ? `
<existing_article_to_improve>
This is a REFRESH of an article that is already published. Your task is NOT to write a brand-new article — it is to produce an improved, updated, more complete and more competitive version of the article below, using the outline/structure above as the target shape.

How to refresh it well:
- Keep the SUBSTANCE that works: the accurate facts, the useful specifics, the real examples, the data, and the topic stance the article takes.
- PRESERVE every shortcode (e.g. [content_featured_image] and other [bracketed] tags), table, embed and link exactly as written unless it is clearly wrong — these often earn money or perform a function, and losing them is the worst outcome of a refresh. This includes internal links to other pages on the same site: keep every existing <a href> exactly as written, anchor text and target both, because they hold the site's internal linking together.
- Keep the important entities, product names, brand names and specific numbers that appear below; do not drift onto a different subject.
- Improve it: update anything dated, add the depth and fill the gaps the SERP outline identifies that this article currently misses, tighten weak or padded writing, and strengthen thin sections.
- VOICE — this is not optional: the original's writing style is NOT a template to copy. Rewrite the whole article in the brand voice and writing style profile given above. Do not imitate the original's phrasing, sentence rhythm or punctuation habits, and do not fall back on generic AI mannerisms — in particular, do not pepper the text with em dashes unless the style profile explicitly calls for them. The article below is your source of facts and structure; the voice comes entirely from the style instructions above.
- The result should read as a clearly better version of THIS article's content, written in the specified voice — not a stylistic copy of its prose.

CURRENT ARTICLE:
${sourceContent}
</existing_article_to_improve>
` : '';
    if (sourceContent) {
        console.log(`[generate] Refresh mode — improving existing article (${sourceContent.length} chars of source)`);
    }

    // AICOBR_STYLE_TINT_2026_09 — when a style profile is active it is the sole voice
    // authority. A generic <brand_voice>/<tone> above it (the "Professional yet
    // approachable" default, or a neutral configured voice) contradicts the profile
    // and, printed first, tends to win. Suppress them while a profile is active; keep
    // them as the voice source when there is no profile.
    const voiceContextBlock = style_profile?.profile ? '' : `<brand_voice>
${brand_voice || '{"voice": "Professional yet approachable"}'}
</brand_voice>

<tone>
${tone || 'professional'}
</tone>
`;

    const systemPrompt = `You are an expert content writer and brand voice specialist.

${voiceContextBlock}${styleProfileBlock}
${special_instructions ? `<special_instructions>\n${special_instructions}\n</special_instructions>\n` : ''}${refreshBlock}${internalLinkBlock}
${style_profile?.profile ? `The writing style profile above is CRITICAL. Every sentence must authentically reflect the voice, tone, sentence structure and signature moves described. Readers should feel they are reading content written in that specific style.` : `The brand voice, tone, and special instructions above are MANDATORY. They override any default writing tendencies you have. Before writing, internalise them completely — every sentence must reflect them.`}${sourceContent ? `

This is a REFRESH: improve the CONTENT of the <existing_article_to_improve> article — update it, complete it, keep its earning elements and specifics — but write it entirely in the voice and style specified above, NOT in the original's voice and NOT in a generic AI voice. Improve the substance; own the style. Do not merely reformat the original.` : ''}${hasPillar ? `

The <internal_link> instruction is MANDATORY and must be followed exactly once. It does not override the brand voice — the link must read as a natural part of the writing.` : ''}`;

    // Debug — log whether style profile is being applied
    if (style_profile?.profile) {
        console.log(`[generate] Style profile active: "${style_profile.name}"`);
        console.log(`[generate] Style profile voice: ${style_profile.profile.voice?.substring(0, 80)}...`);
    } else {
        console.log('[generate] No style profile active — using brand voice only');
    }

    // This call is the one fatal step in the pipeline — image/YouTube/SERP all
    // fail soft, but a throw here aborts the run after credits are already
    // deducted. It therefore gets bounded retry on transient network failures
    // and on 429/5xx/529. See lib/http-retry.js for the billing trade-off.
    //
    // Budget: the plugin flags an entry as stuck after 12 minutes, and retries
    // run while this request holds a ConcurrencyGate permit, so the whole
    // sequence is capped well inside that window. A fast-failing connection
    // error (the DNS/egress case) retries freely; a call that hangs for the
    // full per-attempt timeout is not retried into a second hang.
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: TEXT_MODEL,
            // Budget includes the suggestion block's output allowance, so asking
            // for suggestions can never truncate the article itself.
            max_tokens: maxTokensFor(activeContentType, suggestion_count),
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
    }, {
        label:         'generate:anthropic',
        attempts:      3,
        timeoutMs:     300000,  // 5 min/attempt — a 16k-token non-streaming reply is well inside this
        totalBudgetMs: 540000,  // 9 min total, leaving headroom before the plugin's 12-min stuck reset
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
        console.warn(`[generate] ⚠ TRUNCATED: stop_reason=max_tokens for type="${activeContentType}" (target ${effectiveWordCount}w, budget ${maxTokensFor(activeContentType, suggestion_count)} tok). Output is incomplete.`);
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
        await wpFetch(domain, '/generation-stage', {
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
 * (uploadImageToWordPress now lives in lib/image-gen.js, imported at the top.)
 */
async function postToWordPress(domain, publishPayload, generateSecret, attempt = 1) {
    console.log(`[generate] Posting to WordPress ${domain} /publish (attempt ${attempt})`);
    console.log(`[generate] Payload keys: ${Object.keys(publishPayload).join(', ')}`);
    console.log(`[generate] content length: ${(publishPayload.content || '').length}, post_id: ${publishPayload.post_id}`);

    try {
        const res = await wpFetch(domain, '/publish', {
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
    // AICOBR_FAILCLOSED_SECRET_2026_08 — fail closed (was: skipped when unset)
    if (!requireGenerateSecret(req, res)) return;

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
        // AICOBR_CLUSTER_PILLAR_2026_08 — resolved plugin-side from the diary
        // entry (never sent by the browser) and used to write a contextual
        // internal link up to the pillar page as the article is generated.
        cluster_pillar,
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
        // AICOBR_INBODY_IMAGES_2026_08 — opt-in. When true the article prompt
        // asks the model to ALSO return descriptions for in-body images it
        // would suggest. No image is generated and no extra credit is charged;
        // the user picks one later in the image modal, which is where the
        // 1-credit generation happens.
        suggest_images,
        image_suggestion_count,
        // AICOBR_REFRESH_2026_08 — original post body sent by the plugin on a refresh.
        // Was never read here, so the refresh block in generateContent (style-precedence
        // over the original's voice + "improve, don't reformat") never fired.
        source_content,
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
    let licenseTier = 'free'; // resolved from the licence below; drives the image policy
    try {
        const licResult = await pool.query(`
            SELECT lk.id, lk.tier, lk.status, lk.registered_domain,
                   COALESCE(SUM(cb.credits_remaining), 0) AS credits_remaining,
                   COALESCE(SUM(cb.credits_remaining) FILTER (WHERE cb.notes = 'free_tier_initial'), 0) AS trial_remaining
            FROM license_keys lk
            LEFT JOIN credit_batches cb
                ON cb.license_key_id = lk.id AND cb.expiry_date > CURRENT_DATE
            WHERE lk.license_key = $1 AND lk.status = 'active'
            GROUP BY lk.id, lk.tier, lk.status, lk.registered_domain
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
        licenseTier = normTier; // handler-scoped copy for the async image policy below
        console.log(`[generate] License tier: raw="${rawTier}" normalised="${normTier}"`);

        // ── Free-tier domain lock enforcement (ACB_FREE_DOMAIN_LOCK_GENERATE_2026_07_18) ──
        // The lock is written at email verification (verify-email.js) but was previously
        // enforced ONLY in /api/validate — a route the shipped plugin never calls — so a
        // free key generated on any domain. Enforce it here on the real generation path,
        // mirroring validate.js: first use locks, thereafter the domain must match.
        // Free tier only; paid keys are not domain-locked. Runs BEFORE any credit
        // deduction, so a rejection never costs the customer a credit or a refund.
        // Kill-switch: set env ACB_FREE_DOMAIN_LOCK=off to disable without a redeploy.
        if (lic.tier === 'free' && process.env.ACB_FREE_DOMAIN_LOCK !== 'off') {
            const incomingDomain = (domain || '').trim().toLowerCase()
                .replace(/^https?:\/\//, '').replace(/\/$/, '');

            if (!lic.registered_domain) {
                // First use — lock now (backstop; verify-email normally sets this at
                // activation). The WHERE ... IS NULL guard makes a concurrent first
                // generate idempotent rather than racing two writes.
                if (incomingDomain) {
                    await pool.query(
                        `UPDATE license_keys
                         SET registered_domain = $2, domain_locked_at = NOW()
                         WHERE id = $1 AND registered_domain IS NULL`,
                        [lic.id, incomingDomain]
                    );
                    console.log(`[generate] Free licence domain locked on first use: ...${license_key.slice(-6)} -> ${incomingDomain}`);
                }
            } else if (lic.registered_domain.toLowerCase() !== incomingDomain) {
                console.warn(`[generate] DOMAIN_MISMATCH: key ...${license_key.slice(-6)} locked to ${lic.registered_domain}, request from ${incomingDomain || '(none)'}`);
                return res.status(403).json({
                    success: false,
                    error:  `This free licence is registered to ${lic.registered_domain}. To move it to a new domain please contact support@aicontentbridge.com.`,
                    code:   'DOMAIN_MISMATCH',
                });
            }
        }

        if (parseInt(lic.credits_remaining) < credits) {
            return res.status(402).json({ success: false, error: 'Insufficient credits', credits_remaining: parseInt(lic.credits_remaining) });
        }

        // ── Content-type access (AICOBR_AGENCY_TRIAL_2026_08) ─────────────
        // Free licences start with 10 "Agency credits" (the free_tier_initial
        // batch): while that batch has balance, every content type is open.
        // The ledger spends soonest-expiry-first, so the 1-year trial batch is
        // always consumed before never-expiring bundle credits — the trial
        // therefore ends exactly when its own 10 credits are spent. Once
        // spent, the real tier gates return (free = Blog Post only; bundle
        // credits on free remain blog-only by design). ACF stays gated on the
        // ACTUAL tier above — the trial opens types, not Pro features.
        const trialActive = lic.tier === 'free' && parseInt(lic.trial_remaining) > 0;
        const typeTier    = trialActive ? 'agency' : lic.tier;
        if (!canAccessContentType(activeContentType, typeTier)) {
            const freeMsg = `Your 10 trial credits included every content type — on the free plan, "${activeContentType}" needs an upgrade. Blog Post is still available, and any bundle credits you buy generate Blog Posts.`;
            return res.status(403).json({
                success: false,
                error: lic.tier === 'free' ? freeMsg : `The "${activeContentType}" content type is not available on your current plan. Please upgrade to access it.`,
                code: 'content_type_locked',
            });
        }

        // ── Service-side plan enforcement (AICOBR_SERVER_ENFORCED_2026_07_13) ──
        // As of plugin 2.8.1 the client UI no longer pre-filters these request
        // params by plan (WP.org Guideline 5 — no local tier gating), so the
        // service is the single enforcer. Both checks run BEFORE any credit
        // deduction and return messages the plugin UI surfaces verbatim.
        if (acf_field_key && !['pro', 'agency'].includes(lic.tier)) {
            return res.status(403).json({
                success: false,
                error: 'ACF Field Targeting is available on the Pro and Agency plans. Remove the ACF target field or upgrade your plan to generate into custom fields.',
                code: 'acf_locked',
            });
        }
        // AICOBR_YOUTUBE_FREE_2026_08: the free-tier YouTube gate that used to
        // sit here is removed — video embeds are available on all tiers. It was
        // also a UX trap: the plugin can't pre-filter by plan (WP.org Guideline
        // 5), and /outline runs before /generate, so free users only saw the
        // rejection AFTER investing in the outline step. YouTube search is
        // near-zero marginal cost (Data API quota, no AI spend), so credits
        // remain the only constraint.

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

    // Resolve the image config for this licence tier once (free -> mini). Used
    // for the API call AND the cost row, so they can never disagree.
    const imagePolicy = imagePolicyFor(licenseTier);

    // Wait for a free generation slot before the expensive AI fan-out. WordPress
    // already has its "started" response above, so queuing here is invisible to
    // the caller — it just means, under a burst, this pipeline starts a moment
    // later instead of piling onto hundreds of concurrent upstream calls. At
    // normal load a slot is always free and this resolves instantly.
    const gateState = generationGate.stats();
    if (gateState.active >= gateState.limit) {
        console.log(`[generate] concurrency cap reached (${gateState.active}/${gateState.limit}) — "${title}" queued behind ${gateState.queued} other(s)`);
    }
    await generationGate.acquire();

    try {
        // Kick off all three independent steps at once. Content is the long pole
        // and is fatal (its rejection must surface), so we start it here and await
        // it after the best-effort image/YouTube steps settle. Net wall-clock is
        // max(content, image, youtube) instead of the old image-then-content sum.
        postStage(domain, { title, post_id, stage: 'writing' }, process.env.GENERATE_SECRET || '');
        console.log('[generate] Starting content + image + YouTube concurrently...');

        // AICOBR_INBODY_IMAGES_2026_08
        // Resolve how many in-body image suggestions to ask for. Zero unless the
        // user opted in AND the content type is eligible (the module mirrors the
        // formatter's article/doc tiers — a floated figure in a WooCommerce
        // product description is simply wrong). The ceiling also scales to the
        // type's length band, so a 700-word About Us page never gets three.
        const suggestionCount = suggest_images
            ? imageSuggestions.resolveSuggestionCount(
                  activeContentType,
                  resolveTargetWords(activeContentType, target_word_count),
                  image_suggestion_count
              )
            : 0;

        const contentPromise = generateContent({
            title, primary_keyword, target_word_count,
            special_instructions, brand_voice, tone, style_profile,
            content_type, content_type_meta,
            approved_outline, serp_gl, serp_hl,
            cluster_pillar,
            source_content,   // AICOBR_REFRESH_2026_08 — restore refresh mode (was dropped here)
            suggestion_count: suggestionCount,
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
                include_image !== false && imagePolicy.model ? generateImage(title, image_prompt, image_style, serp_gl, imagePolicy).catch(() => null) : Promise.resolve(null),
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

        // ── In-body image suggestions (AICOBR_INBODY_IMAGES_2026_08) ───────
        // Extract the descriptions the model returned and STRIP the block from
        // the article before anything else touches it — SEO scoring, the publish
        // payload and the stored post must never contain it.
        //
        // Fail-soft by contract, like every other optional step: a malformed or
        // truncated block is stripped and dropped, and the article publishes
        // normally with no suggestions. Suggestions are a nice-to-have; the post
        // the customer paid for is not.
        let imageSuggestionList = [];
        if (suggestionCount > 0) {
            try {
                const parsed = imageSuggestions.parseSuggestionBlock(articleText, { max: suggestionCount });
                articleText        = parsed.cleanContent;
                imageSuggestionList = parsed.suggestions;
                if (parsed.parseError) {
                    console.warn(`[generate] image suggestions dropped (non-fatal): ${parsed.parseError}`);
                } else {
                    console.log(`[generate] ${imageSuggestionList.length}/${suggestionCount} in-body image suggestion(s) parsed`);
                }
            } catch (e) {
                console.warn('[generate] image suggestion parsing skipped (non-fatal):', e.message);
            }
        } else {
            // Belt-and-braces: strip the block even when we did not ask for it,
            // so a stray emission can never reach the published post.
            articleText = imageSuggestions.parseSuggestionBlock(articleText).cleanContent;
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
            image_model:        imagePolicy.model || IMAGE_MODEL,
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
            // AICOBR_INBODY_IMAGES_2026_08 — descriptions only, no images yet.
            // WordPress stores these on the diary entry; the user turns one into
            // a real image (1 credit) from the image modal.
            image_suggestions:  imageSuggestionList,
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
            image:       imageBase64 ? { model: imagePolicy.model, size: imagePolicy.size, quality: imagePolicy.quality } : null,
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
            image:       imageBase64 ? { model: imagePolicy.model, size: imagePolicy.size, quality: imagePolicy.quality } : null,
            serpCalls:   costCtx.serpCalls,
            costEvent:   'generate',
            succeeded:   false,
            generationSeconds: Math.round((Date.now() - startTime) / 1000),
        });
    } finally {
        // Always free the slot — success, handled failure, or an unexpected
        // throw. This is what keeps the gate from leaking permits and stalling
        // every future generation.
        generationGate.release();
    }
});

module.exports = router;