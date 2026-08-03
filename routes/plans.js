// routes/plans.js
// Single source of truth for subscription plan pricing and tier resolution.
//
// Previously the price->tier map lived inline in stripe-webhook.js and the
// plan->price map was duplicated in create-checkout-session.js and
// portal-stripe.js. Annual billing made that duplication dangerous: an annual
// price ID missing from the webhook's map silently downgrades the subscriber to
// 'free'. Everything now resolves through this one module.

// Monthly + annual Stripe price IDs, from Railway env.
// Annual prices are the "$X/mo billed annually" figures advertised on pricing.html:
//   Starter $180/yr, Pro $468/yr, Agency $1428/yr.
const PLAN_PRICE_IDS = {
  starter: {
    month: process.env.STRIPE_STARTER_PRICE_ID,
    year:  process.env.STRIPE_STARTER_ANNUAL_PRICE_ID,
  },
  pro: {
    month: process.env.STRIPE_PRO_PRICE_ID,
    year:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  },
  agency: {
    month: process.env.STRIPE_AGENCY_PRICE_ID,
    year:  process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID,
  },
};

// Monthly credit allowance per paid tier (identical for monthly and annual —
// annual is a billing-frequency discount, not a credit difference).
// AICOBR_TRIAL_REVERT_2026_08: allowances returned to original values. The
// Model A raise (45/130/420) existed to stop one-time bundles dominating
// subscriptions on per-credit price; the Agency-trial system now solves that
// structurally (post-trial free = Blog Post only, so bundles can't substitute
// for a subscription's type access). Bundle prices stay at their raised
// levels ($9/$22/$52) as the never-expire premium.
const CREDIT_ALLOWANCE = { starter: 30, pro: 100, agency: 300 };

const TIER_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };

function normaliseInterval(interval) {
  const i = String(interval || 'month').toLowerCase();
  if (i === 'year' || i === 'annual' || i === 'yearly' || i === 'annually') return 'year';
  return 'month';
}

// Resolve the effective billing interval ('month' | 'year') for a subscription,
// robustly, from the live Stripe price — with the checkout-stamped metadata as a
// fallback only. This exists because two real-world quirks can each mis-set the
// annual drip clock:
//
//   1. A price built as "every 12 months" (recurring.interval='month',
//      interval_count=12) is functionally annual but reports interval='month'.
//      Reading interval ALONE (the old `priceObj.recurring.interval`) would treat
//      such a sub as monthly and clobber annual_term_end / next_credit_grant_at to
//      NULL — month 1 grants, then it never drips. Reading interval_count-aware
//      fixes that without depending on every price being shaped perfectly.
//
//   2. subscription.metadata.interval is stamped correctly at ACB checkout, but it
//      can go STALE after a portal-initiated interval switch (the price changes,
//      the old metadata does not). So the live price is the source of truth for
//      what the customer actually pays; metadata is only the fallback for when the
//      price object carries no usable recurring data.
//
// Returns 'month' or 'year'. Pure (no env / DB), so it is unit-testable in isolation.
function resolveBillingInterval(priceObj, metadataInterval) {
  const rec = priceObj && priceObj.recurring;
  if (rec && rec.interval) {
    const base  = String(rec.interval).toLowerCase();
    const count = Number(rec.interval_count) || 1;
    if (base === 'year') return 'year';
    if (base === 'month' && count >= 12)  return 'year'; // "every 12 months" == annual
    if (base === 'week'  && count >= 52)  return 'year';
    if (base === 'day'   && count >= 365) return 'year';
    return 'month';
  }
  // No usable price recurring data — fall back to the checkout-stamped metadata.
  return normaliseInterval(metadataInterval);
}

// Resolve a Stripe price ID for a plan + interval. Returns null if not configured.
function getPlanPriceId(plan, interval) {
  const tier = String(plan || '').toLowerCase();
  const ints = PLAN_PRICE_IDS[tier];
  if (!ints) return null;
  return ints[normaliseInterval(interval)] || null;
}

// Reverse lookup: given any configured price ID (monthly OR annual), return its
// tier. Unknown / unconfigured IDs return 'free'. This is the function the
// webhook uses so annual subscriptions can never silently map to free.
function tierFromPriceId(priceId) {
  if (!priceId) return 'free';
  for (const [tier, ints] of Object.entries(PLAN_PRICE_IDS)) {
    if (ints.month === priceId || ints.year === priceId) return tier;
  }
  return 'free';
}

// posts_limit kept consistent with the rest of the codebase.
function postsLimitForTier(tier) {
  return tier === 'starter' ? 50 : (tier === 'pro' || tier === 'agency') ? -1 : 5;
}

module.exports = {
  PLAN_PRICE_IDS,
  CREDIT_ALLOWANCE,
  TIER_RANK,
  normaliseInterval,
  resolveBillingInterval,
  getPlanPriceId,
  tierFromPriceId,
  postsLimitForTier,
};
