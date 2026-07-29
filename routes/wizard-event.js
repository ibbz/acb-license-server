/**
 * POST /api/wizard-event   { event: 'opened', domain: 'example.com' }
 *
 * AICOBR_WIZARD_TELEMETRY_2026_07_29
 *
 * Minimal funnel instrumentation for the onboarding wizard. Before this
 * existed, a user who opened the wizard and left was indistinguishable from a
 * user who never saw it — 313 downloads vs 1 registration with no way to tell
 * which step lost them. This logs a single structured line per event so
 * Railway logs answer "wizard opens vs registrations" with a text search:
 *
 *   grep '\[wizard-event\] opened'  → opens
 *   grep '\[register-free\] Verification email sent' → registrations
 *
 * Deliberately log-only: no schema change, no PII beyond the site domain the
 * plugin already sends on registration, nothing stored if logs rotate.
 * Fire-and-forget from the plugin; always answers 202 quickly.
 */

const express = require('express');
const router  = express.Router();

const KNOWN_EVENTS = new Set(['opened', 'minimised', 'reopened', 'inbox_reached', 'completed']);

router.post('/', (req, res) => {
  const event  = String(req.body?.event  || '').slice(0, 32);
  const domain = String(req.body?.domain || '').slice(0, 190).replace(/[^\w.-]/g, '');

  if (KNOWN_EVENTS.has(event)) {
    console.log(`[wizard-event] ${event} domain=${domain || 'unknown'}`);
  }
  // Unknown events are dropped silently — this endpoint must never be a
  // log-injection or noise vector.
  return res.status(202).json({ ok: true });
});

module.exports = router;
