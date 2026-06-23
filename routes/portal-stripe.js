// routes/portal-stripe.js
// POST /api/portal/stripe-portal  — creates a Stripe billing portal session
// POST /api/portal/checkout       — creates Stripe checkout for bundles / plan upgrades

const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const { Pool } = require('pg');
const { requireAuth, portalUrl } = require('./portal-auth');

// Reuse existing bundle definitions — keeps everything in sync
const { BUNDLES } = require('./create-checkout-session');
const { getPlanPriceId, normaliseInterval } = require('./plans');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const pool   = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

    const returnUrl = portalUrl();

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
  const { type, bundle_id, plan, interval } = req.body;

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
        line_items: [{
          price_data: {
            currency:     'usd',
            product_data: {
              name:        bundle.name,
              description: bundle.description,
              metadata:    { bundle_id, credits: String(bundle.credits) },
            },
            unit_amount: bundle.price_cents,
          },
          quantity: 1,
        }],
        success_url:    successUrl,
        cancel_url:     cancelUrl,
        metadata: {
          app:         'acb',
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
      const billingInterval = normaliseInterval(interval);
      const priceId = getPlanPriceId(plan, billingInterval);
      if (!priceId) {
        const envName = billingInterval === 'year'
          ? `STRIPE_${String(plan).toUpperCase()}_ANNUAL_PRICE_ID`
          : `STRIPE_${String(plan).toUpperCase()}_PRICE_ID`;
        return res.status(400).json({
          error: `Price not configured for plan "${plan}" (${billingInterval}). Add ${envName} to Railway variables.`
        });
      }

      // Look up the customer's live subscription (any status that still
      // represents a real subscription — not just 'active', so trialing/past_due
      // route to a plan change rather than a duplicate signup).
      let liveSub = null;
      if (customerId) {
        try {
          const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
          liveSub = subs.data.find(s =>
            ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(s.status)
          ) || null;
        } catch (listErr) {
          // We have a billing record but can't read it — do NOT silently create a
          // second subscription. Surface it instead.
          console.error('[portal/checkout] subscriptions.list failed:', listErr.message);
          return res.status(502).json({ error: 'Could not read your current subscription from Stripe. Please try again in a moment.' });
        }
      }

      // Already subscribed → CHANGE the existing subscription, never create a
      // second one. Prefer a deep-linked "confirm switch to <plan>" screen; fall
      // back to the generic billing portal if the deep link is unavailable.
      if (liveSub) {
        const currentItem = liveSub.items && liveSub.items.data && liveSub.items.data[0];

        if (currentItem) {
          try {
            const portalSession = await stripe.billingPortal.sessions.create({
              customer:   customerId,
              return_url: successUrl,
              flow_data: {
                type: 'subscription_update_confirm',
                subscription_update_confirm: {
                  subscription: liveSub.id,
                  items: [{ id: currentItem.id, price: priceId, quantity: 1 }],
                },
                after_completion: { type: 'redirect', redirect: { return_url: successUrl } },
              },
            });
            console.log(`[portal/checkout] Plan change (deep-link) for ${req.user.email} → ${plan} (${billingInterval})`);
            return res.json({ success: true, url: portalSession.url });
          } catch (flowErr) {
            console.warn(`[portal/checkout] Deep-link unavailable (${flowErr.message}) — falling back to generic portal`);
          }
        }

        // Fallback: generic billing portal (still lets them change plan; no double-charge).
        try {
          const portalSession = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: successUrl });
          console.log(`[portal/checkout] Plan change (generic portal) for ${req.user.email}`);
          return res.json({ success: true, url: portalSession.url });
        } catch (portalErr) {
          console.error('[portal/checkout] Billing portal unavailable:', portalErr.message);
          return res.status(409).json({
            error: `Your subscription can't be changed automatically right now: ${portalErr.message}. In Stripe → Settings → Billing → Customer portal, enable plan switching for these products.`
          });
        }
      }

      // No live subscription → genuinely a new subscriber: create checkout.

      const session = await stripe.checkout.sessions.create({
        mode:           'subscription',
        customer:       customerId || undefined,
        customer_email: customerId ? undefined : req.user.email,
        line_items:     [{ price: priceId, quantity: 1 }],
        success_url:    successUrl,
        cancel_url:     cancelUrl,
        metadata: {
          app:         'acb',
          license_key: req.user.license_key,
          license_id:  String(licenseId),
          plan,
          interval:    billingInterval,
        },
        subscription_data: {
          metadata: {
            app:         'acb',
            license_key: req.user.license_key,
            license_id:  String(licenseId),
            plan,
            interval:    billingInterval,
          },
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
