/**
 * GET /verify-email?token=XXX
 *
 * Redeems an email verification token.
 * On success:
 *   - Marks the token as used
 *   - Sets license status = 'active', email_verified = true
 *   - Locks the domain from the original registration
 * Returns a simple HTML success/error page.
 */

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Shared HTML page renderer ─────────────────────────────────────────────

const page = ({ success, title, body }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — AI Content Bridge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 20px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 8px 40px rgb(0 0 0 / 0.10); }
    .icon { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 32px; font-weight: 700; color: #fff; }
    .icon.success { background: linear-gradient(135deg, #10b981, #059669); }
    .icon.error   { background: linear-gradient(135deg, #ef4444, #dc2626); }
    h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    p  { font-size: 15px; color: #64748b; line-height: 1.6; margin-bottom: 16px; }
    .key-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px; padding: 16px; margin: 20px 0; }
    .key-label { font-size: 11px; font-weight: 700; color: #0f766e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .key-value { font-family: monospace; font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: 0.04em; }
    .steps { background: #f8fafc; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: left; }
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; font-size: 14px; color: #334155; }
    .step:last-child { margin-bottom: 0; }
    .step-num { background: #14b8a6; color: #fff; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
    .support { margin-top: 20px; font-size: 13px; color: #94a3b8; }
    .support a { color: #14b8a6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon ${success ? 'success' : 'error'}">${success ? '&#10003;' : '&#10007;'}</div>
    <h1>${title}</h1>
    ${body}
    <p class="support">Questions? <a href="mailto:support@aicontentbridge.com">support@aicontentbridge.com</a></p>
  </div>
</body>
</html>
`;

// ── Route ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(page({
      success: false,
      title:   'Invalid Link',
      body:    `<p>This verification link is missing its token. Please check your email and try the link again.</p>`,
    }));
  }

  const client = await pool.connect();
  try {
    // Look up the token
    const tokenResult = await client.query(
      `SELECT evt.*, lk.license_key, lk.status, u.email, fr.registered_domain
       FROM email_verification_tokens evt
       JOIN license_keys lk ON evt.license_key_id = lk.id
       JOIN users u ON evt.user_id = u.id
       LEFT JOIN free_registrations fr ON fr.license_key_id = lk.id
       WHERE evt.token = $1`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).send(page({
        success: false,
        title:   'Link Not Found',
        body:    `<p>This verification link doesn't exist or has already been used. If you need a new link, return to the plugin and click <strong>Resend verification email</strong>.</p>`,
      }));
    }

    const row = tokenResult.rows[0];

    // Already used?
    if (row.used_at) {
      // License might already be active — that's fine, just show success
      if (row.status === 'active') {
        return res.send(page({
          success: true,
          title:   'Already Verified',
          body: `
            <p>Your email is already verified and your license is active.</p>
            <div class="key-box">
              <div class="key-label">Your License Key</div>
              <div class="key-value">${row.license_key}</div>
            </div>
            <p>Return to WordPress and enter this key in the plugin settings.</p>
          `,
        }));
      }
      return res.status(400).send(page({
        success: false,
        title:   'Link Already Used',
        body:    `<p>This verification link has already been used. Return to the plugin and click <strong>Resend verification email</strong> if you need a new one.</p>`,
      }));
    }

    // Expired?
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).send(page({
        success: false,
        title:   'Link Expired',
        body:    `<p>This verification link expired after 24 hours. Return to the plugin and click <strong>Resend verification email</strong> to get a new one.</p>`,
      }));
    }

    await client.query('BEGIN');

    // Mark token as used
    await client.query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    // Activate the license and lock the domain
    await client.query(
      `UPDATE license_keys
       SET status            = 'active',
           email_verified    = TRUE,
           email_verified_at = NOW(),
           registered_domain = $2,
           domain_locked_at  = NOW()
       WHERE id = $1`,
      [row.license_key_id, row.registered_domain || null]
    );

    await client.query('COMMIT');

    console.log(`[verify-email] License activated: ${row.license_key} for ${row.email}, domain: ${row.registered_domain}`);

    return res.send(page({
      success: true,
      title:   'Email Verified! 🎉',
      body: `
        <p>Your email <strong>${row.email}</strong> is verified and your free license is now active.</p>
        <div class="key-box">
          <div class="key-label">Your License Key</div>
          <div class="key-value">${row.license_key}</div>
        </div>
        <div class="steps">
          <div class="step"><div class="step-num">1</div><div>Return to WordPress and open the <strong>AI Content Bridge</strong> plugin</div></div>
          <div class="step"><div class="step-num">2</div><div>Enter your license key above in the setup wizard or Settings page</div></div>
          <div class="step"><div class="step-num">3</div><div>Click <strong>Verify License</strong> — you're ready to generate content!</div></div>
        </div>
      `,
    }));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[verify-email] Error:', err.message);
    return res.status(500).send(page({
      success: false,
      title:   'Something Went Wrong',
      body:    `<p>We hit a problem verifying your email. Please try again or contact <a href="mailto:support@aicontentbridge.com">support@aicontentbridge.com</a>.</p>`,
    }));
  } finally {
    client.release();
  }
});

module.exports = router;