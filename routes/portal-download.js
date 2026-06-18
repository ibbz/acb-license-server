// routes/portal-download.js
// GET /api/portal/download — returns the current plugin release metadata and a
// short-lived signed R2 URL for the logged-in customer to download the zip.
// Mounted under /api/portal, so it inherits the portal JWT auth.

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const { requireAuth } = require('./portal-auth');
const r2 = require('../lib/r2');
const { getLatestRelease } = require('../lib/releases');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

router.get('/download', requireAuth, async (req, res) => {
  try {
    const latest = await getLatestRelease(pool);
    if (!latest) {
      return res.status(404).json({ error: 'No plugin release is available yet.' });
    }
    if (!r2.isConfigured()) {
      return res.status(503).json({ error: 'Downloads are not configured.' });
    }
    const url = await r2.presignGet(latest.file_key, 300);
    res.json({
      success:   true,
      version:   latest.version,
      changelog: latest.changelog || '',
      file_size: latest.file_size ? Number(latest.file_size) : null,
      released_at: latest.released_at,
      url,          // valid ~5 minutes; the browser should use it immediately
    });
  } catch (err) {
    console.error('[portal/download]', err.message);
    res.status(500).json({ error: 'Could not prepare download.' });
  }
});

module.exports = router;
