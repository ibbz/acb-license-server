/**
 * POST /api/create-checkout-session
 *
 * Creates a Stripe Checkout session for a credit bundle purchase.
 * WordPress calls this, gets back a Checkout URL, redirects the user.
 * Credits are only added AFTER Stripe confirms payment via webhook.
 */

const express = require('express');
const router  = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Credit bundles — single source of truth
// Keep in sync with the UI in Usage.js
const BUNDLES = {
    starter: {
        name:        'Starter Pack',
        credits:     20,
        price_cents: 900,   // $9.00
        description: '20 credits — never expire',
    },
    popular: {
        name:        'Popular Pack',
        credits:     50,
        price_cents: 1900,  // $19.00
        description: '50 credits — never expire',
    },
    power: {
        name:        'Power Pack',
        credits:     120,
        price_cents: 3900,  // $39.00
        description: '120 credits — never expire',
    },
};

// Subscription plan price IDs (monthly + annual) resolve through the shared map.
const { getPlanPriceId, normaliseInterval } = require('./plans');

router.post('/', async (req, res) => {
    const { license_key, bundle_id, plan, interval, success_url, cancel_url } = req.body;

    if (!license_key || (!bundle_id && !plan)) {
        return res.status(400).json({ error: 'license_key and either bundle_id or plan are required' });
    }

    let bundle = null;
    if (bundle_id) {
        bundle = BUNDLES[bundle_id];
        if (!bundle) {
            return res.status(400).json({ error: `Unknown bundle: ${bundle_id}. Valid options: ${Object.keys(BUNDLES).join(', ')}` });
        }
    }

    // Verify the license key exists and is active
    let licenseId, stripeCustomerId, userEmail;
    try {
        const result = await pool.query(`
            SELECT lk.id, lk.stripe_customer_id, u.email
            FROM license_keys lk
            JOIN users u ON u.id = lk.user_id
            WHERE lk.license_key = $1 AND lk.status = 'active'
        `, [license_key]);

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Invalid or inactive license key' });
        }

        licenseId        = result.rows[0].id;
        stripeCustomerId = result.rows[0].stripe_customer_id;
        userEmail        = result.rows[0].email;
    } catch (err) {
        console.error('[checkout] DB error:', err.message);
        return res.status(500).json({ error: 'Database error' });
    }

    // Create or reuse Stripe customer
    try {
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email:    userEmail,
                metadata: { app: 'acb', license_key, license_id: licenseId.toString() },
            });
            stripeCustomerId = customer.id;

            await pool.query(`
                UPDATE license_keys SET stripe_customer_id = $1 WHERE id = $2
            `, [stripeCustomerId, licenseId]);

            await pool.query(`
                UPDATE users SET stripe_customer_id = $1 WHERE email = $2
            `, [stripeCustomerId, userEmail]);
        }
    } catch (err) {
        console.error('[checkout] Stripe customer error:', err.message);
        return res.status(500).json({ error: 'Failed to create Stripe customer' });
    }

    // Build return URLs — fall back to WP admin if not provided
    const returnBase = success_url
        ? success_url.replace(/\?.*$/, '')
        : 'https://example.com/wp-admin/admin.php';

    // ── Subscription plan checkout ─────────────────────────────────────────────
    if (plan) {
        const planKey = plan.toString().toLowerCase();
        const billingInterval = normaliseInterval(interval);
        const priceId = getPlanPriceId(planKey, billingInterval);
        if (!priceId) {
            const envName = billingInterval === 'year'
                ? `STRIPE_${planKey.toUpperCase()}_ANNUAL_PRICE_ID`
                : `STRIPE_${planKey.toUpperCase()}_PRICE_ID`;
            return res.status(400).json({
                error: `No Stripe price configured for plan "${plan}" (${billingInterval}). Set ${envName} in Railway.`,
            });
        }

        // Existing active subscription → don't create a second one. Deep-link the
        // billing portal straight to a "confirm switch to <plan>" screen for the
        // exact plan the user clicked, then redirect back to the plugin on
        // completion. Falls back to the generic portal if the current item can't be
        // resolved. (Requires plan switching enabled in the Stripe Customer Portal.)
        try {
            const existing = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active', limit: 1 });
            if (existing.data.length > 0) {
                const sub         = existing.data[0];
                const currentItem = sub.items && sub.items.data && sub.items.data[0];
                const flowReturnUrl = `${returnBase}?page=ai-content-bridge&upgrade=success&plan=${planKey}`;
                try {
                    const portalParams = {
                        customer:   stripeCustomerId,
                        return_url: flowReturnUrl,
                    };
                    if (currentItem) {
                        portalParams.flow_data = {
                            type: 'subscription_update_confirm',
                            subscription_update_confirm: {
                                subscription: sub.id,
                                items: [{ id: currentItem.id, price: priceId, quantity: 1 }],
                            },
                            after_completion: {
                                type: 'redirect',
                                redirect: { return_url: flowReturnUrl },
                            },
                        };
                    }
                    const portalSession = await stripe.billingPortal.sessions.create(portalParams);
                    console.log(`[checkout] Plan-change portal: license=${license_key} | ${planKey} (${billingInterval}) | deep_link=${!!currentItem}`);
                    return res.json({ success: true, checkout_url: portalSession.url, managed: true });
                } catch (portalErr) {
                    console.error('[checkout] Billing portal error:', portalErr.message);
                    return res.status(409).json({
                        error: `You already have an active subscription, but the Stripe billing portal isn't available: ${portalErr.message}. In test mode, enable it (and turn on plan switching) at Stripe → Settings → Billing → Customer portal.`,
                    });
                }
            }
        } catch (listErr) {
            console.error('[checkout] subscriptions.list error:', listErr.message);
            // Non-fatal — fall through and attempt to create the checkout session.
        }

        try {
            const session = await stripe.checkout.sessions.create({
                customer:    stripeCustomerId,
                mode:        'subscription',
                line_items:  [{ price: priceId, quantity: 1 }],
                metadata:    { app: 'acb', license_key, license_id: licenseId.toString(), plan: planKey, interval: billingInterval },
                subscription_data: {
                    metadata: { app: 'acb', license_key, license_id: licenseId.toString(), plan: planKey, interval: billingInterval },
                },
                success_url: `${returnBase}?page=ai-content-bridge&upgrade=success&plan=${planKey}`,
                cancel_url:  `${returnBase}?page=ai-content-bridge&upgrade=cancelled`,
            });

            console.log(`[checkout] Subscription session: ${session.id} | license=${license_key} | plan=${planKey} | interval=${billingInterval}`);
            return res.json({ success: true, checkout_url: session.url, session_id: session.id });

        } catch (err) {
            // Surface the real Stripe reason — almost always a price-ID config issue
            // (wrong ID, live/test mismatch, archived price, or a non-recurring price).
            console.error(`[checkout] Stripe subscription session error for plan "${planKey}" (price ${priceId}):`, err.message);
            return res.status(500).json({
                error: `Stripe could not start the ${planKey} subscription: ${err.message}`,
            });
        }
    }

    // ── Credit bundle checkout (one-time) ──────────────────────────────────────
    const successUrl = `${returnBase}?page=ai-content-bridge&credits=success&bundle=${bundle_id}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${returnBase}?page=ai-content-bridge&credits=cancelled`;

    // Create the Stripe Checkout session
    try {
        const session = await stripe.checkout.sessions.create({
            customer:             stripeCustomerId,
            payment_method_types: ['card'],
            mode:                 'payment',
            line_items: [{
                price_data: {
                    currency:     'usd',
                    product_data: {
                        name:        bundle.name,
                        description: bundle.description,
                        metadata:    { bundle_id, credits: bundle.credits.toString() },
                    },
                    unit_amount: bundle.price_cents,
                },
                quantity: 1,
            }],
            metadata: {
                app:         'acb',
                license_key,
                license_id:  licenseId.toString(),
                bundle_id,
                credits:     bundle.credits.toString(),
            },
            success_url: successUrl,
            cancel_url:  cancelUrl,
        });

        console.log(`[checkout] Session created: ${session.id} | license=${license_key} | bundle=${bundle_id} | credits=${bundle.credits}`);

        res.json({
            success:      true,
            checkout_url: session.url,
            session_id:   session.id,
        });

    } catch (err) {
        console.error('[checkout] Stripe session error:', err.message);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

module.exports = router;
module.exports.BUNDLES = BUNDLES;