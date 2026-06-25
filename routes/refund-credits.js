/**
 * POST /api/refund-credits
 *
 * Called by the WordPress plugin when a stuck entry is reset.
 * Adds credits back to the license key's most recently used batch,
 * or creates a fresh one-credit batch if no suitable batch exists.
 *
 * Protected by x-generate-secret header (same secret as /api/generate).
 */

const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');
const creditsCache = require('../lib/credits-cache');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

router.post('/', async (req, res) => {
    // Auth — same shared secret as generate endpoint
    const secret = process.env.GENERATE_SECRET;
    if (secret && req.headers['x-generate-secret'] !== secret) {
        return res.status(401).json({ success: false, error: 'Unauthorised' });
    }

    const { license_key, credits = 1, reason = 'reset_refund', entry_id } = req.body;

    if (!license_key) {
        return res.status(400).json({ success: false, error: 'license_key is required' });
    }

    const creditsToRefund = Math.max(1, Math.min(10, parseInt(credits) || 1));

    try {
        // Find the license key ID
        const licResult = await pool.query(
            `SELECT id FROM license_keys WHERE license_key = $1 AND status = 'active'`,
            [license_key]
        );

        if (licResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'License key not found or inactive' });
        }

        const licenseKeyId = licResult.rows[0].id;

        // Find the most recently used non-expired batch to refund into
        const batchResult = await pool.query(`
            SELECT id, credits_remaining, expiry_date
            FROM credit_batches
            WHERE license_key_id = $1
              AND expiry_date > CURRENT_DATE
            ORDER BY created_at DESC
            LIMIT 1
        `, [licenseKeyId]);

        let batchId;

        if (batchResult.rows.length > 0) {
            // Refund into the most recent active batch
            batchId = batchResult.rows[0].id;
            await pool.query(
                `UPDATE credit_batches SET credits_remaining = credits_remaining + $1 WHERE id = $2`,
                [creditsToRefund, batchId]
            );
            console.log(`[refund] +${creditsToRefund} credits to batch ${batchId} for key ...${license_key.slice(-6)} (${reason})`);
        } else {
            // No active batch — create a fresh one expiring in 1 year
            const insertResult = await pool.query(`
                INSERT INTO credit_batches (license_key_id, credits_remaining, expiry_date, notes)
                VALUES ($1, $2, CURRENT_DATE + INTERVAL '1 year', $3)
                RETURNING id
            `, [licenseKeyId, creditsToRefund, `refund:${reason}:entry_${entry_id || 'unknown'}`]);
            batchId = insertResult.rows[0].id;
            console.log(`[refund] Created new batch ${batchId} with ${creditsToRefund} credits for key ...${license_key.slice(-6)}`);
        }

        // Log the refund in usage_logs for audit trail
        await pool.query(`
            INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
            VALUES ($1, 'refund', $2, $3, 'refund', NOW())
        `, [licenseKeyId, reason, -creditsToRefund]);

        creditsCache.invalidate(license_key); // balance restored — next /credits poll reads fresh
        return res.json({
            success:          true,
            credits_refunded: creditsToRefund,
            batch_id:         batchId,
        });

    } catch (err) {
        console.error('[refund] Error:', err.message);
        return res.status(500).json({ success: false, error: 'Refund failed — credits not restored' });
    }
});

module.exports = router;
