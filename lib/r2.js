// lib/r2.js
// Thin wrapper over the S3-compatible Cloudflare R2 API for storing and serving
// plugin release zips. Requires these Railway env vars:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// Deps (add to package.json): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let _client = null;
function client() {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    throw new Error('R2 is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

function bucket() {
  return process.env.R2_BUCKET;
}

// Short-lived signed URL to DOWNLOAD an object (default 5 minutes).
async function presignGet(key, expiresIn = 300) {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// Short-lived signed URL to UPLOAD an object directly from the browser
// (admin release upload). Default 10 minutes.
async function presignPut(key, contentType = 'application/zip', expiresIn = 600) {
  const cmd = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn });
}

// Confirm an object exists and return its size (used to verify an upload landed).
async function headObject(key) {
  const out = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  return { size: out.ContentLength, contentType: out.ContentType };
}

function isConfigured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

module.exports = { presignGet, presignPut, headObject, isConfigured };
