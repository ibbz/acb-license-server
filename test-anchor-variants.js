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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
