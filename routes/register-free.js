/**
 * POST /api/register-free
 *
 * Handles free tier license registration.
 * Abuse prevention:
 *   - One free license per email address, ever
 *   - Rate limited by IP (max 3 attempts per hour, enforced in server.js)
 *   - Email must be verified before license activates
 *   - Domain locked on first generation (enforced in validate.js + generate.js)
 */

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');
const crypto   = require('crypto');
const { Resend } = require('resend');

const pool   = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
// Lazy, guarded Resend client — keeps the server booting even if
// RESEND_API_KEY is unset; email simply no-ops until the key is configured.
let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const generateLicenseKey = () => {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ACB-FREE-${seg()}-${seg()}-${seg()}`;
};

const generateToken = () => crypto.randomBytes(32).toString('hex');

// ── Route ────────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { email, domain } = req.body;
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';

  // ── Basic validation ───────────────────────────────────────────────────────
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }
  if (!domain) {
    return res.status(400).json({ success: false, error: 'Domain is required.' });
  }

  const normalizedEmail  = email.trim().toLowerCase();
  const normalizedDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Check: has this email already registered a free license? ───────────
    const existingReg = await client.query(
      `SELECT fr.*, lk.license_key, lk.status, lk.email_verified
       FROM free_registrations fr
       JOIN license_keys lk ON fr.license_key_id = lk.id
       WHERE fr.email = $1`,
      [normalizedEmail]
    );

    if (existingReg.rows.length > 0) {
      const existing = existingReg.rows[0];
      await client.query('ROLLBACK');

      // If they haven't verified yet, resend the verification email
      if (!existing.email_verified) {
        await sendVerificationEmail(client, existing.license_key_id, normalizedEmail, existing.license_key);
        return res.json({
          success:         true,
          already_existed: true,
          verified:        false,
          generate_secret: process.env.GENERATE_SECRET || '',
          message:         'You already have a free license. We\'ve resent your verification email — please check your inbox.',
        });
      }

      // Already verified — just return their key
      return res.json({
        success:         true,
        already_existed: true,
        verified:        true,
        generate_secret: process.env.GENERATE_SECRET || '',
        license_key:     existing.license_key,
        message:         'You already have a free license registered to this email.',
      });
    }

    // ── Check: IP rate limit (max 3 free registrations per IP per 24h) ─────
    const ipCheck = await client.query(
      `SELECT COUNT(*) as count FROM free_registrations
       WHERE registered_ip = $1
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [ip]
    );
    if (parseInt(ipCheck.rows[0].count) >= 3) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        success: false,
        error:   'Too many free registrations from this network. Please try again tomorrow or contact support.',
      });
    }

    // ── Create user (or find existing) ─────────────────────────────────────
    const userResult = await client.query(
      `INSERT INTO users (email, name, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [normalizedEmail, normalizedEmail.split('@')[0]]
    );
    const userId = userResult.rows[0].id;

    // ── Check: does this user already have a paid license? ─────────────────
    const paidCheck = await client.query(
      `SELECT id FROM license_keys 
       WHERE user_id = $1 AND tier != 'free' AND status = 'active'`,
      [userId]
    );
    // Paid users don't need a free license — but don't block them, just note it
    // They can still register a free key for a different domain if needed

    // ── Create free license key ─────────────────────────────────────────────
    const licenseKey = generateLicenseKey();
    const licenseResult = await client.query(
      `INSERT INTO license_keys 
         (user_id, license_key, tier, status, posts_limit, month_reset_date, email_verified)
       VALUES ($1, $2, 'free', 'active', 5, NOW() + INTERVAL '30 days', FALSE)
       RETURNING id`,
      [userId, licenseKey]
    );
    const licenseKeyId = licenseResult.rows[0].id;

    // ── Grant initial 5 free credits (expire in 1 year) ────────────────────
    await client.query(
      `INSERT INTO credit_batches
         (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
       VALUES ($1, 5, 5, NOW(), NOW() + INTERVAL '1 year', 'free_tier_initial')`,
      [licenseKeyId]
    );

    // ── Record free registration for abuse tracking ─────────────────────────
    await client.query(
      `INSERT INTO free_registrations
         (email, license_key_id, registered_domain, registered_ip, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [normalizedEmail, licenseKeyId, normalizedDomain, ip]
    );

    // ── Send verification email ─────────────────────────────────────────────
    await sendVerificationEmail(client, licenseKeyId, normalizedEmail, licenseKey);

    await client.query('COMMIT');

    return res.json({
      success:     true,
      already_existed: false,
      verified:    false,
      generate_secret: process.env.GENERATE_SECRET || '',
      message:     'Almost there! Check your email to verify your address and activate your free license.',
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[register-free] Error:', err.message);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
});

// ── Send verification email (shared by register + resend paths) ─────────────

async function sendVerificationEmail(client, licenseKeyId, email, licenseKey) {
  // Invalidate any existing unused tokens for this license
  await client.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE license_key_id = $1 AND used_at IS NULL`,
    [licenseKeyId]
  );

  // Get user_id for this license
  const lkResult = await client.query(
    `SELECT user_id FROM license_keys WHERE id = $1`,
    [licenseKeyId]
  );
  const userId = lkResult.rows[0].user_id;

  const token     = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await client.query(
    `INSERT INTO email_verification_tokens
       (user_id, license_key_id, token, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, licenseKeyId, token, expiresAt]
  );

  const verifyUrl = `${process.env.SERVER_URL}/verify-email?token=${token}`;

  // AICOBR_MAIL_DELIVERABILITY_2026_07_29
  // Three deliverability fixes, all of which push a transactional mail towards Junk
  // when missing:
  //   1. A plain-text alternative. HTML-only mail scores badly with every major
  //      filter and renders poorly on iOS Mail, which parses the whole HTML part
  //      before painting the body.
  //   2. A Reply-To on a monitored mailbox — a no-reply From with no Reply-To is a
  //      recognised bulk/phish signature.
  //   3. A From fallback. Every other route in this codebase has one; this route
  //      alone passes RESEND_FROM_EMAIL raw, so an unset var makes Resend reject
  //      the send with a 422 that the old code silently swallowed.
  const from = process.env.RESEND_FROM_EMAIL
    || 'AI Content Bridge <noreply@aicontentbridge.com>';

  const textBody = [
    'Verify your email — AI Content Bridge',
    '',
    'Thanks for signing up. Open the link below to verify your email address and',
    'activate your AI Content Bridge licence and 5 credits.',
    '',
    verifyUrl,
    '',
    `Your licence key: ${licenseKey}`,
    "Keep this safe — you'll need it to activate the plugin in WordPress.",
    '',
    'This link expires in 24 hours. If you did not request this, ignore this email.',
    'Questions? support@aicontentbridge.com',
  ].join('\n');

  const sent = await getResend()?.emails.send({
    from,
    to:       email,
    reply_to: process.env.SUPPORT_EMAIL || 'support@aicontentbridge.com',
    subject:  'Verify your email — AI Content Bridge',
    text:     textBody,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;padding:40px 20px;">
        <div style="max-width:520px;margin:0 auto;">

          <!-- Header -->
          <div style="background:#06101E;border-radius:14px 14px 0 0;padding:32px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#5CA5FF;">AI Content Bridge</p>
            <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;">Verify your email</h1>
            <p style="margin:10px 0 0;font-size:14px;color:#94a3b8;line-height:1.5;">One click to activate your free license and 5 credits</p>
          </div>

          <!-- Body -->
          <div style="background:#ffffff;padding:36px 32px;">
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.65;">
              Thanks for signing up! Click the button below to verify your email address and activate your AI Content Bridge license.
            </p>

            <!-- CTA Button — table-based for email client compatibility -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
              <tr>
                <td align="center">
                  <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background:#1B6EF3;border-radius:10px;">
                        <a href="${verifyUrl}"
                           style="display:inline-block;padding:15px 36px;background:#1B6EF3;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;font-family:Arial,sans-serif;mso-padding-alt:0;white-space:nowrap;">
                          Verify Email &amp; Activate License &#8594;
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- License key box -->
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:20px;margin:0 0 24px;text-align:center;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1B6EF3;">Your Licence Key</p>
              <p style="margin:0;font-family:'Courier New',monospace;font-size:17px;font-weight:700;color:#1e3a5f;letter-spacing:0.06em;">${licenseKey}</p>
              <p style="margin:10px 0 0;font-size:13px;color:#6b7280;">Keep this safe — you'll need it to activate the plugin in WordPress.</p>
            </div>

            <!-- Fallback link -->
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Button not working? Copy and paste this link into your browser:</p>
            <p style="margin:0;font-size:12px;word-break:break-all;">
              <a href="${verifyUrl}" style="color:#1B6EF3;">${verifyUrl}</a>
            </p>
          </div>

          <!-- Footer -->
          <div style="background:#f8fafc;border-radius:0 0 14px 14px;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">This link expires in 24 hours. If you didn't request this, ignore this email.</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Questions? <a href="mailto:support@aicontentbridge.com" style="color:#1B6EF3;text-decoration:none;">support@aicontentbridge.com</a>
            </p>
          </div>

        </div>
      </body>
      </html>
    `,
  });

  // The Resend SDK resolves with { data, error } rather than throwing on API
  // errors, so the old unconditional "email sent" log was printed even when the
  // send had failed — the single worst thing a log line can do during a launch.
  if (!sent) {
    console.warn(`[register-free] RESEND_API_KEY unset — no verification email sent to ${email}`);
  } else if (sent.error) {
    console.error(`[register-free] Verification email FAILED for ${email}:`,
      sent.error.message || sent.error);
  } else {
    console.log(`[register-free] Verification email sent to ${email} (id: ${sent.data?.id || 'n/a'})`);
  }
}

module.exports = router;
module.exports.sendVerificationEmail = sendVerificationEmail;