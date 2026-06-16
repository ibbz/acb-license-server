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

router.post('/', async (req, res) => {
    const { license_key, bundle_id, success_url, cancel_url } = req.body;

    if (!license_key || !bundle_id) {
        return res.status(400).json({ error: 'license_key and bundle_id are required' });
    }

    const bundle = BUNDLES[bundle_id];
    if (!bundle) {
        return res.status(400).json({ error: `Unknown bundle: ${bundle_id}. Valid options: ${Object.keys(BUNDLES).join(', ')}` });
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