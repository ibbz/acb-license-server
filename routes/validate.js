/**
 * License Validation Endpoint
 * POST /api/validate
 *
 * Called by WordPress plugin before every content generation.
 * Returns whether the license is valid and if user has credits remaining.
 */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/', async (req, res) => {
  const { license_key, domain } = req.body;

  if (!license_key) {
    return res.status(400).json({
      valid: false,
      error: 'License key is required'
    });
  }

  try {
    // Get license key with user info
    const result = await pool.query(`
      SELECT
        lk.*,
        u.email,
        u.name
      FROM license_keys lk
      JOIN users u ON lk.user_id = u.id
      WHERE lk.license_key = $1
        AND lk.status = 'active'
    `, [license_key]);

    if (result.rows.length === 0) {
      return res.json({
        valid: false,
        error: 'Invalid or inactive license key'
      });
    }

    const license = result.rows[0];

    // ── Domain lock enforcement (free tier only) ───────────────────────────
    // On first use, lock the domain. On subsequent uses, enforce it.
    if (license.tier === 'free') {
      const incomingDomain = (domain || '').trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/\/$/, '');

      if (!license.registered_domain) {
        // First use — lock the domain now
        await pool.query(
          `UPDATE license_keys
           SET registered_domain = $2, domain_locked_at = NOW()
           WHERE id = $1`,
          [license.id, incomingDomain]
        );
        license.registered_domain = incomingDomain;
      } else {
        const lockedDomain = license.registered_domain.toLowerCase();
        if (lockedDomain !== incomingDomain) {
          return res.status(403).json({
            valid:  false,
            error:  `This free license is registered to ${license.registered_domain}. To transfer it to a new domain please contact support@aicontentbridge.com.`,
            code:   'DOMAIN_MISMATCH',
          });
        }
      }

      // Free license must be email-verified before it can generate
      if (!license.email_verified) {
        return res.status(403).json({
          valid:  false,
          error:  'Please verify your email address before generating content. Check your inbox for the verification link.',
          code:   'EMAIL_NOT_VERIFIED',
        });
      }
    }

    // =====================================================
    // NEW: Calculate remaining credits from credit_batches
    // (60-day expiry system)
    // =====================================================
    const creditsResult = await pool.query(
      `SELECT SUM(credits_remaining) as remaining 
       FROM credit_batches 
       WHERE license_key_id = $1 
         AND expiry_date >= CURRENT_DATE`,
      [license.id]
    );

    const creditsRemaining = parseInt(creditsResult.rows[0].remaining) || 0;
    const canGenerate = creditsRemaining > 0;

    // Monthly allowance is derived from the tier (the source of truth). The stored
    // monthly_credit_limit column is NOT NULL DEFAULT 5 and isn't updated on
    // upgrade, so honour it ONLY when deliberately raised above the tier default
    // (a custom plan) — otherwise paid licences would report the free/5 value.
    // Mirrors the logic in routes/credits.js so both endpoints agree.
    const TIER_LIMITS = { free: 5, starter: 30, pro: 100, agency: 300 };
    const tierDefault = TIER_LIMITS[license.tier] || 5;
    const effectiveLimit = (license.monthly_credit_limit != null && license.monthly_credit_limit > tierDefault)
      ? license.monthly_credit_limit
      : tierDefault;

    // Log validation attempt
    await pool.query(`
      INSERT INTO usage_logs (license_key_id, domain, post_title, created_at)
      VALUES ($1, $2, 'VALIDATION_CHECK', NOW())
    `, [license.id, domain || 'unknown']);

    res.json({
      valid: true,
      tier: license.tier,
      canGenerate: canGenerate,
      creditsRemaining: creditsRemaining,
      postsUsedThisMonth: license.posts_used_this_month,
      postsLimit: effectiveLimit,
      email: license.email,
      domain: domain
    });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      valid: false,
      error: 'Server error during validation'
    });
  }
});

module.exports = router;