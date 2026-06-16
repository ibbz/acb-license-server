# AI Content Bridge — License Server (ACB-only)

Backend for the AI Content Bridge WordPress plugin: license validation, credit/usage
tracking, the generation proxy, Stripe billing, and the customer / admin / beta portals.
Node.js + Express + PostgreSQL, deployed on Railway.

This repo was split out of the former combined server that hosted both AI Content Bridge
and LearnBridge. **All LearnBridge code has been removed** — this instance serves ACB only.

## What was removed in the split

* All `routes/lb-*.js` LearnBridge route files (auth, SSO, programmes, courses, briefs,
  exports, SME, discovery, skills intelligence, teams, etc.).
* `lib/teams.js`, `lib/r2.js` (Cloudflare R2), `lib/licenseKeyHeader.js`
  (the `x-lb-license` header shim) — none are used by ACB.
* The LearnBridge route mounts, SAML/SSO CORS handling, LB rate limiters, the
  `x-lb-license` middleware, and the orphaned-brief startup cleanup in `server.js`.
* LearnBridge-only dependencies from `package.json`: `@aws-sdk/client-s3`, `adm-zip`,
  `docx`, `mammoth`, `node-saml`, `pdf-parse`, `pdfkit`, `pptxgenjs`, `bcryptjs`.

`package-lock.json` was deleted because the dependency list changed — run `npm install`
to generate a fresh lockfile that matches.

## Routes served

`/api/validate`, `/api/verify-license`, `/api/register-free`, `/api/extract-style`,
`/api/usage`, `/api/stripe-webhook`, `/api/buy-credits`, `/api/credits`,
`/api/deduct-credit`, `/api/refund-credits`, `/api/generate`,
`/api/create-checkout-session`, `/api/admin` (+ admin-dashboard), `/api/portal`
(auth, magic, stripe, support), `/api/beta-feedback`, `/verify-email`, plus `/health`.

## Local setup

```bash
npm install            # regenerates package-lock.json
cp .env.example .env   # fill in values
npm run dev            # nodemon
```

## Deploy (Railway)

1. New Railway **project** → add a **PostgreSQL** database.
2. Deploy this repo as a service; set `DATABASE_URL` as a reference to the Postgres
   service (`${{Postgres.DATABASE_URL}}`).
3. Set the variables from `.env.example` (PORT is injected by Railway — don't set it).
4. Healthcheck path: `/health`.
5. Create the database schema (the eight ACB tables: `users`, `license_keys`,
   `credit_batches`, `usage_logs`, `free_registrations`, `email_verification_tokens`,
   `portal_magic_tokens`, `beta_feedback`).
6. Create a Stripe webhook endpoint at `/api/stripe-webhook` and put its signing secret
   in `STRIPE_WEBHOOK_SECRET`.
7. Repoint the WordPress plugin and the portals at this service's domain.

See the separate setup guide for the full step-by-step.

## Notes / outstanding

* **Connection pools:** the route files each open their own `pg` Pool. Consider
  refactoring them to import the shared `./db.js` pool (one pool per service) to avoid
  Postgres connection exhaustion.
* **`freeRegLimiter`** in `server.js` is set to `max: 20` for testing — set back to `3`
  before public launch.
* **`GENERATE_SECRET`** is still a shared constant with the plugin. The security audit
  recommends moving to a per-install secret.
* `content-types.js` is the authoritative credit map for billing.
