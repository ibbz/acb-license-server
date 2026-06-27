/**
 * AI Content Bridge — License Server (ACB-only)
 * Split out from the former shared LearnBridge/ACB server.
 *
 * Production license validation, usage tracking, generation proxy and
 * customer/admin portals for the AI Content Bridge WordPress plugin.
 * Deployed on Railway with its own PostgreSQL database.
 */

require('dotenv').config();
const express = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

// Initialize Express
const app = express();
app.set('trust proxy', 1);           // honour Railway's X-Forwarded-For
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// ─── Process-level safety net ─────────────────────────────────────────────────
// The generation pipeline runs fire-and-forget after responding to WordPress, so a
// stray rejection in that async work has no caller to catch it. Without this, Node
// (v15+) terminates the process — stranding the in-flight entry on 'generating' and
// cutting the logs on restart. Log and keep serving instead; per-request handlers
// still mark their own entry 'failed'.
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  // Last-resort net. An uncaught exception can leave state inconsistent, so treat
  // this as a safety log, not a substitute for handling errors at their source.
  console.error('❌ Uncaught exception:', err && err.stack ? err.stack : err);
});


// ─── CORS allowlist ───────────────────────────────────────────────────────────
// Locked to known origins instead of '*'. Override via the CORS_ALLOWED_ORIGINS
// env var (comma-separated) without a code change.
// IMPORTANT: set CORS_ALLOWED_ORIGINS to wherever the ACB marketing site and the
// customer/admin/beta portals are actually hosted. The defaults below are only a
// starting guess. The WordPress plugin calls server-to-server (no Origin header)
// and is unaffected by CORS; the browser-based portals are the ones that need
// their origin listed here.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://aicontentbridge.com',
  'https://www.aicontentbridge.com',
  'http://localhost:5173',              // Vite dev
  'http://localhost:4173',              // Vite preview
];

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS);

function isOriginAllowed(origin) {
  if (!origin) return true;                       // non-browser / same-origin / server-to-server (e.g. the WP plugin)
  if (origin === 'null') return true;             // file:// local access (acb-admin.html opened directly)
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-generate-secret', 'x-admin-secret'],
  credentials: true,
};

app.use(cors(corsOptions));

// Explicitly handle preflight OPTIONS requests for all routes
app.options('*', cors(corsOptions));

// ─── Security headers ─────────────────────────────────────────────────────────
// Applied to every response. Safe for a pure JSON API server — no HTML/scripts
// are served so CSP default-src 'none' is appropriate.
// /verify-email is the one exception: it renders HTML and sets its own CSP.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Cookie parser — kept as a standard middleware in case a portal flow sets cookies.
app.use(cookieParser());

// IMPORTANT: Stripe webhook needs the RAW body for signature verification.
// Must be registered BEFORE express.json() parses the body.
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));

// All other routes get normal JSON parsing — 10mb limit for image payloads.
app.use((req, res, next) => {
  if (req.path === '/api/stripe-webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});

// ─── Rate limiters ────────────────────────────────────────────────────────────
const magicLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,                      // 5 attempts per IP per hour
  message: { error: 'Too many sign-in attempts. Please try again later.' }
});
app.use('/api/portal/magic-request', magicLinkLimiter);

// Generation: tighter per-IP limit
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Generation rate limit exceeded. Please wait before generating again.' }
});
app.use('/api/generate', generateLimiter);

// Free registration limiter: max 3 per IP per hour.
const freeRegLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, error: 'Too many registration attempts. Please try again later.' }
});
app.use('/api/register-free', freeRegLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0-acb',
    r2: require('./lib/r2').diagnose()
  });
});

// ─── API Routes (ACB) ───────────────────────────────────────────────────────
app.use('/api/validate',                require('./routes/validate'));
app.use('/api/verify-license',          require('./routes/verify-license'));
app.use('/api/register-free',           require('./routes/register-free'));
app.use('/api/extract-style',           require('./routes/extract-style'));
app.use('/api/usage',                   require('./routes/usage'));
app.use('/api/stripe-webhook',          require('./routes/stripe-webhook'));
app.use('/api/buy-credits',             require('./routes/buy-credits'));
app.use('/api/credits',                 require('./routes/credits'));
app.use('/api/deduct-credit',           require('./routes/deduct-credit'));
app.use('/api/refund-credits',          require('./routes/refund-credits'));
app.use('/api/generate',                require('./routes/generate'));
app.use('/api/create-checkout-session', require('./routes/create-checkout-session'));
app.use('/api/admin',                   require('./routes/admin'));
app.use('/api/admin',                   require('./routes/admin-dashboard'));
app.use('/api/portal',                  require('./routes/portal-auth').router);
app.use('/api/portal',                  require('./routes/portal-magic'));
app.use('/api/portal',                  require('./routes/portal-stripe'));
app.use('/api/portal/support',          require('./routes/portal-support'));
app.use('/api/beta-feedback',           require('./routes/beta-feedback'));
app.use('/api/cron',                    require('./routes/cron'));
app.use('/api/plugin',                  require('./routes/plugin-updates'));
app.use('/api/outline',                 require('./routes/outline'));
app.use('/api/portal',                  require('./routes/portal-download'));
app.use('/api/portal/support', 			require('./routes/portal-support-chat'));
app.use('/api/admin',                   require('./routes/admin-releases'));

// Email verification page (GET — renders HTML; sets its own CSP).
app.use('/verify-email',                require('./routes/verify-email'));

console.log('✅ ACB routes mounted');

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'AI Content Bridge License Server',
    version: '1.0.0-acb',
    endpoints: {
      validate:        'POST /api/validate',
      usage:           'POST /api/usage',
      credits:         'GET  /api/credits',
      generate:        'POST /api/generate',
      checkout:        'POST /api/create-checkout-session',
      stripeWebhook:   'POST /api/stripe-webhook'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 ACB License Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Generation can take a while — extend timeouts beyond Railway's 30s default.
// headersTimeout must be > keepAliveTimeout per Node.js docs.
server.keepAliveTimeout = 120_000;   // 120s
server.headersTimeout   = 125_000;   // 125s
