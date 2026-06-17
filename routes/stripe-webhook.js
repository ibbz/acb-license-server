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

// Monthly credit allowance per paid tier (from v2.5 product spec).
// Free tier credits are granted at registration, not here.
const CREDIT_ALLOWANCE = { starter: 30, pro: 100, agency: 300 };

// Grant a subscription's monthly credit allowance.
// No rollover: any leftover from a previous month's subscription grant is zeroed
// first. One-time bundle credits (notes 'stripe_session:%') and the free grant
// ('free_tier_initial') are left untouched, so they persist/stack on top.
// Idempotent per dedupeKey so Stripe webhook retries can't double-grant.
async function grantSubscriptionCredits({ licenseId, tier, dedupeKey, expiresInDays = 35 }) {
  const allowance = CREDIT_ALLOWANCE[(tier || '').toLowerCase()];
  if (!allowance) {
    console.log(`[webhook] No credit allowance for tier '${tier}' — skipping grant`);
    return;
  }
  const note = `subscription_credits:${dedupeKey}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT id FROM credit_batches WHERE license_key_id = $1 AND notes = $2`,
      [licenseId, note]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`[webhook] Duplicate credit grant ignored: ${note}`);
      return;
    }

    // No rollover — expire any prior monthly subscription credits for this licence.
    await client.query(
      `UPDATE credit_batches
       SET credits_remaining = 0, updated_at = NOW()
       WHERE license_key_id = $1 AND notes LIKE 'subscription_credits:%' AND credits_remaining > 0`,
      [licenseId]
    );

    await client.query(
      `INSERT INTO credit_batches
         (license_key_id, credits_issued, credits_remaining, source, issued_date, expiry_date, notes)
       VALUES ($1, $2, $2, 'subscription', CURRENT_DATE, CURRENT_DATE + ($3::int * INTERVAL '1 day'), $4)`,
      [licenseId, allowance, expiresInDays, note]
    );

    await client.query('COMMIT');
    console.log(`[webhook] Granted ${allowance} '${tier}' credits to license_id=${licenseId} (${note})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[webhook] grantSubscriptionCredits failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
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
  const { license_id, plan } = session.metadata || {};
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

  const planKey    = (plan || '').toLowerCase();
  const tier       = ['starter', 'pro', 'agency'].includes(planKey) ? planKey : 'free';
  const postsLimit = tier === 'starter' ? 50 : (tier === 'pro' || tier === 'agency') ? -1 : 5;

  await pool.query(`
    UPDATE license_keys
    SET tier = $1,
        status = 'active',
        posts_limit = $2,
        stripe_customer_id = COALESCE($3, stripe_customer_id),
        stripe_subscription_id = $4,
        stripe_subscription_status = 'active',
        updated_at = NOW()
    WHERE id = $5
  `, [tier, postsLimit, customerId, subscriptionId, parseInt(license_id)]);

  if (customerId) {
    await pool.query(
      `UPDATE users SET stripe_customer_id = $1 WHERE id = (SELECT user_id FROM license_keys WHERE id = $2)`,
      [customerId, parseInt(license_id)]
    );
  }

  // First month's credit allowance. Renewals are granted in handlePaymentSucceeded.
  await grantSubscriptionCredits({
    licenseId: parseInt(license_id),
    tier,
    dedupeKey: `checkout:${session.id}`,
  });

  console.log(`[webhook] Subscription provisioned: license_id=${license_id} → ${tier} (customer ${customerId})`);
}

async function handleSubscriptionUpdate(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items.data[0].price.id;

  // Map Stripe price IDs to tiers (you'll configure these in Stripe Dashboard)
  const tierMap = {
    [process.env.STRIPE_STARTER_PRICE_ID]: 'starter',
    [process.env.STRIPE_PRO_PRICE_ID]: 'pro',
    [process.env.STRIPE_AGENCY_PRICE_ID]: 'agency'
  };

  const tier = tierMap[priceId] || 'free';
  const postsLimit = tier === 'starter' ? 50 : tier === 'pro' || tier === 'agency' ? -1 : 5;

  // Update license in database
  const result = await pool.query(`
    UPDATE license_keys 
    SET 
      tier = $1,
      status = $2,
      posts_limit = $3,
      stripe_subscription_id = $4,
      stripe_subscription_status = $5,
      updated_at = NOW()
    WHERE stripe_customer_id = $6
  `, [tier, status, postsLimit, subscription.id, status, customerId]);

  // If the customer wasn't linked yet (e.g. this event arrived before the checkout
  // session was processed), fall back to linking via our subscription metadata.
  if (result.rowCount === 0 && subscription.metadata && subscription.metadata.license_id) {
    const licenseId = parseInt(subscription.metadata.license_id);
    await pool.query(`
      UPDATE license_keys
      SET tier = $1, status = $2, posts_limit = $3,
          stripe_customer_id = $4, stripe_subscription_id = $5,
          stripe_subscription_status = $6, updated_at = NOW()
      WHERE id = $7
    `, [tier, status, postsLimit, customerId, subscription.id, status, licenseId]);
    await pool.query(
      `UPDATE users SET stripe_customer_id = $1 WHERE id = (SELECT user_id FROM license_keys WHERE id = $2)`,
      [customerId, licenseId]
    );
    console.log(`[webhook] Subscription linked via metadata.license_id=${licenseId} → ${tier} (${status})`);
    return;
  }

  console.log(`✅ Subscription updated: ${customerId} → ${tier} (${status})`);
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
      `SELECT id, tier FROM license_keys WHERE stripe_customer_id = $1`,
      [customerId]
    );
    if (licRes.rows.length > 0) {
      await grantSubscriptionCredits({
        licenseId: licRes.rows[0].id,
        tier:      licRes.rows[0].tier,
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