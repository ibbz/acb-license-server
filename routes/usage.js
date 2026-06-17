/**
 * Usage Tracking Endpoint
 * POST /api/usage
 * 
 * Called by WordPress plugin after successful content generation.
 * Increments usage counter and logs the generation.
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/', async (req, res) => {
  const { 
    license_key, 
    domain, 
    post_title, 
    word_count, 
    has_youtube,
    generation_time_seconds,
    api_cost 
  } = req.body;

  if (!license_key) {
    return res.status(400).json({ error: 'License key is required' });
  }

  try {
    // Get license
    const licenseResult = await pool.query(`
      SELECT id, tier, posts_limit, posts_used_this_month, status
      FROM license_keys 
      WHERE license_key = $1 AND status = 'active'
    `, [license_key]);

    if (licenseResult.rows.length === 0) {
      return res.status(404).json({ error: 'License not found or inactive' });
    }

    const license = licenseResult.rows[0];

    // Increment usage counter
    await pool.query(`
      UPDATE license_keys 
      SET posts_used_this_month = posts_used_this_month + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [license.id]);

    // Log the generation
    await pool.query(`
      INSERT INTO usage_logs (
        license_key_id, 
        domain, 
        post_title, 
        word_count, 
        has_youtube, 
        generation_time_seconds, 
        api_cost,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      license.id,
      domain || 'unknown',
      post_title || 'Untitled',
      word_count || 0,
      has_youtube || false,
      generation_time_seconds || 0,
      api_cost || 0
    ]);

    // Get updated usage
    const updatedResult = await pool.query(`
      SELECT posts_used_this_month, posts_limit, tier
      FROM license_keys 
      WHERE id = $1
    `, [license.id]);

    const updated = updatedResult.rows[0];
    const remaining = updated.posts_limit === -1 
      ? 'unlimited' 
      : Math.max(0, updated.posts_limit - updated.posts_used_this_month);

    res.json({
      success: true,
      postsUsedThisMonth: updated.posts_used_this_month,
      postsLimit: updated.posts_limit === -1 ? 'unlimited' : updated.posts_limit,
      creditsRemaining: remaining,
      tier: updated.tier
    });

  } catch (error) {
    console.error('Usage tracking error:', error);
    res.status(500).json({ error: 'Failed to track usage' });
  }
});

module.exports = router;