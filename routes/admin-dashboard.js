/**
 * GET /api/admin/dashboard
 * GET /api/admin/users
 * GET /api/admin/analytics
 *
 * Protected admin endpoints for the marketing site dashboard.
 * Secured by x-admin-secret header.
 */

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');
const Stripe   = require('stripe');

const pool   = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ── Test-account exclusion (is_test on license_keys) ──────────────────────────
// Every stats endpoint below filters these out so real-traffic numbers aren't
// polluted by founder / QA accounts. The All Users page deliberately still shows
// them (with a TEST badge) — that's account management, not a metric.
const REAL_LICENCE_IDS = `SELECT id FROM license_keys WHERE NOT is_test`;
const EXCL_TEST      = `license_key_id IN (${REAL_LICENCE_IDS})`;                              // usage / count queries
const EXCL_TEST_COGS = `(license_key_id IS NULL OR license_key_id IN (${REAL_LICENCE_IDS}))`; // cost queries: keep unattributed COGS

const { logAdminAction, actorFrom } = require('../lib/admin-audit');
const creditsCache = require('../lib/credits-cache');
const { sendVerificationEmail } = require('./register-free');

// ── Auth middleware ───────────────────────────────────────────────────────────
const auth = (req, res, next) => {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorised.' });
    }
    next();
};

