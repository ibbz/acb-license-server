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

// Customer portal page URL — single source of truth (portal-auth.js).
const { portalUrl } = require('./portal-auth');

// HTML-escape any dynamic value before interpolating it into the page.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// License key display with a one-click copy button.
const keyBox = (licenseKey) => `
  <div class="key-box">
    <div class="key-label">Your License Key</div>
    <div class="key-row">
      <div class="key-value" id="acbKey">${esc(licenseKey)}</div>
      <button type="button" class="copy-btn" id="acbCopy" aria-label="Copy license key" title="Copy">
        <svg class="copy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>
        <svg class="check-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
      </button>
    </div>
  </div>`;

// ── Shared HTML page renderer ─────────────────────────────────────────────

const page = ({ success, title, body }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — AI Content Bridge</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
    :root{
      --navy:#06101E; --navy2:#0C1A2E; --navy3:#122038; --navy0:#0A1424;
      --blue:#1B6EF3; --blue2:#1458CC; --blue3:#5CA5FF;
      --ink:#F0F4FF; --dim:rgba(200,214,240,0.62); --line:rgba(255,255,255,0.07);
      --serif:'Instrument Serif',Georgia,'Times New Roman',serif;
      --sans:'DM Sans',system-ui,-apple-system,sans-serif;
      --mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body{
      font-family:var(--sans); color:var(--ink);
      min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
      background:var(--navy);
      background-image:
        radial-gradient(60% 50% at 50% -10%, rgba(27,110,243,0.22), transparent 70%),
        radial-gradient(42% 42% at 88% 112%, rgba(92,165,255,0.12), transparent 70%);
      background-attachment:fixed;
    }
    .card{
      position:relative; width:100%; max-width:480px; text-align:center;
      background:linear-gradient(180deg, rgba(18,32,56,0.92), rgba(12,26,46,0.95));
      border:1px solid var(--line); border-radius:22px; padding:42px 38px 34px;
      box-shadow:0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(27,110,243,0.06), inset 0 1px 0 rgba(255,255,255,0.04);
      overflow:hidden;
    }
    .card::before{
      content:""; position:absolute; left:0; right:0; top:0; height:1px;
      background:linear-gradient(90deg, transparent, rgba(92,165,255,0.6), transparent);
    }
    .brand{ display:inline-flex; align-items:center; gap:9px; margin-bottom:26px; }
    .brand svg{ display:block; }
    .brand-logo{ height:30px; width:auto; display:block; filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4)); }
    .brand-name{ font-family:var(--sans); font-weight:600; font-size:30px; letter-spacing:-0.01em; color:var(--ink); }
    .brand-name b{ color:var(--blue3); font-weight:600; }
    .activate-head{ font-family:var(--mono); font-size:11px; letter-spacing:0.13em; text-transform:uppercase; color:var(--blue3); text-align:center; margin:26px 0 14px; }
    .path{ background:var(--navy0); border:1px solid var(--line); border-radius:13px; padding:18px 18px 16px; margin-bottom:12px; text-align:left; }
    .path:last-child{ margin-bottom:0; }
    .path-tag{ display:flex; align-items:center; gap:9px; font-family:var(--sans); font-weight:600; font-size:14.5px; color:#fff; margin-bottom:5px; }
    .path-tag svg{ flex-shrink:0; color:var(--blue3); }
    .path-sub{ font-size:12.5px; color:var(--dim); line-height:1.5; margin:0 0 13px; }
    .path .step{ font-size:13.5px; margin-bottom:11px; }
    .path-btn{ display:inline-flex; align-items:center; gap:6px; margin-top:13px; padding:9px 16px; border-radius:9px; background:linear-gradient(135deg,var(--blue),var(--blue2)); color:#fff; font-family:var(--sans); font-weight:600; font-size:13px; text-decoration:none; box-shadow:0 6px 18px rgba(27,110,243,0.32); }
    .path-btn:hover{ filter:brightness(1.07); }
    .muted{ color:rgba(200,214,240,0.45); font-weight:400; }
    .icon{
      width:74px; height:74px; border-radius:50%; display:flex; align-items:center; justify-content:center;
      margin:0 auto 22px; font-size:34px; line-height:1; color:#fff; position:relative;
    }
    .icon::after{ content:""; position:absolute; inset:-6px; border-radius:50%; }
    .icon.success{ background:linear-gradient(135deg,#22C55E,#15803D); }
    .icon.success::after{ box-shadow:0 0 0 1px rgba(34,197,94,0.35), 0 0 30px rgba(34,197,94,0.45); }
    .icon.error{ background:linear-gradient(135deg,#EF4444,#B91C1C); }
    .icon.error::after{ box-shadow:0 0 0 1px rgba(239,68,68,0.35), 0 0 30px rgba(239,68,68,0.40); }
    h1{
      font-family:var(--serif); font-style:italic; font-weight:400;
      font-size:clamp(28px,7vw,36px); line-height:1.12; letter-spacing:0.01em; margin-bottom:14px;
      color:#fff;
      background:linear-gradient(118deg,#ffffff 32%,var(--blue3));
      -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;
    }
    p{ font-size:15px; color:var(--dim); line-height:1.65; margin-bottom:14px; }
    p strong{ color:var(--ink); font-weight:600; }
    .key-box{ background:var(--navy3); border:1px solid rgba(27,110,243,0.32); border-radius:13px; padding:16px 18px; margin:22px 0; text-align:left; }
    .key-label{ font-family:var(--mono); font-size:11px; font-weight:500; color:var(--blue3); text-transform:uppercase; letter-spacing:0.13em; margin-bottom:7px; }
    .key-value{ font-family:var(--mono); font-size:16.5px; font-weight:500; color:#fff; letter-spacing:0.02em; word-break:break-all; line-height:1.4; }
    .key-row{ display:flex; align-items:center; gap:10px; }
    .key-row .key-value{ flex:1; min-width:0; }
    .copy-btn{ flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:9px; cursor:pointer; background:rgba(27,110,243,0.12); border:1px solid rgba(27,110,243,0.30); color:var(--blue3); transition:background .15s ease, border-color .15s ease, color .15s ease, transform .08s ease; }
    .copy-btn:hover{ background:rgba(27,110,243,0.20); border-color:rgba(27,110,243,0.50); color:#fff; }
    .copy-btn:active{ transform:translateY(1px); }
    .copy-btn svg{ width:16px; height:16px; display:block; }
    .copy-btn .check-ic{ display:none; }
    .copy-btn.copied{ background:rgba(34,197,94,0.16); border-color:rgba(34,197,94,0.45); color:#22C55E; }
    .copy-btn.copied .copy-ic{ display:none; }
    .copy-btn.copied .check-ic{ display:block; }
    .steps{ background:var(--navy0); border:1px solid var(--line); border-radius:13px; padding:20px; margin:22px 0 6px; text-align:left; }
    .step{ display:flex; align-items:flex-start; gap:12px; margin-bottom:13px; font-size:14px; color:rgba(224,232,248,0.82); line-height:1.5; }
    .step:last-child{ margin-bottom:0; }
    .step strong{ color:#fff; font-weight:600; }
    .step-num{ flex-shrink:0; width:23px; height:23px; border-radius:50%; background:var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:12px; font-weight:500; margin-top:1px; }
    .support{ margin-top:22px; font-size:13px; color:rgba(200,214,240,0.42); }
    .support a{ color:var(--blue3); text-decoration:none; }
    .support a:hover{ text-decoration:underline; }
    @media (max-width:480px){ .card{ padding:34px 22px 28px; border-radius:18px; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img class="brand-logo" src="data:image/png;base64,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" alt="AI Content Bridge logo">
      <span class="brand-name">Content <b>Bridge</b></span>
    </div>
    <div class="icon ${success ? 'success' : 'error'}">${success ? '&#10003;' : '&#10007;'}</div>
    <h1>${title}</h1>
    ${body}
    <p class="support">Questions? <a href="mailto:support@aicontentbridge.com">support@aicontentbridge.com</a></p>
  </div>
  <script>
  (function(){
    var btn=document.getElementById('acbCopy');
    var key=document.getElementById('acbKey');
    if(!btn||!key) return;
    function flash(){
      btn.classList.add('copied'); btn.setAttribute('title','Copied!');
      setTimeout(function(){ btn.classList.remove('copied'); btn.setAttribute('title','Copy'); }, 1600);
    }
    function fallback(text){
      try{
        var ta=document.createElement('textarea');
        ta.value=text; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); flash();
      }catch(e){}
    }
    btn.addEventListener('click', function(){
      var text=(key.textContent||'').trim();
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(flash, function(){ fallback(text); });
      } else { fallback(text); }
    });
  })();
  </script>
</body>
</html>
`;

// ── Activation guidance — covers BOTH onboarding journeys ───────────────────
// A user may arrive here having already installed the plugin (registered via the
// in-plugin setup wizard), OR straight from the website (plugin not yet installed
// — they must sign in to the portal and download it first). We show both paths.
const activationHelp = (portalHref) => `
  <div class="activate-head">Two ways to activate — pick the one that's you</div>

  <div class="path">
    <div class="path-tag">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      Already installed the plugin from WordPress?
    </div>
    <p class="path-sub">You registered through the plugin's setup wizard — you're almost done.</p>
    <div class="step"><div class="step-num">1</div><div>Go back to the <strong>AI Content Bridge</strong> screen in your WordPress admin</div></div>
    <div class="step"><div class="step-num">2</div><div>Paste the license key above into the setup wizard or <strong>Settings</strong></div></div>
    <div class="step"><div class="step-num">3</div><div>Click <strong>Save / Verify License</strong> — you're ready to generate</div></div>
  </div>

  <div class="path">
    <div class="path-tag">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
      Registered here on the website?
    </div>
    <p class="path-sub">Grab the plugin from your account portal first, then activate it with this key.</p>
    <div class="step"><div class="step-num">1</div><div>Open your <strong>account portal</strong> and sign in with your email <span class="muted">— we'll email you a magic link</span></div></div>
    <div class="step"><div class="step-num">2</div><div><strong>Download</strong> the AI Content Bridge plugin from the portal</div></div>
    <div class="step"><div class="step-num">3</div><div>In WordPress, go to <strong>Plugins &rarr; Add New &rarr; Upload Plugin</strong> and activate it</div></div>
    <div class="step"><div class="step-num">4</div><div>Open <strong>AI Content Bridge &rarr; Settings</strong>, paste your license key and save</div></div>
    <a class="path-btn" href="${portalHref}">Go to your portal &rarr;</a>
  </div>
`;

// ── Route ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  // This route renders HTML, so it overrides the API's global `default-src 'none'`
  // CSP with one scoped to this page: inline styles + Google Fonts only.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "script-src 'unsafe-inline'; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'"
  );

  const portalHref = portalUrl();
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
            ${keyBox(row.license_key)}
            ${activationHelp(portalHref)}
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
      title:   'Email verified',
      body: `
        <p>Your email <strong>${esc(row.email)}</strong> is verified and your free license is now active.</p>
        ${keyBox(row.license_key)}
        ${activationHelp(portalHref)}
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