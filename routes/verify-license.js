/**
 * POST /api/verify-license
 *
 * Called by the WordPress plugin's onboarding wizard when a user enters
 * their license key. Wraps the existing /api/validate logic and returns
 * the shape the wizard expects: { success, plan, credits_remaining }.
 *
 * This is intentionally a thin wrapper — all the real DB work is the same
 * query already used by /api/validate.
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/', async (req, res) => {
  const { license_key, email, domain } = req.body;

  if (!license_key) {
    return res.status(400).json({
      success: false,
      error: 'License key is required'
    });
  }

  try {
    // Look up the license + user
    const result = await pool.query(`
      SELECT
        lk.id,
        lk.tier,
        lk.status,
        lk.monthly_credit_limit,
        u.email AS user_email
      FROM license_keys lk
      JOIN users u ON lk.user_id = u.id
      WHERE lk.license_key = $1
        AND lk.status = 'active'
    `, [license_key]);

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or inactive license key. Please check and try again.'
      });
    }

    const license = result.rows[0];

    // Get live credit balance from non-expired batches
    const creditsResult = await pool.query(`
      SELECT COALESCE(SUM(credits_remaining), 0) AS remaining
      FROM credit_batches
      WHERE license_key_id = $1
        AND expiry_date >= CURRENT_DATE
    `, [license.id]);

    const creditsRemaining = parseInt(creditsResult.rows[0].remaining) || 0;

    console.log(`[verify-license] key=...${license_key.slice(-6)} tier=${license.tier} credits=${creditsRemaining}`);

    return res.json({
      success:           true,
      plan:              license.tier,             // 'free' | 'starter' | 'pro' | 'agency'
      credits_remaining: creditsRemaining,
      email:             license.user_email,
      generate_secret:   process.env.GENERATE_SECRET || '',
    });

  } catch (err) {
    console.error('[verify-license] DB error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Server error during verification. Please try again.'
    });
  }
});

module.exports = router;