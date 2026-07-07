// test-image-policy.js
// Standalone unit test for the tier-gated image policy + locale clause, now
// sourced from lib/image-gen.js (the single source of truth shared by
// /api/generate and /api/regenerate-image). Run: `node test-image-policy.js`
// (no env / DB / network required — imagePolicyFor and localeClause are pure).
//
// Also asserts the IMAGE-ONLY REGENERATION pricing: an image_regen spends no
// text/serp, so its cost is exactly imageCostUsd(policy) — free->mini ($0.015),
// paid->full ($0.05). This is what keeps a 1-credit image regen at ~90%+ margin.

const { imagePolicyFor, localeClause } = require('./lib/image-gen');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
