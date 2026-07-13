/**
 * wp-endpoint.js — resolve + call AI Content Bridge plugin REST routes.
 *
 * Plugin 2.8.1 moved its REST namespace from `ai-content/v1` to the
 * prefix-compliant `aicobr/v1` (WP.org prefix guidelines). 2.8.1 registers
 * BOTH namespaces, but installs still running <= 2.8.0 only expose the
 * legacy one — so every server->plugin call tries the new namespace first
 * and transparently retries the legacy namespace on a 404 (WP returns 404
 * rest_no_route for an unknown namespace).
 *
 * AICOBR_NAMESPACE_FALLBACK_2026_07_13
 */

const PRIMARY_NS = 'aicobr/v1';
const LEGACY_NS  = 'ai-content/v1';

/**
 * fetch() a plugin REST route on `domain`, preferring the new namespace.
 *
 * @param {string} domain  bare domain, e.g. "example.com"
 * @param {string} route   route with leading slash, e.g. "/publish"
 * @param {object} options fetch options (method/headers/body)
 * @returns {Promise<Response>} the first non-404 response (or the legacy
 *                              404 if both namespaces are missing)
 */
async function wpFetch(domain, route, options) {
    const primary = await fetch(`https://${domain}/wp-json/${PRIMARY_NS}${route}`, options);
    if (primary.status !== 404) {
        return primary;
    }
    console.log(`[wp-endpoint] ${PRIMARY_NS}${route} 404 on ${domain} — retrying legacy ${LEGACY_NS} (pre-2.8.1 install)`);
    return fetch(`https://${domain}/wp-json/${LEGACY_NS}${route}`, options);
}

module.exports = { wpFetch };
