// routes/portal-stripe.js
// POST /api/portal/stripe-portal  — creates a Stripe billing portal session
// POST /api/portal/checkout       — creates Stripe checkout for bundles / plan upgrades

const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const { Pool } = require('pg');
const { requireAuth } = require('./portal-auth');

// Reuse existing bundle definitions — keeps everything in sync
const { BUNDLES } = require('./create-checkout-session');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const pool   = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Subscription Price IDs — same env vars the webhook already uses
const PLAN_PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID,
  pro:     process.env.STRIPE_PRO_PRICE_ID,
  agency:  process.env.STRIPE_AGENCY_PRICE_ID,
};

// ── POST /api/portal/stripe-portal ───────────────────────────────────────
router.post('/stripe-portal', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT stripe_customer_id FROM license_keys WHERE license_key = $1`,
      [req.user.license_key]
    );

    if (!result.rows.length || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({
        error: 'No billing record found. If you purchased via the plugin, your billing portal will be available after your first renewal.'
      });
    }

    const returnUrl = process.env.PORTAL_URL
      ? `${process.env.PORTAL_URL}/portal`
      : (req.headers.origin || 'https://aicontentbridge.com') + '/portal';

    const session = await stripe.billingPortal.sessions.create({
      customer:   result.rows[0].stripe_customer_id,
      return_url: returnUrl,
    });

    console.log(`[portal/stripe-portal] Session created for ${req.user.email}`);
    res.json({ success: true, url: session.url });

  } catch (err) {
    console.error('[portal/stripe-portal]', err.message);
    res.status(500).json({ error: 'Failed to open billing portal: ' + err.message });
  }
});

// ── POST /api/portal/checkout ─────────────────────────────────────────────
router.post('/checkout', requireAuth, async (req, res) => {
  const { type, bundle_id, plan } = req.body;

  try {
    const licRes = await pool.query(
      `SELECT id, stripe_customer_id FROM license_keys WHERE license_key = $1`,
      [req.user.license_key]
    );
    const lic        = licRes.rows[0] || {};
    const customerId = lic.stripe_customer_id;
    const licenseId  = lic.id;

    const baseUrl = process.env.PORTAL_URL
      ? `${process.env.PORTAL_URL}`
      : (req.headers.origin || 'https://aicontentbridge.com');

    const successUrl = `${baseUrl}/portal?purchase=success`;
    const cancelUrl  = `${baseUrl}/portal`;

    // ── BUNDLE ───────────────────────────────────────────────────────────
    if (type === 'bundle') {
      const bundle = BUNDLES[bundle_id];
      if (!bundle) {
        return res.status(400).json({ error: `Unknown bundle: ${bundle_id}` });
      }

      const session = await stripe.checkout.sessions.create({
        mode:           'payment',
        customer:       customerId || undefined,
        customer_email: customerId ? undefined : req.user.email,
        line_items:     [{ price: bundle.stripe_price_id, quantity: 1 }],
        success_url:    successUrl,
        cancel_url:     cancelUrl,
        metadata: {
          license_key: req.user.license_key,
          license_id:  String(licenseId),
          bundle_id,
          credits:     String(bundle.credits),
        },
      });

      console.log(`[portal/checkout] Bundle ${bundle_id} for ${req.user.email}`);
      return res.json({ success: true, url: session.url });
    }

    // ── PLAN UPGRADE ─────────────────────────────────────────────────────
    if (type === 'upgrade') {
      const priceId = PLAN_PRICE_IDS[plan?.toLowerCase()];
      if (!priceId) {
        return res.status(400).json({
          error: `Price not configured for plan "${plan}". Add STRIPE_${plan?.toUpperCase()}_PRICE_ID to Railway variables.`
        });
      }

      // If customer already has a Stripe customer ID, check for existing subscription
      if (customerId) {
        try {
          const subs = await stripe.subscriptions.list({
            customer: customerId,
            status:   'active',
            limit:    1,
          });
          if (subs.data.length > 0) {
            // Already subscribed — send to billing portal to change plan
            const portalSession = await stripe.billingPortal.sessions.create({
              customer:   customerId,
              return_url: cancelUrl,
            });
            console.log(`[portal/checkout] Existing sub — redirecting to portal for ${req.user.email}`);
            return res.json({ success: true, url: portalSession.url });
          }
        } catch (subErr) {
          console.warn('[portal/checkout] Sub check failed, proceeding to checkout:', subErr.message);
        }
      }

      const session = await stripe.checkout.sessions.create({
        mode:           'subscription',
        customer:       customerId || undefined,
        customer_email: customerId ? undefined : req.user.email,
        line_items:     [{ price: priceId, quantity: 1 }],
        success_url:    successUrl,
        cancel_url:     cancelUrl,
        metadata: {
          license_key: req.user.license_key,
          license_id:  String(licenseId),
          plan,
        },
      });

      console.log(`[portal/checkout] ${plan} subscription for ${req.user.email}`);
      return res.json({ success: true, url: session.url });
    }

    return res.status(400).json({ error: 'type must be "bundle" or "upgrade"' });

  } catch (err) {
    console.error('[portal/checkout]', err.message);
    res.status(500).json({ error: 'Failed to create checkout: ' + err.message });
  }
});

module.exports = router;
