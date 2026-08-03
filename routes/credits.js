/**
 * GET /api/credits
 * Returns current credit balance + next expiry date using the batch system
 * 
 * Called by WordPress plugin (Usage tab + Settings page)
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { grantDueAnnualCredits } = require('../lib/subscription-credits');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Short-lived read cache + invalidation. See lib/credits-cache.js — a bounded
// TTL is the safety net and the write paths call invalidate() for instant
// freshness where a user is watching the balance.
const creditsCache = require('../lib/credits-cache');

router.get('/', async (req, res) => {
  const licenseKey = req.query.license_key || req.body?.license_key;

  if (!licenseKey) {
    return res.status(400).json({
      success: false,
      error: 'license_key query parameter is required'
    });
  }

  // Cache hit: serve the recent balance and skip the drip check + both queries.
  // Silent by design — a served-from-cache poll is exactly the noise we want
  // gone from the logs. Only cache-miss reads below log a single line.
  const cached = creditsCache.get(licenseKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    // Lazy safety-net for annual subscribers: if this licence is an annual plan
    // that's due a monthly top-up, grant it now so the balance below is current —
    // even if no scheduler is hitting /api/cron/grant-due. Cheap (indexed) and a
    // no-op for everyone else; never allowed to break the balance read.
    try {
      await grantDueAnnualCredits(pool, { licenseKey });
    } catch (dripErr) {
      console.error('[credits] annual top-up check failed (non-fatal):', dripErr.message);
    }

    // Get total remaining credits from non-expired batches
    const creditsResult = await pool.query(`
      SELECT 
        COALESCE(SUM(credits_remaining), 0) as credits_remaining,
        COALESCE(SUM(credits_remaining) FILTER (WHERE notes = 'free_tier_initial'), 0) as trial_remaining,
        MIN(expiry_date) FILTER (WHERE credits_remaining > 0) as next_expiry_date,
        COUNT(*) as active_batches
      FROM credit_batches
      WHERE license_key_id = (
        SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'
      )
      AND expiry_date > CURRENT_DATE
    `, [licenseKey]);

    // Get tier info
    const tierResult = await pool.query(`
      SELECT tier, monthly_credit_limit, posts_used_this_month
      FROM license_keys 
      WHERE license_key = $1 AND status = 'active'
    `, [licenseKey]);

    if (tierResult.rows.length === 0) {
      console.log('ERROR: License key not found or inactive');
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid or inactive license key' 
      });
    }

    const { tier, monthly_credit_limit } = tierResult.rows[0];
    // Allowance is derived from the tier (the source of truth). The stored
    // monthly_credit_limit column is NOT NULL DEFAULT 5 and isn't updated on
    // upgrade, so honour it ONLY when deliberately raised above the tier default
    // (i.e. a custom plan) — otherwise paid licences would report the free/5 value.
    const TIER_LIMITS = { free: 10, starter: 45, pro: 130, agency: 420 }; // AICOBR_MODEL_A_LADDER_2026_08 + 10-credit trial
    const tierDefault = TIER_LIMITS[tier] || 5;
    const effectiveLimit = (monthly_credit_limit != null && monthly_credit_limit > tierDefault)
      ? monthly_credit_limit
      : tierDefault;

    const { credits_remaining, trial_remaining, next_expiry_date, active_batches } = creditsResult.rows[0];

    const finalCredits = parseInt(credits_remaining) || 0;
    // AICOBR_AGENCY_TRIAL_2026_08: while the free_tier_initial batch has
    // balance a free licence has the Agency type palette; the plugin renders
    // type locks from this flag.
    const trialCredits = parseInt(trial_remaining) || 0;

    const response = {
      success: true,
      tier: tier,
      monthly_credit_limit: effectiveLimit,
      credits_remaining: finalCredits,
      trial_active: tier === 'free' && trialCredits > 0,
      trial_credits_remaining: tier === 'free' ? trialCredits : 0,
      next_expiry_date: next_expiry_date || null,
      active_batches: parseInt(active_batches) || 0
    };

    // Cache the fresh result so the next burst of polls (and the second tab)
    // are served from memory instead of re-querying. One concise log line per
    // cache-miss read replaces the old ~14-line block.
    creditsCache.set(licenseKey, response);
    console.log(`[credits] key=...${licenseKey.slice(-6)} tier=${tier} remaining=${finalCredits} limit=${effectiveLimit} batches=${response.active_batches} (cache miss)`);

    res.json(response);

  } catch (error) {
    console.error('=== CREDITS ERROR ===');
    console.error('Error message:', error.message);
    console.error('Stack trace:', error.stack);

    res.status(500).json({ 
      success: false, 
      error: 'Internal server error while fetching credits',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;