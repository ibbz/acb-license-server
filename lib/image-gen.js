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
 */

const { wpFetch } = require('./wp-endpoint');
const { fetchWithRetry } = require('./http-retry');

// The image configuration these routes use. Single constants so the API call,
// the publish payload and the cost row can never disagree. Changing
// model/size/quality here REQUIRES a matching entry in lib/pricing.js (an
// unknown key prices as null and logs loudly — see cost instrumentation).
const IMAGE_MODEL = 'gpt-image-1.5';
const IMAGE_SIZE  = '1536x1024';
const IMAGE_QUALITY = 'medium';

// ── Tier-gated image policy ──────────────────────────────────────────────────
// Free-tier images are a trial thumbnail, not a commissioned asset, so they run
// on the cheaper gpt-image-1-mini to roughly halve free-tier burn (see the
// unit-economics model + cost instrumentation). Paid tiers keep the full model.
// Every entry MUST have a matching price in lib/pricing.js IMAGE — flip the free
// row between 'medium' ($0.015) and 'low' ($0.006), or set model:null for no
// image on free, by changing this ONE object then redeploying. Size stays
// 1536x1024 across the board (confirmed available on mini at medium & low).
const IMAGE_POLICY = {
    free:    { model: 'gpt-image-1-mini', size: '1536x1024', quality: 'medium' },
    starter: { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
    pro:     { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
    agency:  { model: IMAGE_MODEL,        size: IMAGE_SIZE,   quality: IMAGE_QUALITY },
};
const DEFAULT_IMAGE_POLICY = { model: IMAGE_MODEL, size: IMAGE_SIZE, quality: IMAGE_QUALITY };

// Resolve the image config for a licence tier. Unknown tiers fall back to the
// paid default (fail safe: never silently downgrade a paying customer). A
// policy of { model: null } means "no image on this tier".
function imagePolicyFor(tier) {
    return IMAGE_POLICY[(tier || '').toLowerCase()] || DEFAULT_IMAGE_POLICY;
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

/**
 * Generate a featured image via OpenAI. `imagePolicy` selects the model/size/
 * quality (tier-gated via imagePolicyFor). Returns base64 PNG string or null on
 * failure (missing key, no-image tier, or an API/parse error). Never throws —
 * a null return lets callers treat "no image" as a soft outcome.
 */
async function generateImage(title, imagePrompt, imageStyle, gl, imagePolicy) {
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
            label:         'image-gen:openai',
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
    imagePolicyFor, localeClause,
    generateImage, uploadImageToWordPress,
};
