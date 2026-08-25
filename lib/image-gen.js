/**
 * lib/image-gen.js
 *
 * Shared featured-image concerns for the generation routes. Extracted verbatim
 * from routes/generate.js so that /api/generate (full post) and
 * /api/regenerate-image (image-only) resolve the SAME tier→policy map, call the
 * SAME OpenAI generation, and push through the SAME WordPress upload endpoint.
 * One source of truth means the free→mini decision (and any future flip to
 * 'low' or model:null) can never diverge between the two routes.
 *
 * Pure-ish module: no DB. Uses fetch + process.env.OPENAI_API_KEY, exactly as
 * the inline versions did. Cost pricing still lives in lib/pricing.js — this
 * module only decides WHICH policy runs; imageCostUsd() prices it.
 *
 * AICOBR_INBODY_IMAGES_2026_08
 * Extended for in-body images. The change is deliberately additive:
 *   - imagePolicyFor(tier) keeps its EXACT previous behaviour when called with
 *     one argument, because /api/generate and /api/regenerate-image both do.
 *   - A second optional `layout` argument selects the image SIZE, because an
 *     inline image that text wraps around needs portrait, not the 3:2 letterbox
 *     a featured image wants.
 *   - generateImage() takes an optional 6th `options` argument carrying in-body
 *     context. Existing 5-argument calls are untouched.
 * The invariant that matters: every {model, size, quality} this module can
 * produce MUST have a row in lib/pricing.js. test-image-policy.js asserts the
 * full matrix — an unpriced combination fails the suite rather than logging
 * "UNKNOWN IMAGE KEY" against a live customer generation.
 */

const { wpFetch } = require('./wp-endpoint');
const { fetchWithRetry } = require('./http-retry');

// The image configuration these routes use. Single constants so the API call,
// the publish payload and the cost row can never disagree. Changing
// model/quality here REQUIRES a matching entry in lib/pricing.js (an
// unknown key prices as null and logs loudly — see cost instrumentation).
const IMAGE_MODEL = 'gpt-image-1.5';
const IMAGE_SIZE  = '1536x1024';
const IMAGE_QUALITY = 'medium';

// ── Layouts → generated size ────────────────────────────────────────────────
// AICOBR_INBODY_IMAGES_2026_08
// The layout a figure will be rendered at decides the aspect ratio it must be
// generated at. Generating everything at the featured 3:2 and then floating it
// at 40% column width produces a letterbox postage stamp — the single most
// obvious way this feature could look cheap.
//
// 'band' is the featured-image ratio and is therefore also the DEFAULT, which
// is what keeps single-argument callers byte-identical to the previous build.
const LAYOUT_SIZES = {
    band:           '1536x1024', // full content width, above the section heading
    'inline-left':  '1024x1536', // ~40% column, text wraps to the right
    'inline-right': '1024x1536', // ~40% column, text wraps to the left
};
const DEFAULT_LAYOUT = 'band';
const LAYOUTS = Object.keys(LAYOUT_SIZES);

function isValidLayout(layout) {
    return Object.prototype.hasOwnProperty.call(LAYOUT_SIZES, layout);
}

