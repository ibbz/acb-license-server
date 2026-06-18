// lib/subscription-credits.js
// Shared subscription credit logic used by the Stripe webhook, the cron endpoint,
// and the lazy top-up on /api/credits. One implementation so monthly and annual
// subscribers get identical credit behaviour.

const { CREDIT_ALLOWANCE } = require('../routes/plans');

// Grant a subscription's monthly credit allowance.
// No rollover: any leftover from a previous monthly subscription grant is zeroed
// first. One-time bundle credits ('stripe_session:%') and the free grant
// ('free_tier_initial') are left untouched, so they persist/stack on top.
// Idempotent per dedupeKey so webhook retries / cron re-runs can't double-grant.
//
// This is byte-for-byte the same behaviour the webhook has shipped with; it now
// lives here so annual months 2-12 reuse it verbatim.
async function grantSubscriptionCredits(pool, { licenseId, tier, dedupeKey, expiresInDays = 35 }) {
  const allowance = CREDIT_ALLOWANCE[(tier || '').toLowerCase()];
  if (!allowance) {
    console.log(`[sub-credits] No credit allowance for tier '${tier}' — skipping grant`);
    return false;
  }
  const note = `subscription_credits:${dedupeKey}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT id FROM credit_batches WHERE license_key_id = $1 AND notes = $2`,
      [licenseId, note]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[sub-credits] Duplicate credit grant ignored: ${note}`);
      return false;
    }

    // No rollover — expire any prior monthly subscription credits for this licence.
    await client.query(
      `UPDATE credit_batches
       SET credits_remaining = 0, updated_at = NOW()
       WHERE license_key_id = $1 AND notes LIKE 'subscription_credits:%' AND credits_remaining > 0`,
      [licenseId]
    );

    await client.query(
      `INSERT INTO credit_batches
         (license_key_id, credits_issued, credits_remaining, source, issued_date, expiry_date, notes)
       VALUES ($1, $2, $2, 'subscription', CURRENT_DATE, CURRENT_DATE + ($3::int * INTERVAL '1 day'), $4)`,
      [licenseId, allowance, expiresInDays, note]
    );

    await client.query('COMMIT');
    console.log(`[sub-credits] Granted ${allowance} '${tier}' credits to license_id=${licenseId} (${note})`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[sub-credits] grantSubscriptionCredits failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Annual monthly-drip. For each active annual subscription that is DUE a monthly
// top-up (next_credit_grant_at <= now) and still within its paid term
// (annual_term_end > now), grant one month's allowance and advance the next-grant
// date by a month. The date guard makes this safe to call as often as we like —
// from cron, or lazily on a balance read.
//
// Pass { licenseKey } to top up a single licence (lazy path); omit it to sweep
// all due annual subscriptions (cron path).
async function grantDueAnnualCredits(pool, { licenseKey = null } = {}) {
  const params = [];
  let where = `billing_interval = 'year'
               AND status = 'active'
               AND next_credit_grant_at IS NOT NULL
               AND next_credit_grant_at <= NOW()
               AND (annual_term_end IS NULL OR annual_term_end > NOW())`;
  if (licenseKey) {
    params.push(licenseKey);
    where += ` AND license_key = $1`;
  }

  const due = await pool.query(
    `SELECT id, tier, next_credit_grant_at FROM license_keys WHERE ${where}`,
    params
  );

  let granted = 0;
  for (const row of due.rows) {
    // dedupeKey is stamped with the period start so the same month can't double-grant
    // even if cron and the lazy path race.
    const period = new Date(row.next_credit_grant_at).toISOString().slice(0, 10);
    const ok = await grantSubscriptionCredits(pool, {
      licenseId: row.id,
      tier:      row.tier,
      dedupeKey: `annual:${row.id}:${period}`,
    });

    // Advance the next-grant date by a month regardless of whether THIS call
    // granted (a dup means it was already granted for this period). Never push
    // past the term end.
    await pool.query(
      `UPDATE license_keys
       SET next_credit_grant_at = LEAST(next_credit_grant_at + INTERVAL '1 month',
                                        COALESCE(annual_term_end, next_credit_grant_at + INTERVAL '1 month')),
           updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    if (ok) granted++;
  }
  return granted;
}

module.exports = { grantSubscriptionCredits, grantDueAnnualCredits };
