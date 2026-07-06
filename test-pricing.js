// test-pricing.js
// Standalone unit test for lib/pricing.js — the cost-instrumentation price
// table. Run: `node test-pricing.js` (no env / DB required).
//
// Verifies the text/image/serp cost maths against hand-calculated figures,
// including the prompt-caching multipliers (5-min write 1.25x, read 0.10x —
// verified against Anthropic pricing docs 2026-07-06), the unknown-key
// null-propagation guard, and the zero-image case.
// Exit code is non-zero if any assertion fails.

const { textCostUsd, imageCostUsd, serpCostUsd, totalCostUsd, priceVersion } = require('./lib/pricing');

let pass = 0, fail = 0;
function check(label, got, want) {
    // numeric compare at 5dp (the DB column precision)
    const g = got === null ? 'null' : Number(got).toFixed(5);
    const w = want === null ? 'null' : Number(want).toFixed(5);
    if (g === w) { pass++; console.log(`  ok   ${label} -> ${g}`); }
    else { fail++; console.error(`  FAIL ${label} -> got ${g}, want ${w}`); }
}

console.log('textCostUsd (claude-sonnet-4-6, $3/M in, $15/M out):');

// 1. The model's typical brief: 4k in + 3k out = 4000*3/1e6 + 3000*15/1e6 = 0.012 + 0.045
check('typical brief 4k in / 3k out',
    textCostUsd({ model: 'claude-sonnet-4-6', input_tokens: 4000, output_tokens: 3000 }),
    0.057);

// 2. Worst case: 6k in + 7k out = 0.018 + 0.105
check('worst case 6k in / 7k out',
    textCostUsd({ model: 'claude-sonnet-4-6', input_tokens: 6000, output_tokens: 7000 }),
    0.123);

// 3. Cache-heavy (support-chat shape): small live input, big cached KB read.
//    500 in + 400 out + 60k cache read + 0 write
//    = 0.0015 + 0.006 + 60000*3*0.10/1e6 (=0.018) = 0.0255
check('cache-heavy read (60k cache read)',
    textCostUsd({ model: 'claude-sonnet-4-6', input_tokens: 500, output_tokens: 400, cache_read_tokens: 60000 }),
    0.0255);

// 4. Cache write (first request warms the KB): 60k write at 1.25x
//    = 0.0015 + 0.006 + 60000*3*1.25/1e6 (=0.225) = 0.2325
check('cache write (60k cache write)',
    textCostUsd({ model: 'claude-sonnet-4-6', input_tokens: 500, output_tokens: 400, cache_write_tokens: 60000 }),
    0.2325);

// 5. Unknown model -> null (unpriced, loud), never a silent 0.
check('unknown model -> null',
    textCostUsd({ model: 'claude-future-9', input_tokens: 1000, output_tokens: 1000 }),
    null);

console.log('imageCostUsd:');

// 6. The production default.
check('gpt-image-1.5 1536x1024 medium',
    imageCostUsd({ model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium' }),
    0.050);

// 7. The mini option (free-tier candidate).
check('gpt-image-1-mini 1536x1024 medium',
    imageCostUsd({ model: 'gpt-image-1-mini', size: '1536x1024', quality: 'medium' }),
    0.015);

// 8. No image is legitimately $0.
check('no image -> 0', imageCostUsd({}), 0);
check('null args -> 0', imageCostUsd(), 0);

// 9. Present-but-unknown key -> null, never silent $0.
check('unknown image key -> null',
    imageCostUsd({ model: 'gpt-image-1.5', size: '2048x2048', quality: 'ultra' }),
    null);

console.log('serpCostUsd:');

// 10. Per-search rate.
check('2 searches', serpCostUsd(2), 0.002);
check('0 searches', serpCostUsd(0), 0);
check('negative clamps to 0', serpCostUsd(-3), 0);

console.log('totalCostUsd (null propagation):');

// 11. Normal sum.
check('0.057 + 0.05 + 0.002', totalCostUsd(0.057, 0.05, 0.002), 0.109);

// 12. Any null component -> null total (visibly unpriced).
check('null image -> null total', totalCostUsd(0.057, null, 0.002), null);

// 13. price version present
if (typeof priceVersion() === 'string' && priceVersion().length) { pass++; console.log(`  ok   priceVersion -> ${priceVersion()}`); }
else { fail++; console.error('  FAIL priceVersion missing'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
