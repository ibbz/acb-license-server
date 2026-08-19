/**
 * require-generate-secret — one fail-CLOSED gate for the shared-secret routes.
 *
 * AICOBR_FAILCLOSED_SECRET_2026_08
 *
 * Every credit-spending / content route (generate, outline, extract-style,
 * image-suggestions, regenerate-image, refund-credits, strategist) used to gate
 * itself with:
 *
 *     const secret = process.env.GENERATE_SECRET;
 *     if (secret && req.headers['x-generate-secret'] !== secret) { 401 }
 *
 * That is fail-OPEN: if GENERATE_SECRET is unset or empty, the `secret &&` short
 * circuits, the check is skipped entirely, and the route accepts anyone. The
 * plugin side is the opposite — verify_secret() uses hash_equals and rejects an
 * empty secret — so the two halves disagreed about what "no secret" means.
 *
 * The original instinct was availability: degrade to no-auth rather than break
 * every request if the env var goes missing. Wrong trade for a route that spends
 * money against Anthropic/OpenAI. This gate fails CLOSED instead:
 *
 *   - secret configured + header matches   -> allowed
 *   - secret configured + header wrong/missing -> 401
 *   - secret NOT configured on the server   -> 503, and a loud server log,
 *     because a money-spending route with no secret is a misconfiguration to fix,
 *     not a door to leave open. 503 (not 401) tells the operator "the server is
 *     mis-set up", distinct from a caller sending the wrong header.
 *
 * Comparison is constant-time (crypto.timingSafeEqual) to match the plugin's
 * hash_equals and avoid leaking the secret a byte at a time via timing.
 */

const crypto = require('crypto');

/** Constant-time string compare that tolerates unequal lengths without throwing. */
function safeEqual(a, b) {
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ab.length !== bb.length) return false;      // length is not secret here
    return crypto.timingSafeEqual(ab, bb);
}

/**
 * Returns true if the request is authorised. When it returns false it has ALREADY
 * sent the response, so callers just `return`.
 *
 *   if (!requireGenerateSecret(req, res)) return;
 */
function requireGenerateSecret(req, res) {
    const secret = process.env.GENERATE_SECRET;

    if (!secret) {
        // Misconfigured server, not a bad caller. Refuse and make it visible.
        console.error(
            '[secret] GENERATE_SECRET is not set — refusing shared-secret route. ' +
            'Set GENERATE_SECRET in the environment; the plugin receives it on ' +
            'register/verify and sends it back as x-generate-secret.'
        );
        res.status(503).json({ success: false, error: 'Server not configured.' });
        return false;
    }

    const incoming = req.headers['x-generate-secret'] || '';
    if (!safeEqual(incoming, secret)) {
        res.status(401).json({ success: false, error: 'Unauthorised' });
        return false;
    }

    return true;
}

module.exports = { requireGenerateSecret, safeEqual };
