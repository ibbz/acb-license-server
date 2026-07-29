/**
 * lib/email-canonical.js — address canonicalisation for abuse checks.
 *
 * AICOBR_CANONICAL_EMAIL_2026_07_29
 *
 * The free tier is "one licence per email, ever", each worth 5 credits of real
 * Anthropic/OpenAI spend. Enforcing that on the raw string is not enforcement:
 *   ibbz+1@hotmail.com / ibbz+2@hotmail.com  → same inbox, unlimited licences
 *   i.b.b.z@gmail.com  / ibbz@gmail.com      → same inbox, different string
 *
 * canonicalEmail() collapses those to one identity for the *check*. The real
 * address is still what we store and send to, so a user who legitimately files
 * mail with +tags keeps receiving their verification email at the tagged
 * address — they simply can't mint a second free licence with it.
 *
 * Rules, deliberately conservative:
 *   - lowercase + trim (addresses are case-insensitive in practice)
 *   - strip +tag from the local part — universal across Gmail, Outlook/Hotmail,
 *     Fastmail, Proton, iCloud and most business mail
 *   - strip dots from the local part for Gmail/Googlemail ONLY, because it is
 *     the notable provider where dots are insignificant. Applying that rule
 *     globally would be wrong and would wrongly merge distinct users
 *     (firstname.lastname@company.com is a different person from
 *     firstnamelastname@company.com).
 *   - normalise googlemail.com → gmail.com (same mailbox, legacy domain)
 *
 * Anything unparseable is returned lowercased-and-trimmed rather than throwing:
 * a malformed address should fail validation upstream, never crash the check.
 */

'use strict';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function canonicalEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return email;   // not parseable — caller validates

  let local  = email.slice(0, at);
  const host = email.slice(at + 1);

  // +tag is a sub-address on every provider that supports it.
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(host)) {
    local = local.replace(/\./g, '');
    return `${local}@gmail.com`;
  }

  return `${local}@${host}`;
}

/**
 * Addresses exempted from the one-licence-per-email rule, for pre-launch and
 * regression testing. Set ACB_TEST_EMAILS on Railway as a comma-separated list:
 *
 *   ACB_TEST_EMAILS=ibbz@hotmail.com,qa@aicontentbridge.com
 *
 * Matching is on the CANONICAL form, so listing ibbz@hotmail.com also exempts
 * ibbz+anything@hotmail.com — one entry covers every alias of a tester's inbox
 * and removes any need to hand-edit production rows between test runs.
 *
 * Unset (the default, and the correct production value) → empty set → no
 * exemptions, so this can never silently weaken live abuse protection.
 */
const TEST_EMAILS = new Set(
  (process.env.ACB_TEST_EMAILS || '')
    .split(',')
    .map(e => canonicalEmail(e))
    .filter(Boolean)
);

function isTestEmail(raw) {
  if (TEST_EMAILS.size === 0) return false;
  return TEST_EMAILS.has(canonicalEmail(raw));
}

module.exports = { canonicalEmail, isTestEmail, TEST_EMAILS };
