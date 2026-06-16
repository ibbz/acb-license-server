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
  if (customerId && !(await isAcbCustomer(customerId))) {
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
  // Only process one-time payments (not subscription checkouts)
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
  await pool.query(`
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

  console.log(`💰 Payment succeeded: ${customerId} → credits reset`);
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