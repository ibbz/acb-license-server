// lib/credit-ledger.js
// One shared, atomic, expiry-ordered credit deduction that can SPAN batches.
//
// WHY THIS EXISTS
// The credit GATE everywhere sums remaining across all active batches
// (COALESCE(SUM(credits_remaining)) ...), but the historical DEDUCT pulled from a
// single batch (… credits_remaining >= $n … LIMIT 1). So a customer holding, say,
// 5 (expiring monthly) + 5 (never-expiring bundle) would PASS a gate for 8 credits
// yet FAIL the deduction — "Insufficient credits" with 10 in the bank. That is a
// support call. This module makes the deduction span batches so the gate and the
// deduction can never disagree.
//
// INVARIANTS PRESERVED (do not change without thought — this is the money path):
//   1. Expiry order: spend soonest-to-expire first (expiry_date ASC, issued_date ASC),
//      so an expiring monthly allowance is always consumed before a never-expiring
//      bundle. Same ORDER BY the single-batch path used.
//   2. Atomicity: all candidate batches are locked FOR UPDATE inside the CALLER's
//      transaction, so concurrent generations/plan-runs serialise and can't double-spend.
//   3. No negative balances: only `credits_remaining > 0` batches are considered and
//      we never take more than a batch holds.
//   4. Refundability: a deduction returns the exact per-batch allocation, and the
//      refund restores those exact amounts to those exact batches — so a failed
//      generation/plan puts every credit back where it came from.
//
// USAGE (inside a transaction the caller owns, mirroring generate.js):
//   await client.query('BEGIN');
//   const ded = await deductSpanning(client, licenseKey, credits);
//   if (!ded.success) { await client.query('ROLLBACK'); /* 402 */ }
//   ... write usage_logs ...
//   await client.query('COMMIT');
//   // on later async failure, after COMMIT:
//   await refundSpanning(pool, ded.allocations);

/**
 * Pure allocation walk. `batches` MUST already be ordered soonest-expiry-first.
 * Returns [{ batch_id, amount }] that sums to `credits`, or null if the batches
 * don't hold enough in total. Exported for unit testing without a DB.
 */
function planAllocations(batches, credits) {
  let need = Number(credits) || 0;
  if (need <= 0) return [];
  const alloc = [];
  for (const b of batches) {
    if (need <= 0) break;
    const avail = Number(b.credits_remaining) || 0;
    if (avail <= 0) continue;
    const take = Math.min(avail, need);
    alloc.push({ batch_id: b.id, amount: take });
    need -= take;
  }
  return need > 0 ? null : alloc;
}

/**
 * Deduct `credits` for an ACTIVE licence, spanning batches in expiry order.
 * Runs inside the caller's open transaction (pass the same `client`).
 * @returns {Promise<{success:true, allocations:[{batch_id,amount}]} | {success:false, error:string}>}
 */
async function deductSpanning(client, licenseKey, credits) {
  const need = Number(credits) || 0;
  if (need <= 0) return { success: true, allocations: [] };

  // Lock every spendable batch for this active licence, soonest-expiry first.
  // Locking the full candidate set (not just the one we'll use) is what makes
  // concurrent deductions serialise correctly.
  const { rows } = await client.query(`
    SELECT cb.id, cb.credits_remaining
    FROM credit_batches cb
    WHERE cb.license_key_id = (
      SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'
    )
      AND cb.expiry_date > CURRENT_DATE
      AND cb.credits_remaining > 0
    ORDER BY cb.expiry_date ASC, cb.issued_date ASC
    FOR UPDATE
  `, [licenseKey]);

  const allocations = planAllocations(rows, need);
  if (!allocations) return { success: false, error: 'Insufficient credits' };

  // Decrement under the lock — safe because the rows are FOR UPDATE locked.
  for (const a of allocations) {
    await client.query(
      `UPDATE credit_batches SET credits_remaining = credits_remaining - $1 WHERE id = $2`,
      [a.amount, a.batch_id]
    );
  }
  return { success: true, allocations };
}

/**
 * Restore a previous deduction. `db` may be a pool (post-commit refund) or a
 * client. Each refund is independent and best-effort — a single failed row is
 * logged, not thrown, so one bad row can't strand the rest.
 */
async function refundSpanning(db, allocations) {
  if (!Array.isArray(allocations) || allocations.length === 0) return;
  for (const a of allocations) {
    if (!a || !a.batch_id || !(a.amount > 0)) continue;
    try {
      await db.query(
        `UPDATE credit_batches SET credits_remaining = credits_remaining + $1 WHERE id = $2`,
        [a.amount, a.batch_id]
      );
    } catch (e) {
      console.error(`[credit-ledger] refund failed for batch ${a.batch_id} (${a.amount}):`, e.message);
    }
  }
}

module.exports = { planAllocations, deductSpanning, refundSpanning };