// ── CORS for dashboard hosted on marketing site ───────────────────────────────
router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── GET /api/admin/dashboard ──────────────────────────────────────────────────
// Headline metrics — the numbers you check every morning
router.get('/dashboard', auth, async (req, res) => {
    try {
        // User counts by tier
        const userCounts = await pool.query(`
            SELECT
                lk.tier,
                lk.status,
                COUNT(*) as count
            FROM license_keys lk
            WHERE NOT lk.is_test
            GROUP BY lk.tier, lk.status
        `);

        // New signups this week / month
        const signupTrend = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE lk.created_at >= NOW() - INTERVAL '24 hours')  AS today,
                COUNT(*) FILTER (WHERE lk.created_at >= NOW() - INTERVAL '7 days')    AS this_week,
                COUNT(*) FILTER (WHERE lk.created_at >= NOW() - INTERVAL '30 days')   AS this_month,
                COUNT(*) FILTER (WHERE lk.created_at >= NOW() - INTERVAL '30 days'
                    AND lk.tier != 'free') AS paid_this_month
            FROM license_keys lk
            WHERE NOT lk.is_test
        `);

        // Credits stats
        const creditStats = await pool.query(`
            SELECT
                COALESCE(SUM(credits_issued), 0)    AS total_issued,
                COALESCE(SUM(credits_remaining), 0) AS total_remaining,
                COALESCE(SUM(credits_issued - credits_remaining), 0) AS total_consumed
            FROM credit_batches
            WHERE expiry_date > CURRENT_DATE
              AND ${EXCL_TEST}
        `);

        // Usage this month
        // cost_event filter: outline / extract_style / support_chat rows are
        // cost-instrumentation rows (credits_used=0) — they must not inflate
        // generation counts. NULL cost_event = legacy generate rows.
        // 'strategist_plan' is a charged run and was always counted — kept.
        const usageStats = await pool.query(`
            SELECT
                COUNT(*)                                   AS generations_total,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS generations_this_month,
                COALESCE(SUM(credits_used), 0)             AS credits_used_total,
                COALESCE(SUM(credits_used) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS credits_used_this_month,
                COALESCE(AVG(credits_used), 0)             AS avg_credits_per_gen,
                COUNT(DISTINCT domain)                     AS unique_domains
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND (cost_event IS NULL OR cost_event IN ('generate', 'strategist_plan'))
              AND ${EXCL_TEST}
        `);

        // Daily signups last 30 days for sparkline
        const dailySignups = await pool.query(`
            SELECT
                DATE(created_at) AS day,
                COUNT(*)         AS count,
                COUNT(*) FILTER (WHERE tier != 'free') AS paid_count
            FROM license_keys
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND NOT is_test
            GROUP BY DATE(created_at)
            ORDER BY day
        `);

        // Daily generations last 30 days (cost-instrumentation rows excluded — see usageStats)
        const dailyGenerations = await pool.query(`
            SELECT
                DATE(created_at) AS day,
                COUNT(*)         AS count,
                COALESCE(SUM(credits_used), 0) AS credits
            FROM usage_logs
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND post_title != 'VALIDATION_CHECK'
              AND (cost_event IS NULL OR cost_event IN ('generate', 'strategist_plan'))
              AND ${EXCL_TEST}
            GROUP BY DATE(created_at)
            ORDER BY day
        `);

        // Free → paid conversion
        const conversionRate = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE tier = 'free')  AS free_users,
                COUNT(*) FILTER (WHERE tier != 'free') AS paid_users
            FROM license_keys
            WHERE status = 'active'
              AND NOT is_test
        `);

        // Email verification rate for free tier
        const verificationRate = await pool.query(`
            SELECT
                COUNT(*) AS total_free,
                COUNT(*) FILTER (WHERE email_verified = true) AS verified
            FROM license_keys
            WHERE tier = 'free'
              AND NOT is_test
        `);

        // ── Real provider cost (cost instrumentation, 2026-07) ────────────
        // Authoritative: SUM(total_cost_usd) written by lib/pricing.js at
        // generation time. Rows from before the instrumentation deploy have
        // NULL cost — priced_coverage shows how much of the window is real.
        // The old hardcoded estimate ($0.003/credit + $0.02/gen — the image
        // figure alone was 2.5x under reality) is kept ONLY as a labelled
        // fallback for the transition window and reported separately.
        const realCost = await pool.query(`
            SELECT
                COALESCE(SUM(total_cost_usd), 0)                                                        AS cost_total,
                COALESCE(SUM(total_cost_usd) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS cost_this_month,
                COALESCE(SUM(total_cost_usd) FILTER (WHERE created_at >= date_trunc('month', NOW())
                                                       AND succeeded = false), 0)                        AS waste_this_month,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))                         AS rows_this_month,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())
                                   AND total_cost_usd IS NOT NULL)                                       AS priced_rows_this_month
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND ${EXCL_TEST_COGS}
        `);
        const rc = realCost.rows[0];
        const costTotal          = parseFloat(rc.cost_total) || 0;
        const costThisMonth      = parseFloat(rc.cost_this_month) || 0;
        const wasteThisMonth     = parseFloat(rc.waste_this_month) || 0;
        const rowsThisMonth      = parseInt(rc.rows_this_month) || 0;
        const pricedRowsThisMonth = parseInt(rc.priced_rows_this_month) || 0;
        const pricedCoveragePct  = rowsThisMonth > 0 ? Math.round((pricedRowsThisMonth / rowsThisMonth) * 100) : null;

        // Legacy estimate — transition fallback only (labelled as such in the response)
        const totalConsumed = parseFloat(creditStats.rows[0].total_consumed) || 0;
        const totalGenerations = parseInt(usageStats.rows[0].generations_total) || 0;
        const estimatedCost = (totalConsumed * 0.003) + (totalGenerations * 0.02);
        const thisMonthConsumed = parseFloat(usageStats.rows[0].credits_used_this_month) || 0;
        const thisMonthGens = parseInt(usageStats.rows[0].generations_this_month) || 0;
        const estimatedCostThisMonth = (thisMonthConsumed * 0.003) + (thisMonthGens * 0.02);

        // MRR estimate from DB (Stripe gives exact figure)
        const TIER_PRICES = { starter: 19, pro: 49, agency: 149 };
        const mrrEstimate = userCounts.rows
            .filter(r => r.status === 'active' && TIER_PRICES[r.tier])
            .reduce((sum, r) => sum + (TIER_PRICES[r.tier] * parseInt(r.count)), 0);

        // Get MRR from Stripe if available
        let stripeMrr = null;
        if (stripe) {
            try {
                // Exclude test-account subscriptions (their stripe_subscription_id).
                const testSubs = await pool.query(
                    `SELECT stripe_subscription_id FROM license_keys
                     WHERE is_test AND stripe_subscription_id IS NOT NULL`);
                const testSubIds = new Set(testSubs.rows.map(r => r.stripe_subscription_id));
                const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
                stripeMrr = subs.data.reduce((sum, sub) => {
                    if (testSubIds.has(sub.id)) return sum;   // skip founder / QA test subscriptions
                    const monthly = sub.items.data.reduce((s, item) => {
                        const price = item.price;
                        const amount = price.unit_amount / 100;
                        return s + (price.recurring?.interval === 'year' ? amount / 12 : amount);
                    }, 0);
                    return sum + monthly;
                }, 0);
            } catch(e) {
                console.error('[admin/dashboard] Stripe MRR error:', e.message);
            }
        }

        return res.json({
            success: true,
            users: {
                by_tier: userCounts.rows,
                signups:  signupTrend.rows[0],
                conversion: conversionRate.rows[0],
                verification: verificationRate.rows[0],
            },
            credits: creditStats.rows[0],
            usage: usageStats.rows[0],
            revenue: {
                mrr_estimate:    mrrEstimate,
                mrr_stripe:      stripeMrr,
                arr_estimate:    mrrEstimate * 12,
                // Real, server-computed provider cost (lib/pricing.js) — the
                // authoritative figures. cost_estimated_* are the old
                // hardcoded-rate estimates, kept only for the transition
                // window while pre-instrumentation rows age out.
                cost_total:      Math.round(costTotal * 100) / 100,
                cost_this_month: Math.round(costThisMonth * 100) / 100,
                waste_this_month: Math.round(wasteThisMonth * 100) / 100,
                priced_coverage_pct: pricedCoveragePct,
                cost_estimated_total:      Math.round(estimatedCost * 100) / 100,
                cost_estimated_this_month: Math.round(estimatedCostThisMonth * 100) / 100,
                // Margin: prefer Stripe's real MRR; COGS is the real cost sum.
                // Honest label: Stripe fees are NOT yet netted off revenue
                // (Phase 2 of the cost-instrumentation scope) — this is
                // gross-revenue margin, slightly flattering by ~4-5%.
                margin_pct: (() => {
                    const rev = (stripeMrr ?? mrrEstimate);
                    return rev > 0 ? Math.round(((rev - costThisMonth) / rev) * 100) : null;
                })(),
                margin_basis: 'gross revenue minus real provider cost; Stripe fees not yet netted (Phase 2)',
            },
            charts: {
                daily_signups:     dailySignups.rows,
                daily_generations: dailyGenerations.rows,
            },
        });

    } catch (err) {
        console.error('[admin/dashboard]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
// Full user list with activity data
router.get('/users', auth, async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || 50), 200);
    const offset = parseInt(req.query.offset || 0);
    const tier   = req.query.tier || null;
    const search = req.query.search || null;
    const sort   = req.query.sort || 'created_at';
    const order  = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const allowed_sorts = ['created_at', 'last_active', 'credits_used', 'tier'];
    const safe_sort = allowed_sorts.includes(sort) ? sort : 'created_at';

    try {
        const conditions = ["lk.status != 'cancelled'"];
        const params = [];
        let pi = 1;

        if (tier) { conditions.push(`lk.tier = $${pi++}`); params.push(tier); }
        if (search) { conditions.push(`(u.email ILIKE $${pi++} OR u.name ILIKE $${pi++} OR lk.registered_domain ILIKE $${pi++})`); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        // Each of credit_batches / usage_logs / free_registrations is one-to-many
        // against a licence. Aggregating more than one of them in a single query
        // fans out into an m×n Cartesian product — inflating the credit sums by the
        // generation count and the generation count by the number of credit batches
        // (AICOBR_USERS_FANOUT_FIX_2026_07_18). Fix: pre-aggregate each relation in
        // its own subquery, then join the collapsed 1-row-per-licence results.
        const users = await pool.query(`
            SELECT
                u.id,
                u.email,
                u.name,
                u.created_at               AS signup_date,
                lk.tier,
                lk.status,
                lk.license_key,
                lk.email_verified,
                lk.is_test,
                lk.registered_domain,
                lk.created_at              AS license_created,
                COALESCE(cbs.credits_issued, 0)                         AS credits_issued,
                COALESCE(cbs.credits_remaining, 0)                      AS credits_remaining,
                COALESCE(cbs.credits_issued - cbs.credits_remaining, 0) AS credits_used,
                COALESCE(uls.total_generations, 0)                      AS total_generations,
                uls.last_active,
                fr.registered_ip
            FROM users u
            JOIN license_keys lk ON lk.user_id = u.id
            LEFT JOIN (
                SELECT license_key_id,
                       SUM(credits_issued)    AS credits_issued,
                       SUM(credits_remaining) AS credits_remaining
                FROM credit_batches
                GROUP BY license_key_id
            ) cbs ON cbs.license_key_id = lk.id
            LEFT JOIN (
                SELECT license_key_id,
                       COUNT(*)        AS total_generations,
                       MAX(created_at) AS last_active
                FROM usage_logs
                WHERE post_title != 'VALIDATION_CHECK'
                  AND domain != 'credit_purchase'   -- bundle-purchase audit rows aren't generations
                GROUP BY license_key_id
            ) uls ON uls.license_key_id = lk.id
            LEFT JOIN (
                SELECT license_key_id, MAX(registered_ip) AS registered_ip
                FROM free_registrations
                GROUP BY license_key_id
            ) fr ON fr.license_key_id = lk.id
            ${where}
            ORDER BY ${safe_sort === 'created_at' ? 'lk.created_at' :
                       safe_sort === 'last_active' ? 'last_active' :
                       safe_sort === 'credits_used' ? 'credits_used' : 'lk.tier'} ${order} NULLS LAST
            LIMIT $${pi++} OFFSET $${pi++}
        `, [...params, limit, offset]);

        const total = await pool.query(`
            SELECT COUNT(DISTINCT u.id) AS count
            FROM users u
            JOIN license_keys lk ON lk.user_id = u.id
            ${where}
        `, params);

        return res.json({
            success: true,
            users:   users.rows,
            total:   parseInt(total.rows[0].count),
            limit,
            offset,
        });

    } catch (err) {
        console.error('[admin/users]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/admin/analytics ──────────────────────────────────────────────────
// Deep analytics — content types, features, top users
router.get('/analytics', auth, async (req, res) => {
    try {
        // Content type popularity
        const contentTypes = await pool.query(`
            SELECT
                COALESCE(content_type, 'blog_post') AS content_type,
                COUNT(*)                            AS total,
                COUNT(DISTINCT domain)              AS unique_domains,
                COALESCE(SUM(credits_used), 0)      AS credits_consumed,
                ROUND(AVG(credits_used)::numeric, 1) AS avg_credits
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND created_at >= NOW() - INTERVAL '90 days'
              AND ${EXCL_TEST}
            GROUP BY COALESCE(content_type, 'blog_post')
            ORDER BY total DESC
        `);

        // Style profile usage
        const styleProfiles = await pool.query(`
            SELECT
                style_profile_used,
                COUNT(*) AS uses
            FROM usage_logs
            WHERE style_profile_used IS NOT NULL
              AND post_title != 'VALIDATION_CHECK'
              AND ${EXCL_TEST}
            GROUP BY style_profile_used
            ORDER BY uses DESC
            LIMIT 20
        `);

        // Top users by activity
        const topUsers = await pool.query(`
            SELECT
                u.email,
                u.name,
                lk.tier,
                lk.registered_domain,
                COUNT(ul.id)                    AS total_generations,
                COALESCE(SUM(ul.credits_used),0) AS credits_used,
                MAX(ul.created_at)               AS last_active,
                COUNT(DISTINCT ul.content_type)  AS content_types_used
            FROM users u
            JOIN license_keys lk ON lk.user_id = u.id
            JOIN usage_logs ul ON ul.license_key_id = lk.id
            WHERE ul.post_title != 'VALIDATION_CHECK'
              AND NOT lk.is_test
            GROUP BY u.id, u.email, u.name, lk.tier, lk.registered_domain
            ORDER BY total_generations DESC
            LIMIT 20
        `);

        // Top domains
        const topDomains = await pool.query(`
            SELECT
                domain,
                COUNT(*)                    AS total_generations,
                COALESCE(SUM(credits_used),0) AS credits_used,
                COUNT(DISTINCT content_type) AS content_types_used,
                MAX(created_at)              AS last_active
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND ${EXCL_TEST}
            GROUP BY domain
            ORDER BY total_generations DESC
            LIMIT 20
        `);

        // Feature usage rates
        const featureUsage = await pool.query(`
            SELECT
                COUNT(*) AS total_gens,
                COUNT(*) FILTER (WHERE has_youtube = true)        AS with_youtube,
                COUNT(*) FILTER (WHERE style_profile_used IS NOT NULL) AS with_style_profile,
                ROUND(100.0 * COUNT(*) FILTER (WHERE has_youtube = true) / NULLIF(COUNT(*),0), 1) AS youtube_pct,
                ROUND(100.0 * COUNT(*) FILTER (WHERE style_profile_used IS NOT NULL) / NULLIF(COUNT(*),0), 1) AS style_profile_pct
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND created_at >= NOW() - INTERVAL '30 days'
              AND ${EXCL_TEST}
        `);

        // Generation volume by hour of day (reveals peak usage times)
        const peakHours = await pool.query(`
            SELECT
                EXTRACT(HOUR FROM created_at) AS hour,
                COUNT(*)                      AS count
            FROM usage_logs
            WHERE post_title != 'VALIDATION_CHECK'
              AND created_at >= NOW() - INTERVAL '30 days'
              AND ${EXCL_TEST}
            GROUP BY EXTRACT(HOUR FROM created_at)
            ORDER BY hour
        `);

        // Week-on-week growth
        const weeklyGrowth = await pool.query(`
            SELECT
                DATE_TRUNC('week', created_at) AS week,
                COUNT(*)                       AS new_users,
                COUNT(*) FILTER (WHERE tier != 'free') AS paid_users
            FROM license_keys
            WHERE created_at >= NOW() - INTERVAL '12 weeks'
              AND NOT is_test
            GROUP BY DATE_TRUNC('week', created_at)
            ORDER BY week
        `);

        // Content type usage by tier
        const typesByTier = await pool.query(`
            SELECT
                lk.tier,
                COALESCE(ul.content_type, 'blog_post') AS content_type,
                COUNT(*) AS count
            FROM usage_logs ul
            JOIN license_keys lk ON ul.license_key_id = lk.id
            WHERE ul.post_title != 'VALIDATION_CHECK'
              AND ul.created_at >= NOW() - INTERVAL '30 days'
              AND NOT lk.is_test
            GROUP BY lk.tier, COALESCE(ul.content_type, 'blog_post')
            ORDER BY lk.tier, count DESC
        `);

        return res.json({
            success: true,
            content_types:  contentTypes.rows,
            style_profiles: styleProfiles.rows,
            top_users:      topUsers.rows,
            top_domains:    topDomains.rows,
            feature_usage:  featureUsage.rows[0],
            peak_hours:     peakHours.rows,
            weekly_growth:  weeklyGrowth.rows,
            types_by_tier:  typesByTier.rows,
        });

    } catch (err) {
        console.error('[admin/analytics]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/add-credits ───────────────────────────────────────────────
// Manually add credits to a user (for support, compensation etc.)
router.post('/add-credits', auth, async (req, res) => {
    const { license_key, credits, reason } = req.body;
    if (!license_key || !credits) return res.status(400).json({ success: false, error: 'license_key and credits required.' });
    try {
        const lk = await pool.query(`SELECT id FROM license_keys WHERE license_key = $1`, [license_key]);
        if (!lk.rows.length) return res.status(404).json({ success: false, error: 'License not found.' });
        await pool.query(`
            INSERT INTO credit_batches (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
            VALUES ($1, $2, $2, NOW(), NOW() + INTERVAL '1 year', $3)
        `, [lk.rows[0].id, parseInt(credits), `admin_grant: ${reason || 'manual'}`]);
        console.log(`[admin] Added ${credits} credits to ${license_key}. Reason: ${reason}`);
        await logAdminAction({ action: 'add_credits', license_key, actor: actorFrom(req), reason,
            details: { credits: parseInt(credits) } });
        return res.json({ success: true, message: `${credits} credits added to ${license_key}.` });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/create-beta-license ──────────────────────────────────────
// Creates a beta tester license with configurable tier and credits.
// Also creates the user record if the email doesn't exist yet.
router.post('/create-beta-license', auth, async (req, res) => {
    const { email, name, tier, credits, beta_code, notes } = req.body;

    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

    const normalizedEmail = email.trim().toLowerCase();
    const planTier        = ['free','starter','pro','agency'].includes(tier) ? tier : 'pro';
    const creditCount     = parseInt(credits) || { free: 5, starter: 30, pro: 100, agency: 300 }[planTier];
    const crypto          = require('crypto');

    // Generate license key — format: ACB-BETA-XXXX-XXXX-XXXX
    const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const licenseKey = `ACB-BETA-${seg()}-${seg()}-${seg()}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create or find user
        const userResult = await client.query(`
            INSERT INTO users (email, name, created_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
        `, [normalizedEmail, name?.trim() || normalizedEmail.split('@')[0]]);
        const userId = userResult.rows[0].id;

        // Check if user already has a beta license
        const existing = await client.query(`
            SELECT license_key FROM license_keys
            WHERE user_id = $1 AND license_key LIKE 'ACB-BETA-%'
            LIMIT 1
        `, [userId]);

        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `This email already has a beta license: ${existing.rows[0].license_key}`,
                existing_key: existing.rows[0].license_key,
            });
        }

        // Create license key — pre-verified, no domain lock for beta testers
        await client.query(`
            INSERT INTO license_keys
                (user_id, license_key, tier, status, posts_limit, monthly_credit_limit,
                 month_reset_date, email_verified, email_verified_at)
            VALUES ($1, $2, $3, 'active', $4, $4, NOW() + INTERVAL '3 months', TRUE, NOW())
        `, [userId, licenseKey, planTier, creditCount]);

        const lkResult = await client.query(`SELECT id FROM license_keys WHERE license_key = $1`, [licenseKey]);
        const licenseKeyId = lkResult.rows[0].id;

        // Grant credits — 3 month expiry for beta
        await client.query(`
            INSERT INTO credit_batches
                (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
            VALUES ($1, $2, $2, NOW(), NOW() + INTERVAL '3 months', $3)
        `, [licenseKeyId, creditCount, `beta_license: ${notes || beta_code || 'admin created'}`]);

        await client.query('COMMIT');

        console.log(`[admin] Beta license created: ${licenseKey} | ${normalizedEmail} | ${planTier} | ${creditCount} credits`);
        await logAdminAction({ action: 'create_beta', license_key: licenseKey, actor: actorFrom(req), reason: req.body.notes || null,
            details: { email: normalizedEmail, tier: planTier, credits: creditCount } });

        return res.json({
            success:     true,
            license_key: licenseKey,
            email:       normalizedEmail,
            tier:        planTier,
            credits:     creditCount,
            expires:     '3 months from today',
            message:     `Beta license created successfully for ${normalizedEmail}`,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[admin/create-beta-license]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ── POST /api/admin/delete-user ───────────────────────────────────────────────
// Soft-deletes a user: cancels their licence key, zeroes credit batches,
// and marks free_registrations. Nothing is hard-deleted — recoverable from DB.
// Body: { license_key } OR { email }
router.post('/delete-user', auth, async (req, res) => {
    const { license_key, email } = req.body;
    if (!license_key && !email) {
        return res.status(400).json({ success: false, error: 'Provide license_key or email' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Resolve the licence key record
        let lkRes;
        if (license_key) {
            lkRes = await client.query(
                `SELECT lk.id, lk.license_key, lk.tier, fr.email
                 FROM license_keys lk
                 LEFT JOIN free_registrations fr ON fr.license_key_id = lk.id
                 WHERE lk.license_key = $1 LIMIT 1`,
                [license_key]
            );
        } else {
            lkRes = await client.query(
                `SELECT lk.id, lk.license_key, lk.tier, fr.email
                 FROM license_keys lk
                 JOIN free_registrations fr ON fr.license_key_id = lk.id
                 WHERE LOWER(fr.email) = LOWER($1) LIMIT 1`,
                [email]
            );
        }

        if (lkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const lk = lkRes.rows[0];

        // 1. Cancel the licence key
        await client.query(
            `UPDATE license_keys SET status = 'cancelled', stripe_customer_id = NULL WHERE id = $1`,
            [lk.id]
        );

        // 2. Zero all credit batches so they can't generate
        await client.query(
            `UPDATE credit_batches SET credits_remaining = 0 WHERE license_key_id = $1`,
            [lk.id]
        );

        // 3. Log the admin action in usage_logs for audit trail
        await client.query(
            `INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
             VALUES ($1, 'admin_action', 'ACCOUNT_DELETED', 0, 'admin', NOW())`,
            [lk.id]
        );

        await client.query('COMMIT');

        console.log(`[admin/delete-user] Cancelled: ${lk.license_key} | ${lk.email} | tier: ${lk.tier}`);
        await logAdminAction({ action: 'delete_user', license_key: lk.license_key, actor: actorFrom(req), reason: req.body.reason || null,
            details: { email: lk.email, tier: lk.tier } });

        return res.json({
            success:     true,
            message:     `User deleted successfully`,
            license_key: lk.license_key,
            email:       lk.email,
            note:        'Soft delete — data retained in DB. Credits zeroed. Licence cancelled. User can no longer generate.',
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[admin/delete-user]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});


// ── POST /api/admin/revoke-licence ────────────────────────────────────────────
// Revokes a licence key without deleting the account.
// Useful for abuse, non-payment, or issuing a replacement key.
// Body: { license_key, reason }
router.post('/revoke-licence', auth, async (req, res) => {
    const { license_key, reason } = req.body;
    if (!license_key) {
        return res.status(400).json({ success: false, error: 'license_key is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const lkRes = await client.query(
            `SELECT lk.id, lk.status, lk.tier, fr.email
             FROM license_keys lk
             LEFT JOIN free_registrations fr ON fr.license_key_id = lk.id
             WHERE lk.license_key = $1 LIMIT 1`,
            [license_key]
        );

        if (lkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Licence key not found' });
        }

        const lk = lkRes.rows[0];

        if (lk.status === 'revoked') {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Licence is already revoked' });
        }

        // Set status to revoked (distinct from cancelled — revoked = admin action, cancelled = subscription ended)
        await client.query(
            `UPDATE license_keys SET status = 'revoked' WHERE id = $1`,
            [lk.id]
        );

        // Zero credits
        await client.query(
            `UPDATE credit_batches SET credits_remaining = 0 WHERE license_key_id = $1`,
            [lk.id]
        );

        // Audit log
        await client.query(
            `INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
             VALUES ($1, 'admin_action', $2, 0, 'admin', NOW())`,
            [lk.id, `LICENCE_REVOKED: ${reason || 'no reason given'}`]
        );

        await client.query('COMMIT');

        console.log(`[admin/revoke-licence] Revoked: ${license_key} | ${lk.email} | reason: ${reason || 'none'}`);
        await logAdminAction({ action: 'revoke', license_key, actor: actorFrom(req), reason, details: { email: lk.email } });

        return res.json({
            success:     true,
            message:     `Licence revoked`,
            license_key,
            email:       lk.email,
            reason:      reason || null,
            note:        'Account record retained. To reinstate, update license_keys.status to "active" directly in the DB or use add-credits to re-enable.',
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[admin/revoke-licence]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});


// ── GET /api/admin/beta-feedback ──────────────────────────────────────────────
// Lists all beta tester submissions, newest first.
// Optional query params: ?limit=20&offset=0&code=BETA2026
router.get('/beta-feedback', auth, async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit  || 50), 200);
    const offset = parseInt(req.query.offset || 0);
    const code   = req.query.code || null;

    try {
        // Check the table exists first — beta_feedback may not be in all envs
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'beta_feedback'
            ) AS exists
        `);

        if (!tableCheck.rows[0].exists) {
            return res.json({
                success:     true,
                submissions: [],
                total:       0,
                note:        'beta_feedback table does not exist yet — no submissions received',
            });
        }

        const conditions = [];
        const params     = [];
        let pi = 1;

        if (code) {
            conditions.push(`access_code = $${pi++}`);
            params.push(code.toUpperCase());
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const rows = await pool.query(`
            SELECT
                id,
                tester_name,
                access_code,
                plan_tier,
                submitted_at,
                overall_rating,
                overall_comments,
                -- Count completed tasks from JSON
                (SELECT COUNT(*)
                 FROM jsonb_array_elements(CASE WHEN tasks_json IS NOT NULL THEN tasks_json::jsonb ELSE '[]'::jsonb END) t
                 WHERE (t->>'completed')::boolean = true
                ) AS tasks_completed,
                -- Count total tasks
                jsonb_array_length(CASE WHEN tasks_json IS NOT NULL THEN tasks_json::jsonb ELSE '[]'::jsonb END) AS tasks_total,
                -- Average rating across rated tasks
                (SELECT ROUND(AVG((t->>'rating')::numeric), 1)
                 FROM jsonb_array_elements(CASE WHEN tasks_json IS NOT NULL THEN tasks_json::jsonb ELSE '[]'::jsonb END) t
                 WHERE t->>'rating' IS NOT NULL AND t->>'rating' != 'null'
                ) AS avg_rating,
                tasks_json
            FROM beta_feedback
            ${where}
            ORDER BY submitted_at DESC
            LIMIT $${pi++} OFFSET $${pi++}
        `, [...params, limit, offset]);

        const total = await pool.query(
            `SELECT COUNT(*) AS count FROM beta_feedback ${where}`,
            params
        );

        // Parse tasks_json so the caller gets structured data
        const submissions = rows.rows.map(r => ({
            id:               r.id,
            tester_name:      r.tester_name,
            access_code:      r.access_code,
            plan_tier:        r.plan_tier,
            submitted_at:     r.submitted_at,
            overall_rating:   r.overall_rating,
            overall_comments: r.overall_comments,
            tasks_completed:  parseInt(r.tasks_completed) || 0,
            tasks_total:      parseInt(r.tasks_total) || 0,
            avg_rating:       r.avg_rating ? parseFloat(r.avg_rating) : null,
            tasks:            r.tasks_json ? (typeof r.tasks_json === 'string' ? JSON.parse(r.tasks_json) : r.tasks_json) : [],
        }));

        return res.json({
            success:     true,
            submissions,
            total:       parseInt(total.rows[0].count),
            limit,
            offset,
        });

    } catch (err) {
        console.error('[admin/beta-feedback]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});


// ── POST /api/admin/reinstate-user ────────────────────────────────────────────
// Reinstates a cancelled or revoked user — sets status back to active.
// Body: { license_key, credits } (credits optional — defaults to 0, use add-credits separately)
router.post('/reinstate-user', auth, async (req, res) => {
    const { license_key, credits } = req.body;
    if (!license_key) {
        return res.status(400).json({ success: false, error: 'license_key is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const lkRes = await client.query(
            `SELECT lk.id, lk.status, lk.tier, fr.email
             FROM license_keys lk
             LEFT JOIN free_registrations fr ON fr.license_key_id = lk.id
             WHERE lk.license_key = $1 LIMIT 1`,
            [license_key]
        );

        if (lkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Licence key not found' });
        }

        const lk = lkRes.rows[0];

        await client.query(
            `UPDATE license_keys SET status = 'active' WHERE id = $1`,
            [lk.id]
        );

        // Optionally restore credits
        if (credits && parseInt(credits) > 0) {
            const creditCount = parseInt(credits);
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 1);
            await client.query(
                `INSERT INTO credit_batches (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
                 VALUES ($1, $2, $2, NOW(), $3, 'admin_reinstate')`,
                [lk.id, creditCount, expiry.toISOString()]
            );
        }

        // Audit log
        await client.query(
            `INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
             VALUES ($1, 'admin_action', 'ACCOUNT_REINSTATED', 0, 'admin', NOW())`,
            [lk.id]
        );

        await client.query('COMMIT');

        console.log(`[admin/reinstate-user] Reinstated: ${license_key} | ${lk.email}`);
        await logAdminAction({ action: 'reinstate', license_key, actor: actorFrom(req), reason: req.body.reason || null, details: { email: lk.email } });

        return res.json({
            success:     true,
            message:     `User reinstated`,
            license_key,
            email:       lk.email,
            credits_added: credits ? parseInt(credits) : 0,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[admin/reinstate-user]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ── GET /api/admin/costs ──────────────────────────────────────────────────────
// Real provider-cost analytics (cost instrumentation, 2026-07). Everything here
// reads server-computed total_cost_usd — no estimates. ?days=N window (default
// 30, max 365). Sections:
//   summary     — spend, waste (succeeded=false: refunded to the customer but
//                 paid to the provider), truncations, priced-row coverage
//   by_event    — generate / outline / strategist_plan / extract_style / support_chat
//   by_type     — cost per content type (which types erode margin)
//   by_tier     — cost per plan tier, incl. free-tier burn (the launch question)
//   distribution— p50 / p95 / max of per-attempt cost (the worst-case tail)
router.get('/costs', auth, async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days || 30), 1), 365);
    try {
        const [summary, byEvent, byType, byTier, dist] = await Promise.all([
            pool.query(`
                SELECT
                    COALESCE(SUM(total_cost_usd), 0)                             AS total_cost,
                    COALESCE(SUM(text_cost_usd), 0)                              AS text_cost,
                    COALESCE(SUM(image_cost_usd), 0)                             AS image_cost,
                    COALESCE(SUM(serp_cost_usd), 0)                              AS serp_cost,
                    COALESCE(SUM(total_cost_usd) FILTER (WHERE succeeded = false), 0) AS waste_cost,
                    COUNT(*) FILTER (WHERE succeeded = false)                    AS failed_attempts,
                    COUNT(*) FILTER (WHERE stop_reason = 'max_tokens')           AS truncations,
                    COUNT(*) FILTER (WHERE total_cost_usd IS NOT NULL)           AS priced_rows,
                    COUNT(*) FILTER (WHERE cost_event IS NOT NULL AND total_cost_usd IS NULL) AS unpriced_rows,
                    COUNT(*)                                                     AS all_rows
                FROM usage_logs
                WHERE created_at >= NOW() - ($1 || ' days')::interval
                  AND post_title != 'VALIDATION_CHECK'
                  AND ${EXCL_TEST_COGS}
            `, [days]),
            pool.query(`
                SELECT cost_event,
                       COUNT(*)                          AS calls,
                       COALESCE(SUM(total_cost_usd), 0)  AS cost,
                       COALESCE(AVG(total_cost_usd), 0)  AS avg_cost
                FROM usage_logs
                WHERE created_at >= NOW() - ($1 || ' days')::interval
                  AND cost_event IS NOT NULL
                  AND ${EXCL_TEST_COGS}
                GROUP BY cost_event
                ORDER BY cost DESC
            `, [days]),
            pool.query(`
                SELECT content_type,
                       COUNT(*)                          AS generations,
                       COALESCE(SUM(total_cost_usd), 0)  AS cost,
                       COALESCE(AVG(total_cost_usd), 0)  AS avg_cost,
                       COALESCE(SUM(credits_used), 0)    AS credits
                FROM usage_logs
                WHERE created_at >= NOW() - ($1 || ' days')::interval
                  AND cost_event = 'generate'
                  AND total_cost_usd IS NOT NULL
                  AND ${EXCL_TEST_COGS}
                GROUP BY content_type
                ORDER BY cost DESC
            `, [days]),
            pool.query(`
                SELECT COALESCE(lk.tier, 'unattributed') AS tier,
                       COUNT(*)                          AS generations,
                       COALESCE(SUM(ul.total_cost_usd), 0) AS cost,
                       COALESCE(AVG(ul.total_cost_usd), 0) AS avg_cost
                FROM usage_logs ul
                LEFT JOIN license_keys lk ON lk.id = ul.license_key_id
                WHERE ul.created_at >= NOW() - ($1 || ' days')::interval
                  AND ul.total_cost_usd IS NOT NULL
                  AND lk.is_test IS NOT TRUE
                GROUP BY COALESCE(lk.tier, 'unattributed')
                ORDER BY cost DESC
            `, [days]),
            pool.query(`
                SELECT
                    PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY total_cost_usd) AS p50,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_cost_usd) AS p95,
                    MAX(total_cost_usd)                                          AS max
                FROM usage_logs
                WHERE created_at >= NOW() - ($1 || ' days')::interval
                  AND cost_event = 'generate'
                  AND total_cost_usd IS NOT NULL
                  AND ${EXCL_TEST_COGS}
            `, [days]),
        ]);

        return res.json({
            success: true,
            window_days: days,
            summary: summary.rows[0],
            by_event: byEvent.rows,
            by_type: byType.rows,
            by_tier: byTier.rows,        // free-tier burn = the 'free' row's cost
            distribution: dist.rows[0],  // per-generate-attempt cost: p50 / p95 / max
        });
    } catch (err) {
        console.error('[admin/costs]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/set-test ──────────────────────────────────────────────────
// Flag or unflag a licence as a test account. Flagged licences keep all their
// data but are excluded from the Launch Monitor's real-traffic metrics.
router.post('/set-test', auth, async (req, res) => {
    const { license_key, is_test } = req.body;
    if (!license_key || typeof is_test !== 'boolean') {
        return res.status(400).json({ success: false, error: 'license_key and a boolean is_test are required.' });
    }
    try {
        const r = await pool.query(
            `UPDATE license_keys SET is_test = $2 WHERE license_key = $1
             RETURNING license_key, is_test`,
            [license_key, is_test]
        );
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Licence not found.' });
        await logAdminAction({ action: 'set_test', license_key, actor: actorFrom(req),
            reason: is_test ? 'flagged as test' : 'marked as real', details: { is_test } });
        return res.json({ success: true, license_key: r.rows[0].license_key, is_test: r.rows[0].is_test });
    } catch (err) {
        console.error('[admin/set-test]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/admin/adjust-credits ────────────────────────────────────────────
// Grant (positive credits) or claw back (negative credits). Grants add a 1-year
// batch; deductions reduce non-expired batches soonest-expiry-first, capped at
// the live balance. Audit-logged. (Legacy /add-credits is kept for back-compat.)
router.post('/adjust-credits', auth, async (req, res) => {
    const { license_key, credits, reason } = req.body;
    const delta = parseInt(credits);
    if (!license_key || !delta || Number.isNaN(delta)) {
        return res.status(400).json({ success: false, error: 'license_key and a non-zero integer credits are required.' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const lk = await client.query(`SELECT id FROM license_keys WHERE license_key = $1`, [license_key]);
        if (!lk.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Licence not found.' }); }
        const licenseId = lk.rows[0].id;
        let applied = 0;

        if (delta > 0) {
            await client.query(
                `INSERT INTO credit_batches (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
                 VALUES ($1, $2, $2, NOW(), NOW() + INTERVAL '1 year', $3)`,
                [licenseId, delta, `admin_adjust:+${delta}: ${reason || 'manual'}`]);
            applied = delta;
        } else {
            let toRemove = -delta;
            const batches = await client.query(
                `SELECT id, credits_remaining FROM credit_batches
                 WHERE license_key_id = $1 AND expiry_date > CURRENT_DATE AND credits_remaining > 0
                 ORDER BY expiry_date ASC`, [licenseId]);
            for (const b of batches.rows) {
                if (toRemove <= 0) break;
                const take = Math.min(toRemove, b.credits_remaining);
                await client.query(`UPDATE credit_batches SET credits_remaining = credits_remaining - $1 WHERE id = $2`, [take, b.id]);
                toRemove -= take; applied -= take;
            }
        }
        await client.query('COMMIT');
        creditsCache.invalidate(license_key);
        await logAdminAction({ action: delta > 0 ? 'add_credits' : 'remove_credits', license_key, actor: actorFrom(req), reason,
            details: { requested: delta, applied } });
        return res.json({ success: true, applied,
            message: `${applied >= 0 ? 'Added' : 'Removed'} ${Math.abs(applied)} credit(s)${(delta < 0 && -applied < -delta) ? ' (capped at balance)' : ''}.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[admin/adjust-credits]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
});

// ── POST /api/admin/resend-verification ───────────────────────────────────────
// Re-send the email-verification link for a free licence (stuck-user support).
router.post('/resend-verification', auth, async (req, res) => {
    const { license_key } = req.body;
    if (!license_key) return res.status(400).json({ success: false, error: 'license_key is required.' });
    const client = await pool.connect();
    try {
        const lk = await client.query(
            `SELECT lk.id, lk.email_verified, u.email
             FROM license_keys lk JOIN users u ON u.id = lk.user_id
             WHERE lk.license_key = $1`, [license_key]);
        if (!lk.rows.length) return res.status(404).json({ success: false, error: 'Licence not found.' });
        const row = lk.rows[0];
        if (row.email_verified) return res.status(400).json({ success: false, error: 'This licence is already verified.' });
        await sendVerificationEmail(client, row.id, row.email, license_key);
        await logAdminAction({ action: 'resend_verification', license_key, actor: actorFrom(req), details: { email: row.email } });
        return res.json({ success: true, message: `Verification email re-sent to ${row.email}.` });
    } catch (err) {
        console.error('[admin/resend-verification]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
});

// ── GET /api/admin/audit-log ──────────────────────────────────────────────────
// Recent admin actions, newest first. ?license_key= filters to one licence;
// ?limit (default 50, max 200).
router.get('/audit-log', auth, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || 50), 1), 200);
    const lkFilter = req.query.license_key || null;
    try {
        const params = [];
        let where = '';
        if (lkFilter) { params.push(lkFilter); where = 'WHERE license_key = $1'; }
        params.push(limit);
        const r = await pool.query(
            `SELECT action, license_key, actor, reason, details, created_at
             FROM admin_audit_log ${where}
             ORDER BY created_at DESC
             LIMIT $${params.length}`, params);
        return res.json({ success: true, entries: r.rows });
    } catch (err) {
        console.error('[admin/audit-log]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/admin/launch ─────────────────────────────────────────────────────
// The real-time launch funnel — powers the Launch Monitor tab in one call.
// Sources the launch-plan Phase 0 §1.3 metrics + the §8 cost/abuse tripwires.
// Definitions:
//   registration = a free_registrations row (the true install→signup proxy)
//   activation   = a licence with >=1 usage_logs row where credits_used > 0
//                  (a real credit-spending generation, not a validation/cost row)
//   paid         = license_keys with lower(tier) <> 'free' AND status = 'active'
// tier is lower()-compared because the DB may hold 'Agency'/'AGENCY' etc.
router.get('/launch', auth, async (req, res) => {
    try {
        const [funnel, verif, ttf, cost, wReg, wAct, dBurn, multiDom, ips, bundles] = await Promise.all([
            pool.query(`
                WITH r AS (SELECT COUNT(*) n FROM free_registrations fr
                           JOIN license_keys lk ON lk.id = fr.license_key_id WHERE NOT lk.is_test),
                     a AS (SELECT COUNT(DISTINCT ul.license_key_id) n FROM usage_logs ul
                           JOIN license_keys lk ON lk.id = ul.license_key_id
                           WHERE ul.credits_used > 0 AND NOT lk.is_test),
                     p AS (SELECT COUNT(*) n FROM license_keys
                           WHERE lower(tier) <> 'free' AND status = 'active' AND NOT is_test)
                SELECT r.n AS registrations, a.n AS activated, p.n AS paid FROM r, a, p
            `),
            pool.query(`
                SELECT COUNT(*) AS free_licences,
                       COUNT(*) FILTER (WHERE email_verified) AS verified
                FROM license_keys WHERE lower(tier) = 'free' AND NOT is_test
            `),
            pool.query(`
                WITH fg AS (
                    SELECT fr.license_key_id, fr.created_at AS reg, MIN(ul.created_at) AS firstgen
                    FROM free_registrations fr
                    JOIN license_keys lk ON lk.id = fr.license_key_id AND NOT lk.is_test
                    JOIN usage_logs ul ON ul.license_key_id = fr.license_key_id AND ul.credits_used > 0
                    GROUP BY fr.license_key_id, fr.created_at)
                SELECT COUNT(*) AS activated_licences,
                       ROUND(AVG(EXTRACT(EPOCH FROM (firstgen - reg))/3600)::numeric, 1) AS avg_hours,
                       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (firstgen - reg))/3600))::numeric, 1) AS median_hours,
                       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (firstgen - reg))/3600))::numeric, 1) AS p90_hours
                FROM fg
            `),
            pool.query(`
                SELECT
                    COALESCE(SUM(ul.total_cost_usd) FILTER (WHERE lower(lk.tier) = 'free'), 0) AS free_tier_cost_all,
                    COALESCE(SUM(ul.total_cost_usd) FILTER (WHERE ul.created_at >= date_trunc('day', NOW())), 0) AS burn_today,
                    COALESCE(SUM(ul.total_cost_usd) FILTER (WHERE ul.created_at >= date_trunc('day', NOW()) - INTERVAL '1 day'
                                                              AND ul.created_at <  date_trunc('day', NOW())), 0) AS burn_yesterday
                FROM usage_logs ul LEFT JOIN license_keys lk ON lk.id = ul.license_key_id
                WHERE ul.total_cost_usd IS NOT NULL AND lk.is_test IS NOT TRUE
            `),
            pool.query(`
                SELECT to_char(date_trunc('week', fr.created_at), 'YYYY-MM-DD') AS week, COUNT(*) AS registrations
                FROM free_registrations fr JOIN license_keys lk ON lk.id = fr.license_key_id
                WHERE fr.created_at >= NOW() - INTERVAL '12 weeks' AND NOT lk.is_test
                GROUP BY 1 ORDER BY 1
            `),
            pool.query(`
                WITH fg AS (SELECT ul.license_key_id, MIN(ul.created_at) AS firstgen
                            FROM usage_logs ul JOIN license_keys lk ON lk.id = ul.license_key_id
                            WHERE ul.credits_used > 0 AND NOT lk.is_test
                            GROUP BY ul.license_key_id)
                SELECT to_char(date_trunc('week', firstgen), 'YYYY-MM-DD') AS week, COUNT(*) AS activations
                FROM fg WHERE firstgen >= NOW() - INTERVAL '12 weeks' GROUP BY 1 ORDER BY 1
            `),
            pool.query(`
                SELECT to_char(date_trunc('day', ul.created_at), 'YYYY-MM-DD') AS day,
                       ROUND(SUM(ul.total_cost_usd), 2) AS total_cost_usd,
                       ROUND(COALESCE(SUM(ul.total_cost_usd) FILTER (WHERE lower(lk.tier) = 'free'), 0), 2) AS free_tier_cost_usd,
                       COUNT(*) FILTER (WHERE ul.cost_event = 'generate') AS generations
                FROM usage_logs ul LEFT JOIN license_keys lk ON lk.id = ul.license_key_id
                WHERE ul.created_at >= NOW() - INTERVAL '14 days' AND ul.total_cost_usd IS NOT NULL
                  AND lk.is_test IS NOT TRUE
                GROUP BY 1 ORDER BY 1
            `),
            pool.query(`
                SELECT lk.license_key, COUNT(DISTINCT ul.domain) AS domains
                FROM usage_logs ul JOIN license_keys lk ON lk.id = ul.license_key_id
                WHERE lower(lk.tier) = 'free' AND ul.credits_used > 0 AND NOT lk.is_test
                GROUP BY lk.license_key
                HAVING COUNT(DISTINCT ul.domain) > 1
                ORDER BY domains DESC LIMIT 10
            `),
            pool.query(`
                SELECT fr.registered_ip, COUNT(*) AS registrations
                FROM free_registrations fr JOIN license_keys lk ON lk.id = fr.license_key_id
                WHERE NOT lk.is_test
                GROUP BY fr.registered_ip HAVING COUNT(*) > 2
                ORDER BY registrations DESC LIMIT 10
            `),
            // Credit-bundle purchases (one-time revenue, invisible to MRR). Bundle
            // batches are marked by their notes ('stripe_session:%' / 'bundle:%') and
            // never expire. Revenue is derived from the fixed price map (credits→$)
            // in create-checkout-session.js since the amount is only stored as text.
            // Split by tier bucket: a 'free' buyer is a paying customer the paid-tier
            // funnel misses entirely.
            pool.query(`
                SELECT
                    CASE WHEN lower(lk.tier) = 'free' THEN 'free' ELSE 'paid' END AS bucket,
                    COUNT(*)                            AS purchases,
                    COUNT(DISTINCT lk.id)               AS buyers,
                    COALESCE(SUM(cb.credits_issued), 0) AS credits_sold,
                    COALESCE(SUM(CASE cb.credits_issued WHEN 20 THEN 9 WHEN 50 THEN 19 WHEN 120 THEN 39 ELSE 0 END), 0) AS revenue_usd,
                    COUNT(*) FILTER (WHERE cb.credits_issued NOT IN (20, 50, 120)) AS unknown_priced
                FROM credit_batches cb
                JOIN license_keys lk ON lk.id = cb.license_key_id
                WHERE (cb.notes LIKE 'stripe_session:%' OR cb.notes LIKE 'bundle:%') AND NOT lk.is_test
                GROUP BY 1
            `),
        ]);

        const f = funnel.rows[0];
        const registrations = parseInt(f.registrations) || 0;
        const activated     = parseInt(f.activated) || 0;
        const paid          = parseInt(f.paid) || 0;

        const v = verif.rows[0];
        const freeLic  = parseInt(v.free_licences) || 0;
        const verified = parseInt(v.verified) || 0;

        const c = cost.rows[0];
        const freeCostAll = parseFloat(c.free_tier_cost_all) || 0;
        const burnToday   = parseFloat(c.burn_today) || 0;

        const pct1 = (num, den) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
        const activationPct = pct1(activated, registrations);
        const r2p = registrations > 0 ? Math.round((paid / registrations) * 10000) / 100 : 0;

        // Gate bands (launch plan §0/§10). The <50-registrations "early" guard stops
        // a day-2 zero-paid reading as "broken" — the plan judges this at ~90 days.
        let gate;
        if (registrations < 50) gate = 'early';
        else if (r2p < 0.5)     gate = 'broken';
        else if (r2p < 3)       gate = 'optimise';
        else                    gate = 'ship';

        const costPerSignup = registrations > 0 ? Math.round((freeCostAll / registrations) * 10000) / 10000 : 0;
        const num = (x) => x !== null && x !== undefined ? parseFloat(x) : null;

        // Bundle aggregation (free vs paid buckets → totals).
        const blank = () => ({ purchases: 0, buyers: 0, credits_sold: 0, revenue_usd: 0, unknown_priced: 0 });
        const bkt = { free: blank(), paid: blank() };
        bundles.rows.forEach(r => {
            const b = bkt[r.bucket] || (bkt[r.bucket] = blank());
            b.purchases      = parseInt(r.purchases)   || 0;
            b.buyers         = parseInt(r.buyers)      || 0;
            b.credits_sold   = parseInt(r.credits_sold) || 0;
            b.revenue_usd    = parseFloat(r.revenue_usd) || 0;
            b.unknown_priced = parseInt(r.unknown_priced) || 0;
        });
        const bundleTotal = {
            purchases:      bkt.free.purchases + bkt.paid.purchases,
            buyers:         bkt.free.buyers + bkt.paid.buyers,
            credits_sold:   bkt.free.credits_sold + bkt.paid.credits_sold,
            revenue_usd:    bkt.free.revenue_usd + bkt.paid.revenue_usd,
            unknown_priced: bkt.free.unknown_priced + bkt.paid.unknown_priced,
        };

        return res.json({
            success: true,
            funnel: {
                registrations, activated, paid,
                activation_pct: activationPct,
                registered_to_paid_pct: r2p,
                gate,
            },
            verification: {
                free_licences: freeLic, verified,
                verified_pct: pct1(verified, freeLic),
            },
            ttf: {
                activated_licences: parseInt(ttf.rows[0].activated_licences) || 0,
                avg_hours:    num(ttf.rows[0].avg_hours),
                median_hours: num(ttf.rows[0].median_hours),
                p90_hours:    num(ttf.rows[0].p90_hours),
            },
            cost: {
                free_tier_cost_all: Math.round(freeCostAll * 100) / 100,
                cost_per_signup: costPerSignup,
                burn_today: Math.round(burnToday * 100) / 100,
                burn_yesterday: Math.round((parseFloat(c.burn_yesterday) || 0) * 100) / 100,
                tripwire_usd: 5,
                over_tripwire: burnToday > 5,
            },
            series: {
                weekly_registrations: wReg.rows,
                weekly_activations:   wAct.rows,
                daily_burn:           dBurn.rows,
            },
            alerts: {
                multi_domain_free_keys:  multiDom.rows.length,
                repeat_ip_registrations: ips.rows.length,
                top_multi_domain: multiDom.rows,
                top_ips: ips.rows,
            },
            bundles: {
                total: bundleTotal,
                free:  bkt.free,
                paid:  bkt.paid,
            },
        });
    } catch (err) {
        console.error('[admin/launch]', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;