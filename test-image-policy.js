// test-image-policy.js
// Standalone unit test for the tier-gated image policy + locale clause, now
// sourced from lib/image-gen.js (the single source of truth shared by
// /api/generate and /api/regenerate-image). Run: `node test-image-policy.js`
// (no env / DB / network required — imagePolicyFor and localeClause are pure).
//
// Also asserts the IMAGE-ONLY REGENERATION pricing: an image_regen spends no
// text/serp, so its cost is exactly imageCostUsd(policy) — free->mini ($0.015),
// paid->full ($0.05). This is what keeps a 1-credit image regen at ~90%+ margin.

const { imagePolicyFor, localeClause, buildImagePrompt, LAYOUTS } = require('./lib/image-gen');
const pricing = require('./lib/pricing.js');

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ok  ', l)) : (fail++, console.error('  FAIL', l));

console.log('imagePolicyFor (shared lib/image-gen.js):');
ok('free -> mini', imagePolicyFor('free').model === 'gpt-image-1-mini');
ok('pro -> full 1.5', imagePolicyFor('pro').model === 'gpt-image-1.5');
ok('agency -> full 1.5', imagePolicyFor('agency').model === 'gpt-image-1.5');
ok('starter -> full 1.5', imagePolicyFor('starter').model === 'gpt-image-1.5');
ok('unknown tier -> paid default (fail safe)', imagePolicyFor('enterprise').model === 'gpt-image-1.5');
ok('empty tier -> paid default', imagePolicyFor('').model === 'gpt-image-1.5');

console.log('every policy prices in lib/pricing.js:');
const POLICIES = { free: imagePolicyFor('free'), starter: imagePolicyFor('starter'), pro: imagePolicyFor('pro'), agency: imagePolicyFor('agency') };
for (const [tier, p] of Object.entries(POLICIES)) {
    if (!p.model) { ok(`${tier} no-image -> $0`, pricing.imageCostUsd(p) === 0); continue; }
    ok(`${tier} (${p.model}|${p.size}|${p.quality}) -> real price`, typeof pricing.imageCostUsd(p) === 'number' && pricing.imageCostUsd(p) > 0);
}
ok('free mini medium = $0.015', pricing.imageCostUsd(imagePolicyFor('free')) === 0.015);
ok('pro full medium = $0.050', pricing.imageCostUsd(imagePolicyFor('pro')) === 0.05);

console.log('image_regen pricing (image-only regeneration — no text, no serp):');
// The /api/regenerate-image route runs generateImage(policy) then prices the
// row with imageCostUsd(policy) alone (serpCalls: 0, usage: null). So the whole
// COGS of an image regen IS the image line — assert it lands where the margin
// maths assumes. A free regen must run mini so a spammy free user costs ~1.5c,
// not 5c.
ok('free image_regen COGS = $0.015 (mini)',    pricing.imageCostUsd(imagePolicyFor('free'))    === 0.015);
ok('starter image_regen COGS = $0.050 (full)', pricing.imageCostUsd(imagePolicyFor('starter')) === 0.05);
ok('pro image_regen COGS = $0.050 (full)',     pricing.imageCostUsd(imagePolicyFor('pro'))      === 0.05);
ok('agency image_regen COGS = $0.050 (full)',  pricing.imageCostUsd(imagePolicyFor('agency'))   === 0.05);
// No text + no serp on an image-only regen: total is the image line, nothing else.
ok('image_regen total = image line only (free)',
    pricing.totalCostUsd(0, pricing.imageCostUsd(imagePolicyFor('free')), 0) === 0.015);
ok('image_regen total = image line only (pro)',
    pricing.totalCostUsd(0, pricing.imageCostUsd(imagePolicyFor('pro')), 0) === 0.05);
// A no-image tier (model:null — not configured today, but the guard must hold)
// prices the image line at $0, so the route's 400 "no image on your plan" guard
// is what stops a regen there, not a mispriced $0 row.
ok('no-image policy prices at $0 (guarded, not billed)', pricing.imageCostUsd({ model: null }) === 0);

console.log('localeClause (subtractive):');
const uk = localeClause('gb'), us = localeClause('us');
ok('UK non-empty', uk.length > 0);
ok('UK does NOT command "set in the United Kingdom"', !/set in the United Kingdom/i.test(uk));
ok('UK bans flags + landmarks', /national flags/i.test(uk) && /landmarks/i.test(uk));
ok('UK steers away from American look', /American/i.test(uk));
ok('US has no anti-American steer', !/American/i.test(us));
ok('US still bans flags/landmarks', /national flags/i.test(us));
ok('unknown gl -> empty', localeClause('zz') === '');
ok('no cliché tokens in UK clause', !/phone box|union jack|routemaster|red bus|post box/i.test(uk));

// ── AICOBR_INBODY_IMAGES_2026_08 ────────────────────────────────────────────
// In-body images introduce a SECOND axis to the policy: layout selects the
// generated SIZE (a floated inline image needs portrait, not the featured 3:2).
// That multiplies the number of {model|size|quality} keys the module can emit,
// and every one of them must have a row in lib/pricing.js — an unpriced key
// returns null and logs "UNKNOWN IMAGE KEY" against a live customer generation.
// These assertions are the guard: an unpriced combination fails CI instead.

