// routes/portal-magic.js
// POST /api/portal/magic-request  — sends a magic link email
// GET  /api/portal/magic-verify   — validates token, returns JWT

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const { Resend } = require('resend');
const { Pool }   = require('pg');

const pool    = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// Lazy, guarded Resend client — keeps the server booting even if
// RESEND_API_KEY is unset; email simply no-ops until the key is configured.
let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
const JWT_SECRET = process.env.PORTAL_JWT_SECRET || process.env.ADMIN_SECRET;

// ── POST /api/portal/magic-request ───────────────────────────────────────
router.post('/magic-request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    // Look up user — free_registrations has no name column,
    // link to license_keys via license_key_id
    const userRes = await pool.query(`
      SELECT fr.id, fr.email, lk.license_key, lk.tier
      FROM free_registrations fr
      JOIN license_keys lk ON lk.id = fr.license_key_id
      WHERE LOWER(fr.email) = LOWER($1)
      LIMIT 1
    `, [email]);

    // Always return success to prevent email enumeration
    res.json({ success: true, message: 'If an account exists, a magic link has been sent.' });

    if (userRes.rows.length === 0) return;

    const user = userRes.rows[0];

    // Cooldown — don't send another link if one was issued in the last 2 minutes
    const recentRes = await pool.query(`
      SELECT id FROM portal_magic_tokens
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '2 minutes'
      LIMIT 1
    `, [user.id]);
    if (recentRes.rows.length > 0) {
      console.log(`[portal/magic] Cooldown active for ${email} — skipping`);
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const exp   = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await pool.query(`
      INSERT INTO portal_magic_tokens (user_id, token, expires_at)
      VALUES ($1, $2, $3)
    `, [user.id, token, exp]);

    // Magic link points at the ACB customer portal (portal.html), matching the
    // ${PORTAL_URL}/portal convention used by portal-stripe.js. portal.html reads ?magic=.
    const baseUrl = process.env.PORTAL_URL || 'https://aicontentbridge.com';
    const link    = `${baseUrl}/portal?magic=${token}`;

    await getResend()?.emails.send({
      from:    process.env.RESEND_FROM_EMAIL || 'AI Content Bridge <noreply@aicontentbridge.com>',
      to:      email,
      subject: 'Your sign-in link — AI Content Bridge',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;background:#f8fafc;">
          <div style="background:#06101E;border-radius:12px;padding:24px 28px;margin-bottom:20px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#5CA5FF;">AI Content Bridge</p>
            <h2 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Sign in to your account</h2>
          </div>
          <div style="background:#fff;border-radius:10px;padding:28px 24px;">
            <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
              Click the button below to sign in to your customer portal. This link expires in <strong>15 minutes</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
              <tr><td align="center">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr><td align="center" style="background:#10acf5;border-radius:8px;">
                    <a href="${link}" style="display:inline-block;padding:13px 32px;background:#10acf5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;font-family:Arial,sans-serif;">
                      Sign in to portal &#8594;
                    </a>
                  </td></tr>
                </table>
              </td></tr>
            </table>
            <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Link not working? Copy and paste into your browser:</p>
            <p style="margin:0;font-size:12px;word-break:break-all;"><a href="${link}" style="color:#10acf5;">${link}</a></p>
          </div>
          <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
            If you didn't request this, you can safely ignore it.
          </p>
        </div>
      `,
    });

    console.log(`[portal/magic] Sent magic link to ${email}`);

  } catch (err) {
    console.error('[portal/magic-request]', err.message);
  }
});

// ── GET /api/portal/magic-verify?token=XXX ────────────────────────────────
router.get('/magic-verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const tokenRes = await pool.query(`
      SELECT
        mt.user_id, mt.expires_at, mt.used,
        fr.email, fr.registered_domain,
        lk.license_key, lk.tier, lk.status,
        COALESCE(SUM(cb.credits_issued), 0) AS credits
      FROM portal_magic_tokens mt
      JOIN free_registrations fr ON fr.id = mt.user_id
      JOIN license_keys lk       ON lk.id = fr.license_key_id
      LEFT JOIN credit_batches cb ON cb.license_key_id = lk.id
      WHERE mt.token = $1
      GROUP BY mt.user_id, mt.expires_at, mt.used,
               fr.email, fr.registered_domain, lk.license_key, lk.tier, lk.status
    `, [token]);

    console.log('[portal/magic-verify] Rows found:', tokenRes.rows.length);
    if (!tokenRes.rows.length) {
      return res.status(401).json({ error: 'Invalid or expired magic link.' });
    }

    const row = tokenRes.rows[0];
    if (row.used) {
      return res.status(401).json({ error: 'This magic link has already been used.' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Magic link has expired. Please request a new one.' });
    }

    // Mark used
    await pool.query('UPDATE portal_magic_tokens SET used = true WHERE token = $1', [token]);

    const jwtToken = jwt.sign(
      { sub: row.user_id, email: row.email, license_key: row.license_key, tier: row.tier },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token:   jwtToken,
      user: {
        email:             row.email,
        name:              row.email.split('@')[0],
        license_key:       row.license_key,
        tier:              row.tier,
        status:            row.status,
        expires_at:        null,
        domain:            row.registered_domain || null,
        credits_remaining: parseInt(row.credits) || 0,
      },
    });

  } catch (err) {
    console.error('[portal/magic-verify] Error:', err.message);
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

module.exports = router;
