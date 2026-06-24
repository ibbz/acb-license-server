/**
 * Stripe Webhook Handler
 * POST /api/stripe-webhook
 * 
 * Handles Stripe events for subscriptions and payments.
 * Updates license tier and status automatically.
 */

const express = require('express');
const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Import bundle definitions so we stay in sync
const { BUNDLES } = require('./create-checkout-session');
const { tierFromPriceId, postsLimitForTier, normaliseInterval, TIER_RANK } = require('./plans');
const { grantSubscriptionCredits: grantSharedCredits, grantUpgradeCredits: grantUpgradeShared } = require('../lib/subscription-credits');

// Thin wrapper so existing call sites stay unchanged — binds the shared grant
// (no-rollover, 35-day, idempotent) to this module's pool.
async function grantSubscriptionCredits(args) {
  return grantSharedCredits(pool, args);
}

// Additive upgrade grant (adds the new tier's allowance on top, no zeroing),
// bound to this module's pool.
async function grantUpgradeCredits(args) {
  return grantUpgradeShared(pool, args);
}

// Note: raw body parsing is handled in server.js before this route
// so Stripe signature verification works correctly.

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[webhook] Event received: ${event.type}`);

  // ── Product isolation ──────────────────────────────────────────────────────
  // This Stripe account also serves LearnBridge, and Stripe delivers every event
  // to every subscribed endpoint. Only act on events whose customer exists in THIS
  // (ACB) database; anything else belongs to the other product — acknowledge and skip.
  const eventObj = event.data.object || {};
  const customerId = typeof eventObj.customer === 'string'
    ? eventObj.customer
    : (eventObj.customer && eventObj.customer.id) || null;
  // An event belongs to ACB if it carries our app tag (set on every ACB checkout
  // and subscription) OR its customer is already linked in this database. The tag
  // is essential for a brand-new subscriber whose customer isn't linked yet.
  const taggedAcb = (eventObj.metadata && eventObj.metadata.app === 'acb');
  if (customerId && !taggedAcb && !(await isAcbCustomer(customerId))) {
    console.log(`[webhook] Ignored ${event.type} — ${customerId} is not an ACB customer`);
    return res.json({ received: true, ignored: true });
  }

  try {
    switch (event.type) {
      // ── One-time credit bundle purchase completed ──
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      // ── Subscription events ──
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        console.log(`[webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('[webhook] Handler error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Returns true if the Stripe customer belongs to this (ACB) database.
async function isAcbCustomer(customerId) {
  const r = await pool.query(
    'SELECT 1 FROM license_keys WHERE stripe_customer_id = $1 LIMIT 1',
    [customerId]
  );
  return r.rows.length > 0;
}

async function handleCheckoutCompleted(session) {
  // Subscription checkouts: link the customer and set the tier (authoritative).
  if (session.mode === 'subscription') {
    return handleSubscriptionCheckout(session);
  }
  // Only process one-time payments below
  if (session.mode !== 'payment') return;

  const { license_key, license_id, bundle_id, credits } = session.metadata || {};

  if (!license_key || !credits) {
    console.error('[webhook] checkout.session.completed missing metadata:', session.id);
    return;
  }

  const bundle = BUNDLES[bundle_id];
  const creditsInt = parseInt(credits);

  console.log(`[webhook] Checkout completed: session=${session.id}, license=${license_key}, bundle=${bundle_id}, credits=${creditsInt}`);

  // Use buy-credits logic directly (inline to avoid HTTP call to ourselves)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Prevent duplicate processing
    const dupCheck = await client.query(
      `SELECT id FROM credit_batches WHERE license_key_id = $1 AND notes = $2`,
      [parseInt(license_id), `stripe_session:${session.id}`]
    );

    if (dupCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[webhook] Duplicate session ignored: ${session.id}`);
      return;
    }

    // Insert never-expiring credit batch
    // Uses 'credits_issued' to match existing DB schema
    await client.query(
      `INSERT INTO credit_batches (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
       VALUES ($1, $2, $2, CURRENT_DATE, '2099-12-31', $3)`,
      [parseInt(license_id), creditsInt, `stripe_session:${session.id}`]
    );

    // Log the purchase
    await client.query(
      `INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, created_at)
       VALUES ($1, 'credit_purchase', $2, 0, NOW())`,
      [parseInt(license_id), `Purchased ${creditsInt} credits - ${bundle?.name || bundle_id} ($${(session.amount_total / 100).toFixed(2)})`]
    );

    await client.query('COMMIT');
    console.log(`[webhook] Credits added: ${creditsInt} credits to license ${license_key}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[webhook] Failed to add credits:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Provision a subscription from its checkout session. checkout.session.completed
// always carries our metadata (license_id, plan), so this works even for a brand-new
// customer whose stripe_customer_id was created by Stripe during checkout.
async function handleSubscriptionCheckout(session) {
  const { license_id, plan, interval } = session.metadata || {};
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : (session.customer && session.customer.id) || null;
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription && session.subscription.id) || null;

  if (!license_id) {
    console.error('[webhook] subscription checkout missing license_id:', session.id);
    return;
  }

  const planKey         = (plan || '').toLowerCase();
  const tier            = ['starter', 'pro', 'agency'].includes(planKey) ? planKey : 'free';
  const postsLimit      = postsLimitForTier(tier);
  const billingInterval = normaliseInterval(interval);
  const isAnnual        = billingInterval === 'year';

  // For annual: start the monthly drip clock. Month 1 is granted now (below);
  // months 2-12 are topped up by the cron / lazy sweep using these timestamps.
  await pool.query(`
    UPDATE license_keys
    SET tier = $1,
        status = 'active',
        posts_limit = $2,
        stripe_customer_id = COALESCE($3, stripe_customer_id),
        stripe_subscription_id = $4,
        stripe_subscription_status = 'active',
        billing_interval = $5,
        annual_term_end      = CASE WHEN $6 THEN NOW() + INTERVAL '1 year'  ELSE NULL END,
        next_credit_grant_at = CASE WHEN $6 THEN NOW() + INTERVAL '1 month' ELSE NULL END,
        updated_at = NOW()
    WHERE id = $7
  `, [tier, postsLimit, customerId, subscriptionId, billingInterval, isAnnual, parseInt(license_id)]);

  if (customerId) {
    await pool.query(
      `UPDATE users SET stripe_customer_id = $1 WHERE id = (SELECT user_id FROM license_keys WHERE id = $2)`,
      [customerId, parseInt(license_id)]
    );
  }

  // First month's credit allowance (same for monthly and annual). Monthly renewals
  // come via invoice subscription_cycle; annual months 2-12 via the drip sweep.
  await grantSubscriptionCredits({
    licenseId: parseInt(license_id),
    tier,
    dedupeKey: `checkout:${session.id}`,
  });

  console.log(`[webhook] Subscription provisioned: license_id=${license_id} → ${tier} (${billingInterval}, customer ${customerId})`);
}

async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceObj = subscription.items.data[0].price;
  const priceId = priceObj.id;

  // Annual-aware: tierFromPriceId knows both monthly and annual price IDs, so an
  // annual subscription can never silently resolve to 'free'.
  const tier = tierFromPriceId(priceId);
  const postsLimit = postsLimitForTier(tier);
  const priceInterval = normaliseInterval(priceObj.recurring && priceObj.recurring.interval);
  const isAnnual = priceInterval === 'year';

  // Capture the tier BEFORE we overwrite it, so a genuine mid-cycle upgrade can be
  // detected and credited below. (This handler also fires for non-tier changes —
  // payment method, cancel toggles, status — which must NOT grant.)
  let oldTier = null, upgradeLicenseId = null;
  try {
    const pre = await pool.query(
      `SELECT id, tier FROM license_keys WHERE stripe_customer_id = $1`,
      [customerId]
    );
    if (pre.rows.length > 0) { oldTier = pre.rows[0].tier; upgradeLicenseId = pre.rows[0].id; }
  } catch (e) {
    console.error('[webhook] pre-update tier read failed:', e.message);
  }

  // Update license in database. Keep billing_interval in sync with the live price.
  // The annual clock is initialised here only if not already set (COALESCE), so a
  // monthly->annual switch via the billing portal starts the drip without
  // disturbing an existing annual schedule. Grants never happen here.
  const result = await pool.query(`
    UPDATE license_keys
    SET
      tier = $1,
      status = $2,
      posts_limit = $3,
      stripe_subscription_id = $4,
      stripe_subscription_status = $5,
      billing_interval = $7,
      annual_term_end      = CASE WHEN $8 THEN COALESCE(annual_term_end,      NOW() + INTERVAL '1 year')  ELSE NULL END,
      next_credit_grant_at = CASE WHEN $8 THEN COALESCE(next_credit_grant_at, NOW() + INTERVAL '1 month') ELSE NULL END,
      updated_at = NOW()
    WHERE stripe_customer_id = $6
  `, [tier, status, postsLimit, subscription.id, status, customerId, priceInterval, isAnnual]);

  // If the customer wasn't linked yet (e.g. this event arrived before the checkout
  // session was processed), fall back to linking via our subscription metadata.
  if (result.rowCount === 0 && subscription.metadata && subscription.metadata.license_id) {
    const licenseId = parseInt(subscription.metadata.license_id);
    await pool.query(`
      UPDATE license_keys
      SET tier = $1, status = $2, posts_limit = $3,
          stripe_customer_id = $4, stripe_subscription_id = $5,
          stripe_subscription_status = $6,
          billing_interval = $7,
          annual_term_end      = CASE WHEN $8 THEN COALESCE(annual_term_end,      NOW() + INTERVAL '1 year')  ELSE NULL END,
          next_credit_grant_at = CASE WHEN $8 THEN COALESCE(next_credit_grant_at, NOW() + INTERVAL '1 month') ELSE NULL END,
          updated_at = NOW()
      WHERE id = $9
    `, [tier, status, postsLimit, customerId, subscription.id, status, priceInterval, isAnnual, licenseId]);
    await pool.query(
      `UPDATE users SET stripe_customer_id = $1 WHERE id = (SELECT user_id FROM license_keys WHERE id = $2)`,
      [customerId, licenseId]
    );
    console.log(`[webhook] Subscription linked via metadata.license_id=${licenseId} → ${tier} (${status}, ${priceInterval})`);
    return;
  }

  // Mid-cycle UPGRADE → add the new tier's allowance on top of the existing
  // balance (unused monthly + bundles preserved). Upgrades only:
  //   • skip downgrades (would otherwise yank credits away mid-period), and
  //   • skip free→paid (a brand-new subscription is credited at checkout).
  // Deduped per subscription+price+period so duplicate events and same-period
  // upgrade/downgrade churn can't re-add. Renewal still resets to a clean
  // allowance (the upgrade batch is in the 'subscription_credits:' family the
  // no-rollover renewal sweep clears).
  if (
    upgradeLicenseId &&
    oldTier && TIER_RANK[oldTier] >= TIER_RANK.starter &&
    typeof TIER_RANK[tier] === 'number' && TIER_RANK[tier] > TIER_RANK[oldTier]
  ) {
    // Period stamp makes the key unique per billing period, so a legitimate
    // re-upgrade in a LATER period grants again while same-period churn / webhook
    // retries don't. As of the 2026-04-22.dahlia API version the period fields
    // live on the subscription ITEM, not the root (root is now undefined) — read
    // the item first, fall back to the root for older versions, then to a literal
    // so the key is never the string 'undefined'.
    const periodStart =
      (subscription.items && subscription.items.data && subscription.items.data[0]
        ? subscription.items.data[0].current_period_start
        : undefined)
      ?? subscription.current_period_start
      ?? 'na';
    const dedupeKey = `${subscription.id}:${priceId}:${periodStart}`;
    try {
      await grantUpgradeCredits({ licenseId: upgradeLicenseId, tier, dedupeKey });
      console.log(`[webhook] Upgrade detected ${oldTier} → ${tier} (license_id=${upgradeLicenseId}) — credits topped up`);
    } catch (e) {
      console.error('[webhook] upgrade credit grant failed:', e.message);
    }
  }

  console.log(`✅ Subscription updated: ${customerId} → ${tier} (${status}, ${priceInterval})`);
}

async function handleSubscriptionCancelled(subscription) {
  const customerId = subscription.customer;

  await pool.query(`
    UPDATE license_keys 
    SET 
      tier = 'free',
      status = 'cancelled',
      posts_limit = 5,
      stripe_subscription_status = 'cancelled',
      billing_interval = 'month',
      annual_term_end = NULL,
      next_credit_grant_at = NULL,
      updated_at = NOW()
    WHERE stripe_customer_id = $1
  `, [customerId]);

  console.log(`⚠️ Subscription cancelled: ${customerId} → downgraded to free`);
}

async function handlePaymentSucceeded(invoice) {
  const customerId = invoice.customer;

  // Reset monthly usage on successful payment (for monthly subscriptions)
  await pool.query(`
    UPDATE license_keys 
    SET 
      posts_used_this_month = 0,
      month_reset_date = NOW() + INTERVAL '1 month',
      updated_at = NOW()
    WHERE stripe_customer_id = $1
  `, [customerId]);

  // Top up the monthly credit allowance on renewals only. The first month is
  // granted at checkout (handleSubscriptionCheckout); the first invoice has
  // billing_reason 'subscription_create', so we skip it here to avoid double-granting.
  if (invoice.billing_reason === 'subscription_cycle') {
    const licRes = await pool.query(
      `SELECT id, tier, billing_interval FROM license_keys WHERE stripe_customer_id = $1`,
      [customerId]
    );
    if (licRes.rows.length > 0) {
      const lic = licRes.rows[0];

      // Annual renewal fires once a year. Restart the term and the monthly drip
      // clock, then grant the first month of the new year. Months 2-12 are handled
      // by the cron / lazy sweep.
      if (lic.billing_interval === 'year') {
        await pool.query(`
          UPDATE license_keys
          SET annual_term_end      = NOW() + INTERVAL '1 year',
              next_credit_grant_at = NOW() + INTERVAL '1 month',
              updated_at = NOW()
          WHERE id = $1
        `, [lic.id]);
      }

      await grantSubscriptionCredits({
        licenseId: lic.id,
        tier:      lic.tier,
        dedupeKey: `invoice:${invoice.id}`,
      });
    } else {
      console.log(`[webhook] payment_succeeded: no licence linked to customer ${customerId}`);
    }
  }

  console.log(`💰 Payment succeeded: ${customerId} (${invoice.billing_reason})`);
}

async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;

  await pool.query(`
    UPDATE license_keys 
    SET 
      status = 'suspended',
      updated_at = NOW()
    WHERE stripe_customer_id = $1
  `, [customerId]);

  console.log(`❌ Payment failed: ${customerId} → suspended`);
}

module.exports = router;