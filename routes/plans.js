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
const CREDIT_ALLOWANCE = { starter: 30, pro: 100, agency: 300 };

const TIER_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };

function normaliseInterval(interval) {
  const i = String(interval || 'month').toLowerCase();
  if (i === 'year' || i === 'annual' || i === 'yearly' || i === 'annually') return 'year';
  return 'month';
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
  getPlanPriceId,
  tierFromPriceId,
  postsLimitForTier,
};
