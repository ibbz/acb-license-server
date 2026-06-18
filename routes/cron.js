// routes/cron.js
// POST /api/cron/grant-due
// Sweeps annual subscriptions due a monthly credit top-up.
//
// Guarded by a shared secret in the `x-cron-secret` header (env CRON_SECRET).
// Call it once a day from any scheduler — Railway cron, cron-job.org, a GitHub
// Actions schedule, etc. It is idempotent, so extra calls are harmless.
//
// If CRON_SECRET is unset the endpoint refuses all requests (fail closed).

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const { grantDueAnnualCredits } = require('../lib/subscription-credits');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const crypto = require('crypto');
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post('/grant-due', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers['x-cron-secret'], secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const granted = await grantDueAnnualCredits(pool, {});
    console.log(`[cron] grant-due swept annual subscriptions, granted=${granted}`);
    res.json({ success: true, granted });
  } catch (err) {
    console.error('[cron] grant-due failed:', err.message);
    res.status(500).json({ error: 'grant-due failed' });
  }
});

module.exports = router;
