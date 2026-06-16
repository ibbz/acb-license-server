// routes/portal-support.js
// POST /api/portal/support — stores ticket in DB and emails you via Resend

const express = require('express');
const router  = express.Router();
const { Resend } = require('resend');
const { Pool }   = require('pg');
const { requireAuth } = require('./portal-auth');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// Lazy, guarded Resend client — keeps the server booting even if
// RESEND_API_KEY is unset; email simply no-ops until the key is configured.
let _resend = null;
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

router.post('/', requireAuth, async (req, res) => {
  const { category, subject, description, wp_version } = req.body;
  if (!category || !subject || !description) {
    return res.status(400).json({ error: 'Category, subject and description are required.' });
  }

  try {
    // Store in DB
    await pool.query(`
      INSERT INTO support_tickets
        (license_key, email, name, tier, domain, category, subject, description, wp_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      req.user.license_key,
      req.user.email,
      req.user.email.split('@')[0],
      req.user.tier,
      req.user.domain || '—',
      category, subject, description,
      wp_version || '—',
    ]).catch(() => {}); // Non-fatal if table doesn't exist yet

    // Email notification
    await getResend()?.emails.send({
      from:    process.env.RESEND_FROM_EMAIL || 'AI Content Bridge <noreply@aicontentbridge.com>',
      to:      process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'support@aicontentbridge.com',
      subject: `🎫 Support Ticket: ${subject} [${req.user.tier}]`,
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:32px 24px">
          <div style="background:#06101E;border-radius:12px;padding:24px 28px;margin-bottom:20px">
            <h2 style="margin:0;color:#5CA5FF;font-size:18px;font-weight:400;font-style:italic">Support Ticket</h2>
            <p style="margin:4px 0 0;color:rgba(200,214,240,0.5);font-size:13px">AI Content Bridge</p>
          </div>
          <div style="background:#fff;border-radius:10px;padding:20px 24px;margin-bottom:14px;border:1px solid #e5e7eb">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:5px 0;color:#6b7280;font-size:13px;width:120px">From</td><td style="font-weight:600;color:#111">${req.user.name} &lt;${req.user.email}&gt;</td></tr>
              <tr><td style="padding:5px 0;color:#6b7280;font-size:13px">Plan</td><td style="color:#10acf5;font-weight:600">${req.user.tier}</td></tr>
              <tr><td style="padding:5px 0;color:#6b7280;font-size:13px">Domain</td><td style="color:#374151;font-family:monospace;font-size:12px">${req.user.domain || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:#6b7280;font-size:13px">WP Version</td><td style="color:#374151">${wp_version || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:#6b7280;font-size:13px">Category</td><td style="color:#374151">${category}</td></tr>
            </table>
          </div>
          <div style="background:#fff;border-radius:10px;padding:20px 24px;border:1px solid #e5e7eb">
            <h3 style="margin:0 0 12px;font-size:15px;color:#111">${subject}</h3>
            <p style="margin:0;font-size:14px;color:#374151;line-height:1.65;white-space:pre-wrap">${description}</p>
          </div>
          <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center">License: ${req.user.license_key}</p>
        </div>
      `,
    });

    // Confirmation email to customer
    await getResend()?.emails.send({
      from:    process.env.RESEND_FROM_EMAIL || 'AI Content Bridge <noreply@aicontentbridge.com>',
      to:      req.user.email,
      subject: `We got your message — ${subject}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px 20px;background:#f8fafc;">
          <div style="background:#06101E;border-radius:12px;padding:24px 28px;margin-bottom:20px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#5CA5FF;">AI Content Bridge</p>
            <h2 style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Support ticket received</h2>
          </div>
          <div style="background:#fff;border-radius:10px;padding:24px;">
            <p style="margin:0 0 12px;font-size:15px;color:#374151;">Hi ${req.user.email.split('@')[0]},</p>
            <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">We've received your support request about <strong>${subject}</strong>.</p>
            <p style="margin:0 0 16px;font-size:14px;color:#374151;">We typically respond within one business day. Pro and Agency customers get priority.</p>
            <div style="background:#EAF6FE;border:1px solid #B5E2FA;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#10acf5;">Your ticket reference</p>
              <p style="margin:0;font-family:'Courier New',monospace;font-size:13px;color:#06101E;">${req.user.license_key}-${Date.now()}</p>
            </div>
            <p style="margin:0;font-size:13px;color:#6b7280;">AI Content Bridge Support &bull; <a href="mailto:support@aicontentbridge.com" style="color:#10acf5;">support@aicontentbridge.com</a></p>
          </div>
        </div>
      `,
    });

    console.log(`[portal/support] Ticket from ${req.user.email}: ${subject}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[portal/support]', err.message);
    res.status(500).json({ error: 'Failed to submit ticket. Please email support@aicontentbridge.com directly.' });
  }
});

module.exports = router;
