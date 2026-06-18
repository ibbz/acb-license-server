// routes/portal-auth.js
// POST /api/portal/login  — email + password, returns signed JWT
// POST /api/portal/me     — validates JWT, returns full account data

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const JWT_SECRET = process.env.PORTAL_JWT_SECRET || process.env.ADMIN_SECRET;

// ── Middleware: verify JWT ────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/portal/login ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    // free_registrations links to license_keys via license_key_id
    const userRes = await pool.query(`
      SELECT
        fr.id,
        fr.email,
        lk.license_key,
        lk.tier,
        lk.status,
        COALESCE(SUM(cb.credits_issued), 0) AS credits_remaining
      FROM free_registrations fr
      JOIN license_keys lk ON lk.id = fr.license_key_id
      LEFT JOIN credit_batches cb ON cb.license_key_id = lk.id
      WHERE LOWER(fr.email) = LOWER($1)
      GROUP BY fr.id, fr.email,
               lk.license_key, lk.tier, lk.status
      LIMIT 1
    `, [email]);

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with that email address.' });
    }

    const user = userRes.rows[0];

    // No password_hash column on free_registrations — password login not supported
    // Redirect to magic link
    return res.status(401).json({
      error: 'Password login is not available. Please use the magic link option to sign in.'
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, license_key: user.license_key, tier: user.tier },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`[portal/login] ${email} signed in`);
    res.json({ success: true, token, user: buildUserObj(user) });

  } catch (err) {
    console.error('[portal/login]', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/portal/me ───────────────────────────────────────────────────
router.post('/me', requireAuth, async (req, res) => {
  try {
    const accountRes = await pool.query(`
      SELECT
        fr.id,
        fr.email,
        lk.license_key,
        lk.tier,
        lk.status,
        lk.registered_domain,
        COALESCE((
          SELECT SUM(cb.credits_remaining)
          FROM credit_batches cb
          WHERE cb.license_key_id = lk.id
            AND cb.expiry_date > CURRENT_DATE
        ), 0) AS credits_remaining
      FROM free_registrations fr
      JOIN license_keys lk ON lk.id = fr.license_key_id
      WHERE fr.id = $1
    `, [req.user.sub]);

    if (accountRes.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const user = accountRes.rows[0];

    // Recent usage (last 20)
    const usageRes = await pool.query(`
      SELECT post_title AS content_type, created_at, ABS(credits_used) AS credits_used
      FROM usage_logs
      WHERE license_key_id = (SELECT id FROM license_keys WHERE license_key = $1)
        AND domain != 'credit_purchase'
      ORDER BY created_at DESC
      LIMIT 20
    `, [user.license_key]);

    // Billing history — payments table may not exist yet, catch gracefully
    const billingRes = await pool.query(`
      SELECT post_title AS description, 0 AS amount_cents, created_at
      FROM usage_logs
      WHERE license_key_id = (SELECT id FROM license_keys WHERE license_key = $1)
        AND domain = 'credit_purchase'
      ORDER BY created_at DESC
      LIMIT 20
    `, [user.license_key]).catch(() => ({ rows: [] }));

    res.json({
      success: true,
      user:    buildUserObj(user),
      usage:   usageRes.rows,
      billing: billingRes.rows,
    });

  } catch (err) {
    console.error('[portal/me]', err.message);
    res.status(500).json({ error: 'Failed to load account data' });
  }
});

function buildUserObj(row) {
  return {
    id:                row.id,
    email:             row.email,
    name:              row.email.split('@')[0],
    license_key:       row.license_key,
    tier:              row.tier,
    status:            row.status,
    expires_at:        null,
    domain:            row.registered_domain || null,
    credits_remaining: parseInt(row.credits_remaining) || 0,
  };
}

// Single source of truth for the customer portal page URL. Set PORTAL_URL to the
// site origin (e.g. https://aicontentbridge.com); the portal page is portal.html.
function portalUrl() {
  const base = (process.env.PORTAL_URL || 'https://aicontentbridge.com').replace(/\/+$/, '');
  return `${base}/portal.html`;
}

module.exports = { router, requireAuth, portalUrl };
