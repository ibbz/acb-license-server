-- ============================================================================
-- AI Content Bridge — ACB-only PostgreSQL schema
-- Run against the NEW, EMPTY ACB database (e.g. paste into a DBeaver SQL editor).
--
-- Tables are created in foreign-key dependency order; the whole thing runs in a
-- single transaction so it's all-or-nothing.
--
-- Column sets for users / license_keys / credit_batches / usage_logs /
-- free_registrations come from the live schema dump, slimmed to the columns the
-- ACB code actually uses (LearnBridge-only columns removed). The three token /
-- feedback tables were reconstructed from the route code (no dump was available),
-- so double-check their column lengths against your live DB if you ever migrate
-- real rows across. Indexes mirror the obvious access patterns — adjust to taste.
-- ============================================================================

BEGIN;

-- ── 1. users ────────────────────────────────────────────────────────────────
-- Slimmed: dropped team_id, role, credit_limit, password_hash, stripe_session_id,
-- job_title, department, avatar_url, sso_provider, sso_subject_id, last_active_at,
-- and all lb_* columns (LearnBridge-only).
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    email               VARCHAR(255) NOT NULL,
    name                VARCHAR(255),
    stripe_customer_id  VARCHAR(255),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_key UNIQUE (email)   -- ACB registers one account per email
);

-- ── 2. license_keys ──────────────────────────────────────────────────────────
-- Slimmed: dropped seats_limit, institution_name/url/type, brand_settings,
-- custom_labels, billing_interval, trial_end, current_period_end,
-- cancel_at_period_end (LearnBridge-only / unused by ACB).
CREATE TABLE license_keys (
    id                          BIGSERIAL PRIMARY KEY,
    user_id                     BIGINT NOT NULL,
    license_key                 VARCHAR(64) NOT NULL,
    tier                        VARCHAR(20) NOT NULL DEFAULT 'free',
    status                      VARCHAR(20) NOT NULL DEFAULT 'active',
    posts_limit                 INTEGER NOT NULL DEFAULT 5,
    posts_used_this_month       INTEGER NOT NULL DEFAULT 0,
    month_reset_date            DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
    stripe_subscription_id      VARCHAR(255),
    stripe_subscription_status  VARCHAR(50),
    stripe_customer_id          VARCHAR(255),
    stripe_price_id             TEXT,
    monthly_credit_limit        INTEGER NOT NULL DEFAULT 5,
    registered_domain           VARCHAR(255),
    domain_locked_at            TIMESTAMP,
    email_verified              BOOLEAN DEFAULT FALSE,
    email_verified_at           TIMESTAMP,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT license_keys_license_key_key UNIQUE (license_key),
    CONSTRAINT license_keys_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_license_keys_user_id ON license_keys (user_id);

-- ── 3. credit_batches ─────────────────────────────────────────────────────────
CREATE TABLE credit_batches (
    id                  BIGSERIAL PRIMARY KEY,
    license_key_id      BIGINT NOT NULL,
    credits_issued      INTEGER NOT NULL,
    credits_total       INTEGER NOT NULL DEFAULT 0,
    credits_remaining   INTEGER NOT NULL,
    source              VARCHAR(50) NOT NULL DEFAULT 'subscription',
    issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date         DATE NOT NULL,
    expires_at          TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_credit_batches_license_key
        FOREIGN KEY (license_key_id) REFERENCES license_keys (id) ON DELETE CASCADE
);
CREATE INDEX idx_credit_batches_license_key_id ON credit_batches (license_key_id);
-- ACB dedups one-off purchases by writing 'stripe_session:<id>' into notes, then
-- SELECTing on it — this index keeps that lookup fast.
CREATE INDEX idx_credit_batches_notes ON credit_batches (notes);

-- ── 4. usage_logs ─────────────────────────────────────────────────────────────
-- user_id widened to BIGINT (live dump had INTEGER) so the FK to users.id is clean.
CREATE TABLE usage_logs (
    id                       BIGSERIAL PRIMARY KEY,
    license_key_id           BIGINT NOT NULL,
    user_id                  BIGINT,
    domain                   VARCHAR(255) NOT NULL,
    post_title               VARCHAR(500),
    content_type             VARCHAR(50) DEFAULT 'blog_post',
    word_count               INTEGER,
    has_youtube              BOOLEAN DEFAULT FALSE,
    generation_time_seconds  INTEGER,
    api_cost                 NUMERIC,
    credits_used             INTEGER DEFAULT 0,
    style_profile_used       VARCHAR(100),
    created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT usage_logs_license_key_id_fkey
        FOREIGN KEY (license_key_id) REFERENCES license_keys (id) ON DELETE CASCADE,
    CONSTRAINT usage_logs_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_usage_logs_license_key_id ON usage_logs (license_key_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs (created_at);

-- ── 5. free_registrations ─────────────────────────────────────────────────────
-- password_hash retained (exists in the live schema) but ACB uses magic-link login,
-- so it stays nullable and unused.
CREATE TABLE free_registrations (
    id                  BIGSERIAL PRIMARY KEY,
    email               VARCHAR(255) NOT NULL,
    license_key_id      BIGINT NOT NULL,
    registered_domain   VARCHAR(255),
    registered_ip       VARCHAR(45),
    password_hash       TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT free_registrations_license_key_id_fkey
        FOREIGN KEY (license_key_id) REFERENCES license_keys (id) ON DELETE CASCADE
);
CREATE INDEX idx_free_registrations_license_key_id ON free_registrations (license_key_id);
CREATE INDEX idx_free_registrations_email ON free_registrations (email);

-- ── 6. email_verification_tokens ──────────────────────────────────────────────
-- Reconstructed from register-free.js / verify-email.js.
CREATE TABLE email_verification_tokens (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    license_key_id  BIGINT NOT NULL,
    token           TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_verification_tokens_token_key UNIQUE (token),
    CONSTRAINT email_verification_tokens_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT email_verification_tokens_license_key_id_fkey
        FOREIGN KEY (license_key_id) REFERENCES license_keys (id) ON DELETE CASCADE
);
CREATE INDEX idx_evt_user_id ON email_verification_tokens (user_id);

-- ── 7. portal_magic_tokens ────────────────────────────────────────────────────
-- Reconstructed from portal-magic.js. NOTE: per the live FK map, user_id references
-- free_registrations(id) — NOT users — because the customer portal identity is the
-- free_registrations row.
CREATE TABLE portal_magic_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    token       TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT portal_magic_tokens_token_key UNIQUE (token),
    CONSTRAINT portal_magic_tokens_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES free_registrations (id) ON DELETE CASCADE
);
CREATE INDEX idx_pmt_user_id ON portal_magic_tokens (user_id);

-- ── 8. beta_feedback ──────────────────────────────────────────────────────────
-- Reconstructed from beta-feedback.js / admin-dashboard.js. No foreign keys.
CREATE TABLE beta_feedback (
    id                BIGSERIAL PRIMARY KEY,
    tester_name       TEXT,
    access_code       VARCHAR(100),
    plan_tier         VARCHAR(50),
    submitted_at      TIMESTAMPTZ,
    tasks_json        JSONB,
    overall_rating    INTEGER,
    overall_comments  TEXT,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_beta_feedback_access_code ON beta_feedback (access_code);

COMMIT;
