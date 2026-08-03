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
        lk.email_verified,
        lk.monthly_credit_limit,
        lk.registered_domain,
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

    // AICOBR_VERIFY_GATE_2026_07_29: free keys are created status='active' with
    // email_verified=false, and generation (validate.js) is gated on
    // email_verified. Before this check, an UNVERIFIED free key passed here —
    // so the plugin marked the site locally verified while every generation
    // was refused, a licensed-looking dashboard that couldn't work. Mirror the
    // validate.js gate: free keys must be email-verified to verify. Paid keys
    // are provisioned by Stripe and never email-verify, so tier-scope this.
    if (license.tier === 'free' && !license.email_verified) {
      return res.status(403).json({
        success: false,
        code:  'EMAIL_NOT_VERIFIED',
        error: 'This key isn\'t activated yet — click the verification link in your email first, then try again.'
      });
    }

    // AICOBR_VERIFY_DOMAIN_LOCK_2026_08: mirror the free-tier domain lock that
    // generate.js already enforces (ACB_FREE_DOMAIN_LOCK_GENERATE_2026_07_18).
    // Without this, a key locked to site A "activated" fine on site B and only
    // failed at first generation — the same licensed-looking-but-unusable
    // dashboard this route was previously patched for with unverified keys.
    // Reject at activation, with the same message and code the user would have
    // hit later, so the transfer path (support) is offered at the right moment.
    // Free tier only; paid keys are not domain-locked. Same kill-switch as
    // generate.js so one env var disables the lock everywhere at once.
    if (license.tier === 'free' && process.env.ACB_FREE_DOMAIN_LOCK !== 'off') {
      const incomingDomain = (domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/\/$/, '');
      const lockedDomain = (license.registered_domain || '').toLowerCase();
      if (lockedDomain && incomingDomain && lockedDomain !== incomingDomain) {
        console.warn(`[verify-license] DOMAIN_MISMATCH: key ...${license_key.slice(-6)} locked to ${lockedDomain}, activation attempt from ${incomingDomain}`);
        return res.status(403).json({
          success: false,
          code:  'DOMAIN_MISMATCH',
          error: `This free licence is registered to ${license.registered_domain}. To move it to a new domain please contact support@aicontentbridge.com.`,
        });
      }
    }

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