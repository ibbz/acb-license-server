const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const creditsCache = require('../lib/credits-cache');
const creditLedger = require('../lib/credit-ledger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/', async (req, res) => {
  const { license_key, credits, post_title, domain } = req.body;

  console.log('=== DEDUCT CREDIT REQUEST ===');
  console.log('License Key:', license_key ? license_key.substring(0, 8) + '...' : 'MISSING');
  console.log('Credits to deduct:', credits);
  console.log('Post Title:', post_title || 'Untitled');
  console.log('Domain:', domain || 'unknown');

  if (!license_key) {
    console.log('ERROR: license_key is required');
    return res.status(400).json({ success: false, error: 'license_key is required' });
  }

  const creditsToDeduct = parseInt(credits) || 1;

  if (creditsToDeduct < 1 || creditsToDeduct > 10) {
    console.log('ERROR: Invalid credit amount:', creditsToDeduct);
    return res.status(400).json({ success: false, error: 'Invalid credit amount (must be 1-10)' });
  }

  const client = await pool.connect();

  try {
    console.log('Step 1: Connected to database');

    await client.query('BEGIN');
    console.log('Step 2: Transaction started');

    // Deduct across batches in expiry order (soonest-to-expire first) via the
    // shared ledger — spending spans batches so a split balance (e.g. 5 monthly +
    // 5 bundle) covers the charge instead of failing despite enough total credits.
    const ded = await creditLedger.deductSpanning(client, license_key, creditsToDeduct);

    console.log('Step 3: Deduction attempted. Spanned batches:', ded.success ? ded.allocations.length : 0);

    if (!ded.success) {
      await client.query('ROLLBACK');
      console.log('Insufficient credits across batches');
      return res.json({ success: false, error: 'No credits available' });
    }

    console.log('Step 4: Deducted across batch(es)', ded.allocations.map(a => `${a.batch_id}:${a.amount}`).join(', '));

    // Log usage
    await client.query(`
      INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, created_at)
      VALUES (
        (SELECT id FROM license_keys WHERE license_key = $1),
        $2, $3, $4, NOW()
      )
    `, [license_key, domain || 'unknown', post_title || 'Untitled Post', creditsToDeduct]);

    console.log('Step 5: Usage log created');

    await client.query('COMMIT');
    console.log('Step 6: Transaction committed');
    creditsCache.invalidate(license_key); // balance changed — next /credits poll reads fresh

    console.log('=== DEDUCT CREDIT SUCCESS ===', creditsToDeduct, 'credits across', ded.allocations.length, 'batch(es)');

    res.json({
      success: true,
      credits_deducted: creditsToDeduct
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('=== DEDUCT CREDIT ERROR ===');
    console.error('Error message:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    client.release();
    console.log('Step 8: Database connection released');
  }
});

module.exports = router;
