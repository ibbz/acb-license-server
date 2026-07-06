-- add-cost-columns.sql
--
-- Cost instrumentation (see ACB-cost-instrumentation-scope-2026-07-06.md).
-- Adds per-attempt provider-cost columns to usage_logs so every Claude /
-- image / Serper call writes its TRUE cost at generation time, replacing the
-- admin dashboard's hardcoded estimate.
--
-- All columns are NULLABLE: existing rows are untouched and read as
-- "unpriced legacy" (cost history starts at deploy day — no backfill, you
-- can't reconstruct tokens that were never captured).
--
-- Note on the pre-existing api_cost column: it is CLIENT-writable via the
-- legacy /api/usage endpoint, so it cannot be trusted as an authoritative
-- total. total_cost_usd below is server-computed only and is the one true
-- figure; api_cost is left as-is (legacy, ignored).
--
-- license_key_id becomes NULLABLE: outline / support-chat cost rows may be
-- unattributable (e.g. an older plugin that doesn't yet send the licence key
-- on the outline proxy). Complete COGS matters more than attribution — an
-- unattributed cost row still counts toward SUM(total_cost_usd); a dropped
-- one silently understates spend. The FK still validates non-null values.
--
-- Idempotent: safe to run on any environment, including one where the
-- columns already exist. This also doubles as the verification step.

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS model               VARCHAR(60),
  ADD COLUMN IF NOT EXISTS input_tokens        INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens       INTEGER,
  ADD COLUMN IF NOT EXISTS cache_read_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS cache_write_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS stop_reason         VARCHAR(30),
  ADD COLUMN IF NOT EXISTS image_model         VARCHAR(60),
  ADD COLUMN IF NOT EXISTS image_size          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS image_quality       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS serp_search_count   INTEGER,
  ADD COLUMN IF NOT EXISTS text_cost_usd       NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS image_cost_usd      NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS serp_cost_usd       NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS total_cost_usd      NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS price_version       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cost_event          VARCHAR(30),
  ADD COLUMN IF NOT EXISTS succeeded           BOOLEAN;

ALTER TABLE usage_logs
  ALTER COLUMN license_key_id DROP NOT NULL;

-- Month-window cost sums (the admin's cost_this_month) and event splits.
CREATE INDEX IF NOT EXISTS idx_usage_logs_cost_month
  ON usage_logs (created_at)
  WHERE total_cost_usd IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_logs_cost_event
  ON usage_logs (cost_event)
  WHERE cost_event IS NOT NULL;

-- Interpretation guide for the new rows:
--   cost_event: 'generate' | 'outline' | 'strategist_plan' | 'extract_style' | 'support_chat'
--   cost_event IS NULL           -> legacy row from before instrumentation
--   succeeded = false            -> the attempt failed AFTER provider spend;
--                                   credits were refunded to the customer but
--                                   the provider cost was still incurred (waste)
--   total_cost_usd IS NULL, cost_event set
--                                -> a pricing-table miss (unknown model/image
--                                   key). lib/pricing.js logs these loudly;
--                                   fix the table, they should not persist.