// ── Tier-gated image policy ──────────────────────────────────────────────────
// Free-tier images are a trial thumbnail, not a commissioned asset, so they run
// on the cheaper gpt-image-1-mini to roughly halve free-tier burn (see the
// unit-economics model + cost instrumentation). Paid tiers keep the full model.
// Every entry MUST have a matching price in lib/pricing.js — flip the free
// row between 'medium' ($0.015) and 'low' ($0.006), or set model:null for no
// image on free, by changing this ONE object then redeploying.
//
// NOTE: `size` here is the tier's DEFAULT size (the featured/band ratio). The
// effective size is resolved per-layout in imagePolicyFor().
const IMAGE_POLICY = {
    free:    { model: 'gpt-image-1-mini', size: '1536x1024', quality: 'medium' },
    starter: { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
    pro:     { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
    agency:  { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
};
const DEFAULT_IMAGE_POLICY = { model: IMAGE_MODEL, size: IMAGE_SIZE, quality: IMAGE_QUALITY };

// Models that are only priced/available at the featured 3:2 ratio.
// gpt-image-1-mini has NO row in lib/pricing.js for 1024x1536 or 1024x1024, and
// the original comment above only claims 1536x1024 is confirmed available on
// mini — so a free-tier inline image would construct an unpriced key AND may not
// be a size the model accepts. Rather than guess a price or risk an API
// rejection, the free tier renders in-body images as BANDS. A band is the one
// layout that needs no text wrap, so this degrades to a good-looking result
// rather than a broken one, and inline becomes a clean paid-tier lever.
//
// To widen this later: add the mini portrait row to lib/pricing.js IMAGE, verify
// the size is accepted by the model with one live call, then delete the entry
// here. test-image-policy.js will assert the new combination prices.
const LANDSCAPE_ONLY_MODELS = new Set(['gpt-image-1-mini']);

/**
 * Resolve the image config for a licence tier and (optionally) a layout.
 *
 * Called with ONE argument this is unchanged from the previous build: it returns
 * the tier's featured-image policy. /api/generate and /api/regenerate-image both
 * rely on that.
 *
 * Called with a layout it additionally resolves the SIZE that layout needs, and
 * reports back which layout actually applies — a free-tier request for an inline
 * image is downgraded to a band, and `downgraded: true` tells the caller to emit
 * the band CSS class rather than a float class that would never match the image.
 *
 * An unknown tier falls back to the paid default (fail safe: never silently
 * downgrade a paying customer). An unknown layout falls back to 'band'.
 * A policy of { model: null } means "no image on this tier".
 *
 * @param {string} tier     Licence tier ('free' | 'starter' | 'pro' | 'agency').
 * @param {string} [layout] One of LAYOUTS. Omit for the featured image.
 * @returns {{model:string|null, size:string, quality:string, layout:string, downgraded:boolean}}
 */
function imagePolicyFor(tier, layout) {
    const base = IMAGE_POLICY[(tier || '').toLowerCase()] || DEFAULT_IMAGE_POLICY;

    // No layout requested → the featured image. Return the tier policy exactly
    // as it was before this feature existed, with the descriptive fields added.
    if (layout === undefined || layout === null || layout === '') {
        return { ...base, layout: DEFAULT_LAYOUT, downgraded: false };
    }

    const requested = isValidLayout(layout) ? layout : DEFAULT_LAYOUT;

    // A no-image tier can't produce anything; nothing to resolve.
    if (!base.model) {
        return { ...base, layout: requested, downgraded: false };
    }

    // Free tier (mini): portrait is neither priced nor confirmed available, so
    // render a band instead. Logged so the downgrade is visible in Railway
    // rather than being a silent surprise in the rendered post.
    if (LANDSCAPE_ONLY_MODELS.has(base.model) && requested !== 'band') {
        console.log(`[image-gen] layout "${requested}" not available on ${base.model} — rendering as band`);
        return { ...base, size: LAYOUT_SIZES.band, layout: 'band', downgraded: true };
    }

    return { ...base, size: LAYOUT_SIZES[requested], layout: requested, downgraded: false };
}

// Nudge the image AWAY from wrong-region visual defaults, without commanding
// it TOWARD national clichés. The earlier version said "the scene MUST be set
// in <country>", which the model could only satisfy by painting the densest
// "this is <country>" signifiers it knew — for the UK that meant red phone
// boxes, red post boxes, Routemaster buses and Union Jacks on every image.
// Tacky, and not what locale grounding is for.
//
// What we actually want: don't render obviously foreign details (US dollar
// bills, US-style signage), and don't festoon the image with flags/landmarks.
// So the clause is now purely SUBTRACTIVE — it forbids the wrong region and
// explicitly forbids national clichés, but never demands the scene "be set in"
// anywhere. Regional correctness that matters (spelling, examples, suppliers)
// already lives in the TEXT + SERP grounding, which is where it belongs.
// Returns '' when unset/unknown, so behaviour is unchanged unless configured.
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
    // For the US, there's no "avoid US-default" problem to solve, so only the
    // anti-cliché guard applies. For everywhere else, gently steer away from
    // US-default details while banning tourist-postcard national symbols.
    const avoidWrongRegion = place === 'the United States'
        ? ''
        : ` Any incidental real-world details (currency, signage, vehicles) should not look specifically American.`;
    return `${avoidWrongRegion} Do not include national flags, famous landmarks, or tourist-postcard symbols; keep the setting understated and true to the subject rather than to any country.`;
}

const STYLE_DESCRIPTIONS = {
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

/**
 * AICOBR_INBODY_IMAGES_2026_08
 *
 * Build the OpenAI prompt. Two shapes, because a featured image and an in-body
 * image are different jobs:
 *
 *   featured — heads the whole article. Broad, eye-catching, represents the
 *              subject as a whole. This is the ORIGINAL prompt, unchanged, and
 *              test-image-policy.js asserts it string-for-string.
 *   body     — illustrates ONE passage. It should show the specific thing that
 *              passage is about, and it must sit next to text without competing
 *              with it. It also inherits the post's established look so four
 *              images don't read as four unrelated stock photos.
 *
 * `styleAnchor` is the prompt that produced this post's featured image, when we
 * have one. Passing it is what makes a set cohere; it is optional and the prompt
 * degrades cleanly without it.
 */
function buildImagePrompt({ title, imagePrompt, imageStyle, gl, role, sectionHeading, styleAnchor }) {
    const styleDesc = STYLE_DESCRIPTIONS[imageStyle] || 'professional and clean';
    const loc = localeClause(gl);

    if (role !== 'body') {
        // ── Featured-image prompt ──
        // When an imagePrompt is supplied (e.g. a refresh seeds it from the
        // original's alt text) we must NOT put the title into the prompt — image
        // models render a quoted Title: "..." as literal text on the image — and
        // we must carry the same explicit no-text instruction the empty branch
        // has, or the model adds captions of its own.
        return imagePrompt
            ? `Create a ${styleDesc} featured image for a blog post. The image should show: ${imagePrompt}.${loc} High quality, eye-catching, suitable for a professional blog. No text, letters, numbers, words, logos, watermarks or captions anywhere in the image.`
            : `Create a ${styleDesc} featured image for a blog post titled: "${title}".${loc} High quality, professional, and eye-catching. No text, letters, numbers, words, logos, watermarks or captions anywhere in the image.`;
    }

    // ── In-body image ──
    const subject = String(imagePrompt || '').trim();
    const section = String(sectionHeading || '').trim();
    const anchor  = String(styleAnchor || '').trim();

    const parts = [
        `Create a ${styleDesc} supporting image to sit inside an article titled "${title}".`,
        subject ? `The image should show: ${subject}.` : '',
        section ? `It illustrates the section "${section}", so it must depict that specific subject rather than the article as a whole.` : '',
        anchor  ? `For visual consistency it must look like it belongs beside this image from the same article: ${anchor}. Match its lighting, palette and treatment.` : '',
        loc.trim(),
        `It sits alongside body text, so keep the composition calm and uncluttered with a clear focal point — it supports the writing rather than competing with it.`,
        `No text, letters, numbers, logos, watermarks or captions anywhere in the image.`,
    ];
    return parts.filter(Boolean).join(' ');
}

/**
 * Generate an image via OpenAI. `imagePolicy` selects the model/size/quality
 * (tier- and layout-gated via imagePolicyFor). Returns base64 PNG string or null
 * on failure (missing key, no-image tier, or an API/parse error). Never throws —
 * a null return lets callers treat "no image" as a soft outcome.
 *
 * The 6th `options` argument is optional and carries in-body context
 * (AICOBR_INBODY_IMAGES_2026_08). Omitting it produces the exact featured-image
 * behaviour of the previous build, which is what the existing 5-argument call
 * sites in routes/generate.js and routes/regenerate-image.js rely on.
 *
 * @param {object} [options]
 * @param {'featured'|'body'} [options.role='featured']
 * @param {string} [options.sectionHeading] Heading of the section it illustrates.
 * @param {string} [options.styleAnchor]    Prompt of this post's featured image.
 */
async function generateImage(title, imagePrompt, imageStyle, gl, imagePolicy, options = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[image-gen] OPENAI_API_KEY not set — skipping image generation');
        return null;
    }
    // A policy of { model: null } means this tier gets no image at all.
    const policy = imagePolicy || DEFAULT_IMAGE_POLICY;
    if (!policy.model) {
        console.log('[image-gen] Image policy for this tier is no-image — skipping');
        return null;
    }

    const prompt = buildImagePrompt({
        title,
        imagePrompt,
        imageStyle,
        gl,
        role:           options.role,
        sectionHeading: options.sectionHeading,
        styleAnchor:    options.styleAnchor,
    });

    try {
        // Same bounded retry as the Anthropic text call so the two routes behave
        // consistently under a transient egress failure. This step fails soft
        // (null return = post publishes without a featured image), so the budget
        // is tighter than the text call's — it must never be the reason a run
        // approaches the plugin's 12-minute stuck threshold.
        const res = await fetchWithRetry('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: policy.model,
                prompt,
                n: 1,
                size: policy.size,
                quality: policy.quality,
            }),
        }, {
            label:         options.role === 'body' ? 'image-gen:openai:body' : 'image-gen:openai',
            attempts:      3,
            timeoutMs:     120000,  // 2 min/attempt
            totalBudgetMs: 300000,  // 5 min total — runs concurrently with the text call
        });

        if (!res.ok) {
            const err = await res.text();
            console.warn('[image-gen] OpenAI image error:', res.status, err);
            return null;
        }

        const data = await res.json();
        // gpt-image-1.5 returns b64_json by default
        return data?.data?.[0]?.b64_json || null;
    } catch (err) {
        console.warn('[image-gen] Image generation failed:', err.message);
        return null;
    }
}

