/**
 * GET /api/license-status?license_key=ACB-...
 *
 * AICOBR_WIZARD_POLL_2026_07_29
 *
 * Lightweight polling endpoint for the onboarding wizard. After a free
 * registration the wizard already holds the (inert) licence key; it polls this
 * every few seconds so that the moment the user clicks the verification link
 * in their email — on any device — the wizard auto-completes with no manual
 * key copy/paste.
 *
 * Design notes:
 *  - The key itself is the bearer credential (48 bits of entropy for free keys,
 *    served only to the registrant); no other auth needed.
 *  - Deliberately checks email_verified, NOT status: free licences are created
 *    with status='active' but email_verified=false, and the generation gate in
 *    validate.js is email_verified. verify-license would report such a key as
 *    valid before the user ever opened the email — wrong signal for the wizard.
 *  - Single indexed SELECT; cheap enough for 4s polling. Credits are only
 *    looked up once verified, so the pre-verification poll is one query.
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

router.get('/', async (req, res) => {
  const key = (req.query.license_key || '').toString().trim();

  // Same shape as the plugin generates / Stripe provisioning issues.
  if (!/^ACB-[A-Za-z0-9-]{4,64}$/.test(key)) {
    return res.status(400).json({ success: false, error: 'A valid license_key is required.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, tier, status, email_verified
       FROM license_keys
       WHERE license_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Unknown licence key.' });
    }

    const lk = result.rows[0];
    const verified = !!lk.email_verified && lk.status === 'active';

    if (!verified) {
      return res.json({ success: true, verified: false, tier: lk.tier });
    }

    const credits = await pool.query(
      `SELECT COALESCE(SUM(credits_remaining), 0) AS remaining
       FROM credit_batches
       WHERE license_key_id = $1 AND expiry_date >= CURRENT_DATE`,
      [lk.id]
    );

    return res.json({
      success:           true,
      verified:          true,
      tier:              lk.tier,
      credits_remaining: parseInt(credits.rows[0].remaining, 10) || 0,
    });
  } catch (err) {
    console.error('[license-status] DB error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
});

module.exports = router;
