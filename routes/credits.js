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

router.get('/', async (req, res) => {
  const licenseKey = req.query.license_key || req.body?.license_key;

  console.log('=== CREDITS REQUEST RECEIVED ===');
  console.log('License Key:', licenseKey ? licenseKey.substring(0, 8) + '...' : 'MISSING');
  console.log('Request method:', req.method);
  console.log('Query params:', JSON.stringify(req.query));

  if (!licenseKey) {
    console.log('ERROR: license_key is required');
    return res.status(400).json({ 
      success: false, 
      error: 'license_key query parameter is required' 
    });
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

    console.log('Fetching credit batches for license key...');

    // Get total remaining credits from non-expired batches
    const creditsResult = await pool.query(`
      SELECT 
        COALESCE(SUM(credits_remaining), 0) as credits_remaining,
        MIN(expiry_date) FILTER (WHERE credits_remaining > 0) as next_expiry_date,
        COUNT(*) as active_batches
      FROM credit_batches
      WHERE license_key_id = (
        SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'
      )
      AND expiry_date > CURRENT_DATE
    `, [licenseKey]);

    console.log('Credit batches query result:', creditsResult.rows[0]);

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
    const TIER_LIMITS = { free: 5, starter: 30, pro: 100, agency: 300 };
    const tierDefault = TIER_LIMITS[tier] || 5;
    const effectiveLimit = (monthly_credit_limit != null && monthly_credit_limit > tierDefault)
      ? monthly_credit_limit
      : tierDefault;
    const { credits_remaining, next_expiry_date, active_batches } = creditsResult.rows[0];

    const finalCredits = parseInt(credits_remaining) || 0;

    console.log('=== CREDITS CALCULATION ===');
    console.log('Tier:', tier);
    console.log('Monthly limit:', monthly_credit_limit);
    console.log('Active batches:', active_batches);
    console.log('Total credits remaining:', finalCredits);
    console.log('Next expiry date:', next_expiry_date || 'None');

    const response = {
      success: true,
      tier: tier,
      monthly_credit_limit: effectiveLimit,
      credits_remaining: finalCredits,
      next_expiry_date: next_expiry_date || null,
      active_batches: parseInt(active_batches) || 0
    };

    console.log('=== CREDITS RESPONSE ===');
    console.log('Sending response:', JSON.stringify(response));

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