/**
 * Upload an image to WordPress via the plugin's own /upload-image REST endpoint.
 * No WordPress credentials needed — the endpoint is secured by the generate
 * secret. Returns attachment ID or null on failure.
 */
async function uploadImageToWordPress(domain, imageBase64, title, postId, generateSecret) {
    if (!imageBase64) return null;

    try {
        console.log(`[image-gen] Uploading image via /upload-image endpoint...`);

        const res = await wpFetch(domain, '/upload-image', {
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
            console.warn(`[image-gen] /upload-image failed (${res.status}):`, err.substring(0, 200));
            return null;
        }

        const data = await res.json();
        if (data?.success && data?.attachment_id) {
            console.log(`[image-gen] Image uploaded: attachment_id=${data.attachment_id}`);
            return data.attachment_id;
        }

        console.warn('[image-gen] /upload-image unexpected response:', JSON.stringify(data).substring(0, 200));
        return null;
    } catch (err) {
        console.warn('[image-gen] /upload-image error:', err.message);
        return null;
    }
}

module.exports = {
    IMAGE_MODEL, IMAGE_SIZE, IMAGE_QUALITY,
    IMAGE_POLICY, DEFAULT_IMAGE_POLICY,
    LAYOUT_SIZES, LAYOUTS, DEFAULT_LAYOUT, isValidLayout,
    imagePolicyFor, localeClause, buildImagePrompt,
    generateImage, uploadImageToWordPress,
};
