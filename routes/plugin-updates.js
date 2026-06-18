// routes/plugin-updates.js
// Licensed auto-update channel for the WordPress plugin.
//
//   POST /api/plugin/update-check   — plugin asks "is there a newer version?"
//   GET  /api/plugin/package        — token-gated 302 to a signed R2 download
//
// Update eligibility is gated on an ACTIVE licence (any tier, including free —
// every installed site should be able to pull security fixes). The licence key
// is never placed in a URL; the package link carries a short-lived capability
// token instead.

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const r2 = require('../lib/r2');
const {
  compareVersions, getLatestRelease, getReleaseByVersion,
  issueDownloadToken, verifyDownloadToken,
} = require('../lib/releases');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function publicBaseUrl(req) {
  return process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
}

// ── POST /api/plugin/update-check ───────────────────────────────────────────
router.post('/update-check', async (req, res) => {
  const licenseKey = (req.body && req.body.license_key) || '';
  const current    = (req.body && req.body.version) || '0';

  if (!licenseKey) {
    return res.status(400).json({ error: 'license_key is required' });
  }

  try {
    // Gate on an active licence. Tier is irrelevant for update eligibility.
    const lic = await pool.query(
      `SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'`,
      [licenseKey]
    );
    if (lic.rows.length === 0) {
      // 200 with update_available:false — keeps the plugin's update screen quiet
      // for lapsed/invalid licences rather than surfacing an error in wp-admin.
      return res.json({ update_available: false, reason: 'inactive_license' });
    }
    const licenseId = lic.rows[0].id;

    const latest = await getLatestRelease(pool);
    if (!latest) {
      return res.json({ update_available: false, reason: 'no_release' });
    }

    const newer = compareVersions(latest.version, current) > 0;
    if (!newer) {
      return res.json({ update_available: false, version: latest.version });
    }

    const token = issueDownloadToken(licenseId, latest.version);
    const packageUrl = `${publicBaseUrl(req)}/api/plugin/package?token=${encodeURIComponent(token)}`;

    return res.json({
      update_available: true,
      version:      latest.version,
      package:      packageUrl,
      requires:     latest.requires_wp,
      tested:       latest.tested_wp,
      requires_php: latest.requires_php,
      changelog:    latest.changelog || '',
      name:         'AI Content Bridge',
      homepage:     'https://aicontentbridge.com',
    });
  } catch (err) {
    console.error('[update-check]', err.message);
    return res.status(500).json({ error: 'update check failed' });
  }
});

// ── GET /api/plugin/package?token=... ───────────────────────────────────────
// WordPress fetches this server-side when the user clicks "update now". Verify
// the capability token, re-check the licence is still active, then redirect to
// a freshly-signed (5-minute) R2 URL.
router.get('/package', async (req, res) => {
  const claim = verifyDownloadToken(req.query.token);
  if (!claim) {
    return res.status(403).send('Invalid or expired download token.');
  }
  try {
    const lic = await pool.query(
      `SELECT id FROM license_keys WHERE id = $1 AND status = 'active'`,
      [claim.licenseId]
    );
    if (lic.rows.length === 0) {
      return res.status(403).send('Licence is no longer active.');
    }
    const release = await getReleaseByVersion(pool, claim.version);
    if (!release) {
      return res.status(404).send('Release not found.');
    }
    if (!r2.isConfigured()) {
      return res.status(503).send('Downloads are not configured.');
    }
    const url = await r2.presignGet(release.file_key, 300);
    return res.redirect(302, url);
  } catch (err) {
    console.error('[plugin/package]', err.message);
    return res.status(500).send('Download failed.');
  }
});

module.exports = router;
