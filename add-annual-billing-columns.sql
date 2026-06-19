-- add-annual-billing-columns.sql
--
-- Adds the three license_keys columns ACB's subscription system depends on:
--   billing_interval      'month' | 'year' (set by the Stripe webhook)
--   annual_term_end       end of a paid annual term (drip stops past this)
--   next_credit_grant_at  when the next monthly allowance is due (drip clock)
--
-- These were dropped from schema.sql as "LearnBridge-only", but ACB's
-- stripe-webhook.js, the cron sweep (/api/cron/grant-due) and the lazy top-up
-- on /api/credits all reference them. Without them, subscription checkout fails
-- when the webhook tries to set them in the same UPDATE as the tier.
--
-- Idempotent: safe to run on any environment, including one where the columns
-- already exist. This also doubles as the verification step — run it and the
-- DB is guaranteed correct either way.

ALTER TABLE license_keys
  ADD COLUMN IF NOT EXISTS billing_interval      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS annual_term_end       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS next_credit_grant_at  TIMESTAMP;

-- Speeds up the daily cron sweep, which looks for active annual subscriptions
-- whose next grant is due.
CREATE INDEX IF NOT EXISTS idx_license_keys_annual_due
  ON license_keys (next_credit_grant_at)
  WHERE billing_interval = 'year' AND status = 'active';

-- Note: any annual subscription that was somehow created before these columns
-- existed will have a NULL next_credit_grant_at and so be skipped by the drip.
-- There should be none (the webhook would have errored), but if you find any:
--   UPDATE license_keys
--   SET billing_interval = 'year',
--       annual_term_end      = COALESCE(annual_term_end,      created_at + INTERVAL '1 year'),
--       next_credit_grant_at = COALESCE(next_credit_grant_at, NOW() + INTERVAL '1 month')
--   WHERE tier IN ('starter','pro','agency') AND billing_interval = 'year';
