/**
 * lib/admin-audit.js
 *
 * Best-effort persistent audit trail for admin actions (admin_audit_log table,
 * see add-admin-audit-log.sql). Every admin mutation calls logAdminAction() at
 * its success point.
 *
 * CONTRACT: this NEVER throws and NEVER fails the action it records. An audit
 * write that errors is logged to the console and swallowed — losing an audit row
 * must not roll back a tier change, a refund, or a domain transfer.
 */

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * @param {object} entry
 * @param {string} entry.action        e.g. 'change_tier'
 * @param {string} [entry.license_key]
 * @param {string} [entry.actor]       who did it (from x-admin-actor header, else 'admin')
 * @param {string} [entry.reason]
 * @param {object} [entry.details]     structured before/after / amounts
 */
async function logAdminAction({ action, license_key = null, actor = 'admin', reason = null, details = null }) {
    try {
        await pool.query(
            `INSERT INTO admin_audit_log (action, license_key, actor, reason, details)
             VALUES ($1, $2, $3, $4, $5)`,
            [action, license_key, actor || 'admin', reason || null, details ? JSON.stringify(details) : null]
        );
    } catch (err) {
        console.error('[admin-audit] write failed (action still applied):', err.message);
    }
}

/** Convenience: pull the actor name from a request header (optional). */
function actorFrom(req) {
    return (req && req.headers && req.headers['x-admin-actor']) || 'admin';
}

module.exports = { logAdminAction, actorFrom };