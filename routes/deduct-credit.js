const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const creditsCache = require('../lib/credits-cache');

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

    // Find the soonest-to-expire non-expired batch with enough credits.
    // Monthly subscription credits expire ~35 days after grant; bundle/top-up
    // credits never expire (expiry_date 2099-12-31). Ordering by expiry_date
    // ASC spends the expiring monthly allowance before a never-expiring bundle,
    // so a customer's metered credits can't lapse while the bundle burns first.
    // issued_date breaks ties. (Mirrors deductCredits() in generate.js.)
    const batchResult = await client.query(`
      SELECT id, credits_remaining, expiry_date
      FROM credit_batches
      WHERE license_key_id = (
        SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'
      )
      AND expiry_date > CURRENT_DATE
      AND credits_remaining >= $2
      ORDER BY expiry_date ASC, issued_date ASC
      LIMIT 1
      FOR UPDATE
    `, [license_key, creditsToDeduct]);

    console.log('Step 3: Batch query completed. Rows found:', batchResult.rows.length);

    if (batchResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('No suitable batch found');
      return res.json({ success: false, error: 'No credits available' });
    }

    const batch = batchResult.rows[0];
    const newRemaining = batch.credits_remaining - creditsToDeduct;

    console.log('Step 4: Selected batch ID', batch.id, 'with', batch.credits_remaining, 'credits remaining');

    // Deduct credits (NO updated_at column)
    await client.query(`
      UPDATE credit_batches 
      SET credits_remaining = $1
      WHERE id = $2
    `, [newRemaining, batch.id]);

    console.log('Step 5: Batch updated successfully');

    // Log usage
    await client.query(`
      INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, created_at)
      VALUES (
        (SELECT id FROM license_keys WHERE license_key = $1),
        $2, $3, $4, NOW()
      )
    `, [license_key, domain || 'unknown', post_title || 'Untitled Post', creditsToDeduct]);

    console.log('Step 6: Usage log created');

    await client.query('COMMIT');
    console.log('Step 7: Transaction committed');
    creditsCache.invalidate(license_key); // balance changed — next /credits poll reads fresh

    console.log('=== DEDUCT CREDIT SUCCESS ===', creditsToDeduct, 'credits from batch', batch.id);

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
