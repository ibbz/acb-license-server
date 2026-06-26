// test-resolve-interval.js
// Standalone unit test for plans.resolveBillingInterval — the §6.5 webhook
// hardening. Run: `node test-resolve-interval.js` (no env / DB required).
//
// Covers the real-world cases that drive the annual drip clock in
// handleSubscriptionUpdate. Exit code is non-zero if any assertion fails.

const { resolveBillingInterval } = require('./routes/plans');

let pass = 0, fail = 0;
function check(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label} -> ${got}`); }
  else { fail++; console.error(`  FAIL ${label} -> got ${got}, want ${want}`); }
}

const price = (interval, interval_count = 1) => ({ recurring: { interval, interval_count } });

console.log('resolveBillingInterval:');

// 1. Correctly-shaped true yearly price -> year (the current, fixed prices).
check('true yearly (year/1)',            resolveBillingInterval(price('year', 1),  'year'),  'year');

// 2. The misconfiguration that caused the original bug: "every 12 months".
//    Stripe reports interval='month'; interval_count-aware reading rescues it.
check('every-12-months (month/12)',      resolveBillingInterval(price('month', 12), 'year'), 'year');

// 3. True monthly price -> month.
check('true monthly (month/1)',          resolveBillingInterval(price('month', 1), 'month'),  'month');

// 4. Stale-metadata guard: a genuine monthly price whose metadata wrongly says
//    'year' (e.g. left over after a portal switch) must resolve to month — the
//    PRICE wins, not the stale metadata.
check('monthly price, stale year meta',  resolveBillingInterval(price('month', 1), 'year'),   'month');

// 5. Mirror: an annual price whose metadata wrongly says 'month' -> year.
check('yearly price, stale month meta',  resolveBillingInterval(price('year', 1),  'month'),  'year');

// 6. Defensive long-period equivalents.
check('weekly x52 (week/52)',            resolveBillingInterval(price('week', 52),  null),     'year');
check('daily x365 (day/365)',            resolveBillingInterval(price('day', 365),  null),     'year');
check('weekly x4 (week/4)',              resolveBillingInterval(price('week', 4),   null),     'month');

// 7. Fallback path: no usable price recurring data -> trust the metadata.
check('no recurring, meta year',         resolveBillingInterval({}, 'year'),                  'year');
check('no recurring, meta month',        resolveBillingInterval({}, 'month'),                 'month');
check('no recurring, no meta',           resolveBillingInterval(null, undefined),             'month');

// 8. interval_count missing/zero defaults to 1 (treated as monthly).
check('month, missing count',            resolveBillingInterval({ recurring: { interval: 'month' } }, null), 'month');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
