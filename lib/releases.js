// lib/releases.js
// Helpers around the plugin_releases table + the short-lived capability token
// used by the plugin update flow (so the licence key never appears in a URL).

const crypto = require('crypto');

function tokenSecret() {
  return process.env.DOWNLOAD_TOKEN_SECRET || process.env.JWT_SECRET || '';
}

// Compare dotted versions. Returns 1 if a>b, -1 if a<b, 0 if equal.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function getLatestRelease(pool) {
  const r = await pool.query(
    `SELECT * FROM plugin_releases WHERE is_latest = true ORDER BY released_at DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

async function getReleaseByVersion(pool, version) {
  const r = await pool.query(`SELECT * FROM plugin_releases WHERE version = $1`, [version]);
  return r.rows[0] || null;
}

// Issue a capability token authorising download of a specific version by a
// specific licence, valid for `ttlSeconds` (default 24h). HMAC-signed, URL-safe.
// Payload: licenseId.version.expiry  ->  base64url(payload).hex(hmac)
function issueDownloadToken(licenseId, version, ttlSeconds = 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${licenseId}|${version}|${exp}`;
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

// Verify a capability token. Returns { licenseId, version } or null.
function verifyDownloadToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const b64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', tokenSecret()).update(b64).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  const [licenseId, version, expStr] = payload.split('|');
  const exp = parseInt(expStr, 10);
  if (!licenseId || !version || !exp || exp < Math.floor(Date.now() / 1000)) return null;
  return { licenseId: parseInt(licenseId, 10), version };
}

module.exports = {
  compareVersions,
  getLatestRelease,
  getReleaseByVersion,
  issueDownloadToken,
  verifyDownloadToken,
};