console.log('layout -> size resolution:');
ok('no layout (featured) -> band size', imagePolicyFor('pro').size === '1536x1024');
ok('band -> 1536x1024',                 imagePolicyFor('pro', 'band').size === '1536x1024');
ok('inline-left -> 1024x1536',          imagePolicyFor('pro', 'inline-left').size === '1024x1536');
ok('inline-right -> 1024x1536',         imagePolicyFor('pro', 'inline-right').size === '1024x1536');
ok('unknown layout -> band (fail safe)', imagePolicyFor('pro', 'sideways').layout === 'band');
ok('empty layout -> featured behaviour', imagePolicyFor('pro', '').size === imagePolicyFor('pro').size);

console.log('free tier renders in-body as BAND (mini has no portrait row):');
// gpt-image-1-mini is priced at 1536x1024 only, and only that size is confirmed
// available on the model. A free inline request therefore renders as a band —
// the one layout needing no text wrap, so it degrades to a good result. When the
// mini portrait row is added to lib/pricing.js, delete LANDSCAPE_ONLY_MODELS and
// these three assertions flip to the paid expectations.
ok('free + inline-right -> band size',   imagePolicyFor('free', 'inline-right').size === '1536x1024');
ok('free + inline-right -> band layout', imagePolicyFor('free', 'inline-right').layout === 'band');
ok('free + inline-right -> downgraded',  imagePolicyFor('free', 'inline-right').downgraded === true);
ok('free + band -> not downgraded',      imagePolicyFor('free', 'band').downgraded === false);
ok('paid + inline -> not downgraded',    imagePolicyFor('pro', 'inline-right').downgraded === false);

console.log('THE INVARIANT — every tier x layout combination prices:');
let unpriced = [];
for (const t of ['free', 'starter', 'pro', 'agency', 'enterprise', '']) {
    for (const l of [undefined, ...LAYOUTS, 'garbage']) {
        const p = imagePolicyFor(t, l);
        if (!p.model) continue; // no-image tier is legitimately $0
        const c = pricing.imageCostUsd(p);
        if (typeof c !== 'number' || c <= 0) unpriced.push(`${t}/${l} -> ${p.model}|${p.size}|${p.quality}`);
    }
}
ok(`all tier x layout combinations priced (${unpriced.join(', ') || 'none unpriced'})`, unpriced.length === 0);
ok('free band  COGS = $0.015', pricing.imageCostUsd(imagePolicyFor('free', 'band')) === 0.015);
ok('pro band   COGS = $0.050', pricing.imageCostUsd(imagePolicyFor('pro', 'band')) === 0.05);
ok('pro inline COGS = $0.050', pricing.imageCostUsd(imagePolicyFor('pro', 'inline-right')) === 0.05);

console.log('featured prompt is UNCHANGED by the in-body work:');
// The featured-image prompt is load-bearing for every existing generation. It
// must be byte-identical to the pre-2.9.0 string, so it is asserted literally.
const featuredNoPrompt = buildImagePrompt({ title: 'Boiler servicing', imageStyle: 'professional', gl: '' });
ok('featured (no prompt) exact',
    featuredNoPrompt === 'Create a professional and clean featured image for a blog post titled: "Boiler servicing". High quality, professional, and eye-catching. No text overlays.');
const featuredWithPrompt = buildImagePrompt({ title: 'Boiler servicing', imagePrompt: 'an engineer at work', imageStyle: 'editorial', gl: '' });
ok('featured (with prompt) exact',
    featuredWithPrompt === 'Create a news editorial style, documentary feel featured image for a blog post. an engineer at work. Title: "Boiler servicing". High quality, eye-catching, suitable for a professional blog.');
ok('featured prompt still carries locale clause',
    /national flags/.test(buildImagePrompt({ title: 'X', imageStyle: 'professional', gl: 'gb' })));

console.log('in-body prompt is a different job:');
const bodyPrompt = buildImagePrompt({
    title: 'Thai boxing for beginners',
    imagePrompt: 'a beginner wrapping their hands',
    imageStyle: 'editorial', gl: 'gb', role: 'body',
    sectionHeading: 'What to expect in your first class',
    styleAnchor: 'a wide shot of an empty gym at dawn',
});
ok('body prompt is NOT a featured prompt', !/featured image/.test(bodyPrompt));
ok('body prompt names its section',        bodyPrompt.includes('What to expect in your first class'));
ok('body prompt inherits the style anchor', bodyPrompt.includes('empty gym at dawn'));
ok('body prompt forbids text in image',    /No text, letters, numbers/.test(bodyPrompt));
ok('body prompt keeps the locale clause',  /national flags/.test(bodyPrompt));
ok('body prompt has no double spaces',     !/\s{2,}/.test(bodyPrompt));
const bodyMinimal = buildImagePrompt({ title: 'X', imageStyle: 'professional', role: 'body' });
ok('body prompt degrades cleanly with no section/anchor',
    bodyMinimal.length > 0 && !/undefined|null/.test(bodyMinimal));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
