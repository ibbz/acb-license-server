/**
 * POST /api/admin/transfer-domain
 *
 * Protected admin endpoint to migrate a free license to a new domain.
 * Used by support to process domain transfer requests.
 *
 * Usage (from terminal):
 *   curl -X POST https://your-server/api/admin/transfer-domain \
 *     -H "Content-Type: application/json" \
 *     -H "x-admin-secret: YOUR_ADMIN_SECRET" \
 *     -d '{"license_key": "ACB-FREE-XXXX-XXXX-XXXX", "new_domain": "newsite.com", "reason": "Site migration"}'
 */

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Admin auth middleware ──────────────────────────────────────────────────

const requireAdminSecret = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorised.' });
  }
  next();
};

// ── Transfer domain ───────────────────────────────────────────────────────

router.post('/transfer-domain', requireAdminSecret, async (req, res) => {
  const { license_key, new_domain, reason } = req.body;

  if (!license_key || !new_domain) {
    return res.status(400).json({ success: false, error: 'license_key and new_domain are required.' });
  }

  const normalizedDomain = new_domain.trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    const result = await pool.query(
      `UPDATE license_keys
       SET registered_domain = $2,
           domain_locked_at  = NOW(),
           updated_at        = NOW()
       WHERE license_key = $1
         AND tier = 'free'
       RETURNING id, license_key, registered_domain, tier`,
      [license_key, normalizedDomain]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error:   'Free license key not found. Note: paid licenses are not domain-locked and don\'t need transferring.',
      });
    }

    // Update free_registrations too
    await pool.query(
      `UPDATE free_registrations
       SET registered_domain = $2
       WHERE license_key_id = $1`,
      [result.rows[0].id, normalizedDomain]
    );

    console.log(`[admin] Domain transfer: ${license_key} → ${normalizedDomain}. Reason: ${reason || 'none given'}`);

    return res.json({
      success:     true,
      license_key: result.rows[0].license_key,
      new_domain:  normalizedDomain,
      message:     `License successfully transferred to ${normalizedDomain}.`,
    });

  } catch (err) {
    console.error('[admin/transfer-domain] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Transfer failed.' });
  }
});

// ── List free registrations (useful for abuse review) ────────────────────

router.get('/free-registrations', requireAdminSecret, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fr.email, fr.registered_domain, fr.registered_ip, fr.created_at,
              lk.license_key, lk.status, lk.email_verified
       FROM free_registrations fr
       JOIN license_keys lk ON fr.license_key_id = lk.id
       ORDER BY fr.created_at DESC
       LIMIT 100`
    );
    return res.json({ success: true, registrations: result.rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


// ── Change tier ───────────────────────────────────────────────────────────────

router.post('/change-tier', requireAdminSecret, async (req, res) => {
  const { license_key, tier, reason } = req.body;
  if (!license_key) return res.status(400).json({ success: false, error: 'license_key is required' });
  if (!tier)        return res.status(400).json({ success: false, error: 'tier is required' });

  const VALID_TIERS = ['free', 'starter', 'pro', 'agency'];
  if (!VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}` });
  }

  try {
    const current = await pool.query(
      `SELECT lk.id, lk.tier AS old_tier, fr.email
       FROM   license_keys lk
       LEFT   JOIN free_registrations fr ON fr.license_key_id = lk.id
       WHERE  lk.license_key = $1 LIMIT 1`,
      [license_key]
    );
    if (!current.rows.length) return res.status(404).json({ success: false, error: 'Licence key not found' });

    const { old_tier, email } = current.rows[0];

    await pool.query(
      `UPDATE license_keys SET tier = $1, updated_at = NOW() WHERE license_key = $2`,
      [tier, license_key]
    );

    console.log(`[admin/change-tier] ${license_key} | ${old_tier} → ${tier} | ${email || 'unknown'} | ${reason || 'no reason'}`);

    return res.json({
      success:     true,
      license_key,
      email:       email || null,
      old_tier,
      new_tier:    tier,
      message:     `Tier changed from "${old_tier}" to "${tier}". User must reactivate the plugin for the change to take effect.`,
    });
  } catch (err) {
    console.error('[admin/change-tier] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
