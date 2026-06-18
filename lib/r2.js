// lib/r2.js
// Thin wrapper over the S3-compatible Cloudflare R2 API for storing and serving
// plugin release zips. Requires these Railway env vars:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// Deps (add to package.json): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
//
// IMPORTANT: the AWS SDK is loaded LAZILY (inside sdk(), on first use) rather
// than at module load. This module is pulled in at server boot via the route
// graph, so a missing/uninstalled SDK or a misconfigured bucket must only break
// the download/update endpoints — never crash the whole licence server.

let _sdk = null;
function sdk() {
  if (_sdk) return _sdk;
  try {
    const s3 = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    _sdk = {
      S3Client:          s3.S3Client,
      GetObjectCommand:  s3.GetObjectCommand,
      PutObjectCommand:  s3.PutObjectCommand,
      HeadObjectCommand: s3.HeadObjectCommand,
      getSignedUrl,
    };
  } catch (e) {
    throw new Error(
      'R2 storage SDK not installed. Run `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.'
    );
  }
  return _sdk;
}

let _client = null;
function client() {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).');
  }
  const { S3Client } = sdk();
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // AWS SDK v3 (>=~3.729) injects CRC32 integrity checksums into requests by
    // default, which breaks R2 presigned browser uploads (the empty-body
    // checksum gets baked into the signed URL). Only add checksums when an
    // operation actually requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

function bucket() {
  return process.env.R2_BUCKET;
}

// Short-lived signed URL to DOWNLOAD an object (default 5 minutes).
async function presignGet(key, expiresIn = 300) {
  const { GetObjectCommand, getSignedUrl } = sdk();
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// Short-lived signed URL to UPLOAD an object directly from the browser
// (admin release upload). Default 10 minutes.
async function presignPut(key, contentType = 'application/zip', expiresIn = 600) {
  const { PutObjectCommand, getSignedUrl } = sdk();
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// Confirm an object exists and return its size (used to verify an upload landed).
async function headObject(key) {
  const { HeadObjectCommand } = sdk();
  const out = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  return { size: out.ContentLength, contentType: out.ContentType };
}

// True only when both the env config AND the SDK are present, so callers can
// return a clean 503 instead of triggering a thrown error.
function isConfigured() {
  const envOk = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
  if (!envOk) return false;
  try { sdk(); return true; } catch { return false; }
}

// Granular readiness for the /health endpoint. Reports booleans only — never
// the secret values — plus the running Node version (the SDK needs >=20).
function diagnose() {
  const env = {
    R2_ACCOUNT_ID:        !!process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID:     !!process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET:            !!process.env.R2_BUCKET,
  };
  let sdk_loaded = false;
  let sdk_error = null;
  try { sdk(); sdk_loaded = true; } catch (e) { sdk_error = e.message; }
  return {
    node_version:     process.version,
    env_all_present:  Object.values(env).every(Boolean),
    env,
    sdk_loaded,
    sdk_error,
    ready:            Object.values(env).every(Boolean) && sdk_loaded,
  };
}

module.exports = { presignGet, presignPut, headObject, isConfigured, diagnose };
