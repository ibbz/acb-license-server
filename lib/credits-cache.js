/**
 * Tiny in-process cache for the GET /api/credits read path.
 *
 * Two halves, deliberately — this is belt-and-braces, not one or the other:
 *   1. A short TTL guarantees a balance is never stale longer than the window,
 *      no matter which write path forgot to invalidate. This is the safety net:
 *      correctness does NOT depend on remembering to call invalidate() at every
 *      future credit mutation, so a missed hook degrades to "<=TTL stale", never
 *      "stale forever".
 *   2. invalidate(licenseKey) lets the user-facing write paths (deduct on
 *      generate, refund-on-failure, bundle purchase, manual refund) drop the
 *      entry the instant the balance changes, so the common case is ZERO
 *      staleness — the pill reflects the new balance on the very next poll.
 *
 * Per-process (each Railway instance keeps its own; worst case is one extra
 * query per instance per window) and bounded by the number of active licences.
 *
 * Note: the cache is display-only. Credit *enforcement* (gating + deduction in
 * routes/generate.js) always runs its own fresh `FOR UPDATE` query and never
 * reads this cache, so a stale read can never cause an over-spend or a wrong
 * gate — only a briefly out-of-date number on screen.
 */

const TTL_MS = 12000;
const store = new Map(); // licenseKey -> { expires, payload }

/** Return the cached payload if present and unexpired, else null (and prune). */
function get(licenseKey) {
  const hit = store.get(licenseKey);
  if (hit && hit.expires > Date.now()) return hit.payload;
  if (hit) store.delete(licenseKey); // expired — drop it
  return null;
}

/** Cache a fresh /credits payload for this licence. */
function set(licenseKey, payload, ttlMs = TTL_MS) {
  if (!licenseKey) return;
  store.set(licenseKey, { expires: Date.now() + ttlMs, payload });
}

/** Drop a licence's cached balance — call after any change to its credits. */
function invalidate(licenseKey) {
  if (licenseKey) store.delete(licenseKey);
}

module.exports = { get, set, invalidate, TTL_MS };
