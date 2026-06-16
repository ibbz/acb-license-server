/**
 * POST /api/buy-credits
 *
 * Adds a credit bundle to a license as a never-expiring credit_batch.
 * Called internally by the Stripe webhook after payment is confirmed.
 * Bundle credits never expire (expiry_date set to 2099-12-31).
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

router.post('/', async (req, res) => {
    const { license_key, credits, bundle_name, bundle_id, amount_paid_cents, stripe_session_id } = req.body;

    if (!license_key || !credits || credits <= 0) {
        return res.status(400).json({ error: 'license_key and credits (> 0) are required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const licResult = await client.query(
            `SELECT id, tier FROM license_keys WHERE license_key = $1 AND status = 'active'`,
            [license_key]
        );

        if (licResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'License not found or inactive' });
        }

        const licenseId = licResult.rows[0].id;

        // Prevent duplicate processing
        if (stripe_session_id) {
            const dupCheck = await client.query(
                `SELECT id FROM credit_batches WHERE license_key_id = $1 AND notes = $2`,
                [licenseId, `stripe_session:${stripe_session_id}`]
            );
            if (dupCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                console.log(`[buy-credits] Duplicate session ignored: ${stripe_session_id}`);
                return res.json({ success: true, message: 'Already processed', duplicate: true });
            }
        }

        // Insert never-expiring credit batch (2099-12-31 = effectively never)
        // Uses 'credits_issued' to match existing DB schema
        const batchResult = await client.query(
            `INSERT INTO credit_batches (license_key_id, credits_issued, credits_remaining, issued_date, expiry_date, notes)
             VALUES ($1, $2, $2, CURRENT_DATE, '2099-12-31', $3)
             RETURNING id`,
            [licenseId, parseInt(credits), stripe_session_id ? `stripe_session:${stripe_session_id}` : `bundle:${bundle_id || 'unknown'}`]
        );

        const batchId = batchResult.rows[0].id;

        await client.query(
            `INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, created_at)
             VALUES ($1, 'credit_purchase', $2, 0, NOW())`,
            [licenseId, `Purchased ${credits} credits - ${bundle_name || bundle_id || 'Bundle'} ($${((amount_paid_cents||0)/100).toFixed(2)})`]
        );

        await client.query('COMMIT');

        const balanceResult = await client.query(
            `SELECT COALESCE(SUM(credits_remaining), 0) AS total FROM credit_batches WHERE license_key_id = $1 AND expiry_date > CURRENT_DATE`,
            [licenseId]
        );

        const totalRemaining = parseInt(balanceResult.rows[0].total);
        console.log(`[buy-credits] OK - license=${license_key}, added=${credits}, batch=${batchId}, total=${totalRemaining}`);

        res.json({ success: true, credits_added: parseInt(credits), credits_remaining: totalRemaining, batch_id: batchId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[buy-credits] Error:', err.message);
        res.status(500).json({ error: 'Failed to add credits' });
    } finally {
        client.release();
    }
});

module.exports = router;