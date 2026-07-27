/**
 * lib/conversion-tag.js — server-rendered analytics/conversion snippets.
 *
 * AICOBR_CONV_TAG_2026_07_27
 *
 * The genuine conversion in this funnel is EMAIL VERIFICATION, not registration.
 * Registration (POST /register-free) only creates an unverified row and sends an
 * email — a bot, a typo or an abandoned form all reach it. /verify-email success
 * is a real person, a real inbox and an activated 5-credit licence. That is the
 * event Google Ads should optimise toward, so the tag is rendered into the
 * verify-email success page and nowhere else.
 *
 * All IDs come from the environment — nothing is hard-coded, so the same build
 * runs in staging (no IDs set → no tags emitted) and production.
 *
 *   GOOGLE_ADS_CONVERSION_ID     e.g. AW-123456789     (required to emit the gtag loader)
 *   GOOGLE_ADS_CONVERSION_LABEL  e.g. AbC-D_efG…        (the specific conversion action)
 *   GA4_MEASUREMENT_ID           e.g. G-XXXXXXXXXX      (optional; adds GA4 alongside)
 *
 * If GOOGLE_ADS_CONVERSION_ID is unset, headTag()/eventTag() return '' and the
 * page is byte-for-byte what it was before — safe to deploy before the IDs exist.
 *
 * Values are validated against strict patterns before use: these strings are
 * interpolated into an inline <script>, so anything unexpected in the env is
 * dropped rather than reflected into the page.
 */

'use strict';

const ADS_ID    = (process.env.GOOGLE_ADS_CONVERSION_ID    || '').trim();
const ADS_LABEL = (process.env.GOOGLE_ADS_CONVERSION_LABEL || '').trim();
const GA4_ID    = (process.env.GA4_MEASUREMENT_ID          || '').trim();

// Google identifiers use a fixed, restricted alphabet. Reject anything else so
// a malformed env var can never inject markup into the inline script below.
const RE_ADS_ID    = /^AW-[0-9]{6,15}$/;
const RE_ADS_LABEL = /^[A-Za-z0-9_-]{6,60}$/;
const RE_GA4_ID    = /^G-[A-Z0-9]{6,15}$/;

const adsIdOk    = RE_ADS_ID.test(ADS_ID);
const adsLabelOk = RE_ADS_LABEL.test(ADS_LABEL);
const ga4Ok      = RE_GA4_ID.test(GA4_ID);

if (ADS_ID && !adsIdOk) {
    console.warn(`[conversion-tag] GOOGLE_ADS_CONVERSION_ID "${ADS_ID}" is malformed — Ads tag disabled`);
}
if (ADS_LABEL && !adsLabelOk) {
    console.warn('[conversion-tag] GOOGLE_ADS_CONVERSION_LABEL is malformed — conversion event disabled');
}
if (GA4_ID && !ga4Ok) {
    console.warn(`[conversion-tag] GA4_MEASUREMENT_ID "${GA4_ID}" is malformed — GA4 disabled`);
}

// Whether we emit anything at all. Ads ID is the anchor; GA4 alone can also load.
const enabled = adsIdOk || ga4Ok;

/**
 * <head> loader — the gtag.js library plus config for whichever IDs are valid.
 * Insert once, high in <head>. Returns '' when nothing is configured.
 */
function headTag() {
    if (!enabled) return '';
    const loaderId = adsIdOk ? ADS_ID : GA4_ID;   // either can host the library
    const configs = [];
    if (adsIdOk) configs.push(`gtag('config','${ADS_ID}');`);
    if (ga4Ok)   configs.push(`gtag('config','${GA4_ID}');`);
    return `
  <!-- Google tag (gtag.js) — analytics/conversion, IDs from server env -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${loaderId}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    ${configs.join('\n    ')}
  </script>`;
}

/**
 * The conversion event itself. Render ONLY on a genuine first-time activation —
 * never on the "already verified" revisit, or the same person refreshing the
 * page would log a second conversion and inflate the number Ads optimises on.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.value]     optional monetary value for value-based bidding
 * @param {string}  [opts.currency]  ISO code, default GBP
 * @param {string}  [opts.txnId]     de-dupe id (e.g. the licence key id) so a
 *                                   refresh reusing the same id isn't recounted
 */
function eventTag(opts = {}) {
    if (!enabled) return '';
    const parts = [];

    if (adsIdOk && adsLabelOk) {
        const fields = [`'send_to': '${ADS_ID}/${ADS_LABEL}'`];
        if (typeof opts.value === 'number' && isFinite(opts.value) && opts.value >= 0) {
            fields.push(`'value': ${opts.value}`);
            fields.push(`'currency': '${(opts.currency || 'GBP').replace(/[^A-Z]/g, '') || 'GBP'}'`);
        }
        if (opts.txnId) {
            // Only digits/letters/dash survive — it lands in an inline script.
            const safe = String(opts.txnId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
            if (safe) fields.push(`'transaction_id': '${safe}'`);
        }
        parts.push(`gtag('event', 'conversion', {${fields.join(', ')}});`);
    }

    if (ga4Ok) {
        // A GA4 custom event so the activation is visible there too.
        parts.push(`gtag('event', 'free_license_activated');`);
    }

    if (!parts.length) return '';   // Ads ID present but label missing, no GA4
    return `
  <!-- Conversion: free licence activated (first-time verification only) -->
  <script>
    ${parts.join('\n    ')}
  </script>`;
}

module.exports = { headTag, eventTag, enabled };
