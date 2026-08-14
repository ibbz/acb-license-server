// lib/anchor-variants.js
//
// AICOBR_ANCHOR_VARIANTS_2026_08
//
// Pure, dependency-free logic for the Strategist's inbound-link anchor variants.
// Extra phrasings of a spoke's own topic ("sell your van", "selling a van") that
// the plugin's inbound-link matcher searches for alongside the primary keyword,
// catching the near-misses exact-match otherwise drops ("my" vs "your").
//
// Kept out of routes/strategist.js so it can be unit-tested without the Express
// stack — same split as lib/pricing.js and lib/cost-log.js.
//
// The guards here MIRROR the plugin's AICOBR_Inbound_Links::phrases_for():
//   - each variant >= 2 words (a one-word variant matches the whole library),
//   - never equal to the item's own focus keyphrase (redundant),
//   - de-duplicated, capped at 4,
//   - never equal to ANOTHER item's focus keyphrase (would poach a sibling
//     spoke's anchor — the plugin can't see siblings at match time, so the plan
//     must guarantee it).

function normaliseKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function wordCount(s) {
  return String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Per-item guards: 2+ words, not the focus keyphrase, de-duplicated, max 4.
 * @param {*} raw       whatever the model returned for anchor_variants
 * @param {string} focus the item's focus keyphrase
 * @returns {string[]}
 */
function sanitiseAnchorVariants(raw, focus) {
  if (!Array.isArray(raw)) return [];
  const focusKey = normaliseKey(focus);
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const phrase = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!phrase) continue;
    if (wordCount(phrase) < 2) continue;
    const key = normaliseKey(phrase);
    if (!key || key === focusKey || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Cross-sibling scrub: drop any variant equal to a DIFFERENT item's focus
 * keyphrase. Mutates and returns the same array (called once, post-dedupe).
 * @param {Array<{focus_keyphrase?:string, anchor_variants?:string[]}>} items
 */
function scrubSiblingVariants(items) {
  const list = Array.isArray(items) ? items : [];
  const focusKeys = new Set(list.map(it => normaliseKey(it && it.focus_keyphrase)).filter(Boolean));
  for (const it of list) {
    if (!it || !Array.isArray(it.anchor_variants) || !it.anchor_variants.length) continue;
    const own = normaliseKey(it.focus_keyphrase);
    it.anchor_variants = it.anchor_variants.filter(v => {
      const k = normaliseKey(v);
      return k === own || !focusKeys.has(k); // keep unless it's a different item's focus
    });
  }
  return list;
}

module.exports = { sanitiseAnchorVariants, scrubSiblingVariants, normaliseKey, wordCount };
