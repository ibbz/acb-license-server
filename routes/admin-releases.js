// routes/admin-releases.js
// Admin-only plugin release management (x-admin-secret).
//
//   POST /api/admin/releases/presign  — get a presigned PUT URL to upload a zip
//                                        straight to R2 from the admin browser
//   POST /api/admin/releases          — register an uploaded zip as a version
//                                        (and make it the latest)
//   GET  /api/admin/releases          — list versions
//
// Upload flow: presign -> browser PUTs the file to R2 -> register metadata.
// Large zips never stream through this server.

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const r2 = require('../lib/r2');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const requireAdminSecret = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

const VERSION_RE = /^\d+\.\d+(\.\d+)?$/;

// ── POST /api/admin/releases/presign ────────────────────────────────────────
router.post('/releases/presign', requireAdminSecret, async (req, res) => {
  const version = String((req.body && req.body.version) || '').trim();
  if (!VERSION_RE.test(version)) {
    return res.status(400).json({ error: 'A valid dotted version is required, e.g. 2.5.0' });
  }
  if (!r2.isConfigured()) {
    return res.status(503).json({ error: 'R2 is not configured.' });
  }
  try {
    const fileKey = `releases/ai-content-bridge-${version}.zip`;
    const uploadUrl = await r2.presignPut(fileKey, 'application/zip', 600);
    res.json({ success: true, file_key: fileKey, upload_url: uploadUrl });
  } catch (err) {
    console.error('[admin/releases/presign]', err.message);
    res.status(500).json({ error: 'Could not create upload URL.' });
  }
});

// ── POST /api/admin/releases ────────────────────────────────────────────────
router.post('/releases', requireAdminSecret, async (req, res) => {
  const b = req.body || {};
  const version = String(b.version || '').trim();
  const fileKey = String(b.file_key || '').trim();
  if (!VERSION_RE.test(version) || !fileKey) {
    return res.status(400).json({ error: 'version and file_key are required.' });
  }

  const client = await pool.connect();
  try {
    // Confirm the upload actually landed in R2 and capture its real size.
    let fileSize = b.file_size ? parseInt(b.file_size, 10) : null;
    if (r2.isConfigured()) {
      try {
        const head = await r2.headObject(fileKey);
        fileSize = head.size || fileSize;
      } catch {
        return res.status(400).json({ error: 'Uploaded file not found in storage — upload it before registering.' });
      }
    }

    await client.query('BEGIN');
    // New version becomes the sole latest.
    await client.query(`UPDATE plugin_releases SET is_latest = false WHERE is_latest = true`);
    await client.query(
      `INSERT INTO plugin_releases
         (version, file_key, file_size, checksum, changelog, requires_wp, tested_wp, requires_php, is_latest)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'5.8'),$7,COALESCE($8,'7.4'),true)
       ON CONFLICT (version) DO UPDATE SET
         file_key = EXCLUDED.file_key,
         file_size = EXCLUDED.file_size,
         checksum = EXCLUDED.checksum,
         changelog = EXCLUDED.changelog,
         requires_wp = EXCLUDED.requires_wp,
         tested_wp = EXCLUDED.tested_wp,
         requires_php = EXCLUDED.requires_php,
         is_latest = true,
         released_at = NOW()`,
      [version, fileKey, fileSize, b.checksum || null, b.changelog || null,
       b.requires_wp || null, b.tested_wp || null, b.requires_php || null]
    );
    await client.query('COMMIT');
    console.log(`[admin/releases] Published ${version} (${fileKey})`);
    res.json({ success: true, version, file_key: fileKey, file_size: fileSize });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin/releases]', err.message);
    res.status(500).json({ error: 'Could not register release.' });
  } finally {
    client.release();
  }
});

// ── GET /api/admin/releases ─────────────────────────────────────────────────
router.get('/releases', requireAdminSecret, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT version, file_key, file_size, changelog, requires_wp, tested_wp,
              requires_php, is_latest, released_at
       FROM plugin_releases ORDER BY released_at DESC`
    );
    res.json({ success: true, releases: r.rows });
  } catch (err) {
    console.error('[admin/releases list]', err.message);
    res.status(500).json({ error: 'Could not list releases.' });
  }
});

module.exports = router;
