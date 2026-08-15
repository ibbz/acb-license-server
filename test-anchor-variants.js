// test-anchor-variants.js
// Standalone unit test for lib/anchor-variants — the Strategist's inbound-link
// anchor phrasings (AICOBR_ANCHOR_VARIANTS_2026_08).
// Run: `node test-anchor-variants.js` (no env / DB / express required).

const { sanitiseAnchorVariants, scrubSiblingVariants } = require('./lib/anchor-variants');

let pass = 0, fail = 0;
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.error(`  FAIL ${label}\n        got:  ${g}\n        want: ${w}`); }
}

console.log('sanitiseAnchorVariants:');

// Normal case: keeps good multi-word phrasings.
check('keeps 2+ word phrasings',
  sanitiseAnchorVariants(['sell your van', 'selling a van'], 'sell my van'),
  ['sell your van', 'selling a van']);

// One-word variants are dropped (would match the whole library).
check('drops single-word variants',
  sanitiseAnchorVariants(['van', 'vans', 'sell your van'], 'sell my van'),
  ['sell your van']);

// A variant equal to the focus keyphrase is redundant and dropped.
check('drops a variant equal to the focus keyphrase',
  sanitiseAnchorVariants(['Sell My Van', 'sell your van'], 'sell my van'),
  ['sell your van']);

// De-duplicated (case/whitespace-insensitively) and capped at 4.
check('de-dupes and caps at four',
  sanitiseAnchorVariants(
    ['sell your van', 'SELL  YOUR  VAN', 'a b', 'c d', 'e f', 'g h', 'i j'], 'sell my van'),
  ['sell your van', 'a b', 'c d', 'e f']);

// Whitespace is collapsed and trimmed.
check('collapses internal whitespace',
  sanitiseAnchorVariants(['  sell   your  van '], 'sell my van'),
  ['sell your van']);

// Non-array / junk input yields an empty list, never throws.
check('non-array input -> []', sanitiseAnchorVariants('nope', 'x'), []);
check('null input -> []',      sanitiseAnchorVariants(null, 'x'), []);
check('drops empty/whitespace entries',
  sanitiseAnchorVariants(['', '   ', null, 'ok phrase'], 'focus here'),
  ['ok phrase']);

console.log('\nscrubSiblingVariants:');

// A variant that equals ANOTHER item's focus keyphrase is removed (no poaching).
{
  const items = [
    { focus_keyphrase: 'sell my van',      anchor_variants: ['sell your van', 'van valuation'] },
    { focus_keyphrase: 'van valuation',    anchor_variants: ['value my van'] },
  ];
  scrubSiblingVariants(items);
  check("drops a variant that is a sibling's focus keyphrase",
    items[0].anchor_variants, ['sell your van']);
  check('leaves the sibling untouched',
    items[1].anchor_variants, ['value my van']);
}

// A variant equal to the item's OWN focus is left for sanitise to handle, not
// scrubbed here (scrub only cares about siblings).
{
  const items = [{ focus_keyphrase: 'sell my van', anchor_variants: ['sell my van', 'sell your van'] }];
  scrubSiblingVariants(items);
  check('own-focus match is not treated as a sibling poach',
    items[0].anchor_variants, ['sell my van', 'sell your van']);
}

// Empty / missing variant arrays are safe.
{
  const items = [{ focus_keyphrase: 'a b' }, { focus_keyphrase: 'c d', anchor_variants: [] }];
  scrubSiblingVariants(items);
  check('items without variants are untouched',
    [items[0].anchor_variants, items[1].anchor_variants], [undefined, []]);
}

console.log('\nscrubSiblingVariants — greedy prefixes:');

// THE REAL CASE: "the Ford Transit" (a variant of the Transit No.2 post) is a
// determiner-led prefix of the Transit Custom post's subject. It must be dropped
// — otherwise it links the first 3 words of "Ford Transit Custom" and splits it.
{
  const items = [
    { focus_keyphrase: 'ford transit review',        anchor_variants: ['the ford transit', 'ford transit van'] },
    { focus_keyphrase: 'ford transit custom review', anchor_variants: ['ford transit custom', 'transit custom van'] },
  ];
  scrubSiblingVariants(items);
  check('drops determiner-led greedy prefix ("the ford transit")',
    items[0].anchor_variants.includes('the ford transit'), false);
  check('keeps the non-colliding sibling variant ("ford transit van")',
    items[0].anchor_variants.includes('ford transit van'), true);
}

// Plain (no determiner) greedy prefix is dropped too.
{
  const items = [
    { focus_keyphrase: 'transporter review',    anchor_variants: ['vw transporter'] },
    { focus_keyphrase: 'vw transporter t7 spec', anchor_variants: [] },
  ];
  scrubSiblingVariants(items);
  check('drops a plain word-boundary prefix of a sibling ("vw transporter" < "vw transporter t7 …")',
    items[0].anchor_variants.includes('vw transporter'), false);
}

// Word-boundary respected: "van" is not a prefix of "vanguard".
{
  const items = [
    { focus_keyphrase: 'van sales guide', anchor_variants: ['van sales'] },
    { focus_keyphrase: 'vanguard fleet review', anchor_variants: [] },
  ];
  scrubSiblingVariants(items);
  check('does NOT treat "van sales" as a prefix of unrelated "vanguard fleet review"',
    items[0].anchor_variants.includes('van sales'), true);
}

// No false positives: legitimate rephrasings that merely share early words but
// diverge are kept.
{
  const items = [
    { focus_keyphrase: 'sell my van', anchor_variants: ['sell your van', 'selling a van'] },
    { focus_keyphrase: 'sell my van fast', anchor_variants: [] },
  ];
  scrubSiblingVariants(items);
  // "sell your van" is NOT a prefix of "sell my van fast" (diverges at word 2) -> kept.
  check('keeps a rephrasing that diverges from the sibling ("sell your van")',
    items[0].anchor_variants.includes('sell your van'), true);
  check('keeps "selling a van"',
    items[0].anchor_variants.includes('selling a van'), true);
}

// But a genuine prefix of a sibling (same leading words, sibling is longer) IS dropped.
{
  const items = [
    { focus_keyphrase: 'sell my van', anchor_variants: ['sell my van'] },  // == own focus: allowed
    { focus_keyphrase: 'sell my van quickly online', anchor_variants: [] },
  ];
  scrubSiblingVariants(items);
  // own-focus variant is kept (existing rule), even though it prefixes the sibling.
  check('a variant equal to its OWN focus survives even if it prefixes a sibling',
    items[0].anchor_variants.includes('sell my van'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
