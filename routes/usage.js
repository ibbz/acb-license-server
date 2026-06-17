import '../index.css';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

const T = {
    blue:        '#1B6EF3',
    blueDark:    '#1458CC',
    tealLight:   '#EFF6FF',
    blueBorder:  '#BFDBFE',
    slate900:    '#06101E',
    slate800:    '#0C1A2E',
    slate700:    '#122038',
    slate600:    '#1E3A5F',
    slate500:    '#4A7BA7',
    slate400:    '#7BA3C4',
    slate200:    '#D6E4F0',
    slate100:    '#EBF2F9',
    slate50:     '#F4F8FC',
    white:       '#ffffff',
    greenLight:  '#ecfdf5',
    greenBorder: '#6ee7b7',
    redLight:    '#fef2f2',
    redBorder:   '#fca5a5',
    radius:      '12px',
    radiusSm:    '8px',
    shadow:      '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.07)',
    shadowMd:    '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)',
    font:        '"DM Sans", system-ui, -apple-system, sans-serif',
};


// -- Upgrade plans UI ------------------------------------------

const PLANS = [
    {
        id: 'starter',
        name: 'Starter',
        price: '$19',
        period: '/month',
        credits: '30 credits/mo',
        colour: '#3b82f6',
        colourLight: '#eff6ff',
        colourBorder: '#93c5fd',
        usps: [
            '30 credits every month',
            '7 content types unlocked',
            'Tutorial, FAQ & Recipe pages',
            'WooCommerce product descriptions',
            'Service page & About Us pages',
            'YouTube video embedding',
            'SEO meta for Yoast & Rank Math',
        ],
    },
    {
        id: 'pro',
        name: 'Pro',
        price: '$49',
        period: '/month',
        credits: '100 credits/mo',
        colour: '#1B6EF3',
        colourLight: '#EFF6FF',
        colourBorder: '#BFDBFE',
        popular: true,
        usps: [
            '100 credits every month',
            '15 content types unlocked',
            'Writing Style Profiles',
            'Famous Writer templates',
            'ACF custom field targeting',
            'Vehicle & job listings',
            'Press releases & landing pages',
        ],
    },
    {
        id: 'agency',
        name: 'Agency',
        price: '$149',
        period: '/month',
        credits: '300 credits/mo',
        colour: '#8b5cf6',
        colourLight: '#f5f3ff',
        colourBorder: '#c4b5fd',
        usps: [
            '300 credits every month',
            'All 20 content types',
            'Full L&D suite — 9 types',
            'Course overviews & SOPs',
            'Quiz & assessment builder',
            'Workshop facilitation guides',
            'Email course / drip sequences',
        ],
    },
];

const TIER_ORDER = { free: 0, starter: 1, pro: 2, agency: 3 };

const UpgradePlans = ({ currentPlan }) => {
    const [upgrading, setUpgrading] = useState(null);
    const [notice, setNotice]       = useState(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('upgrade') === 'success') {
            setNotice({ type: 'success', text: 'Subscription started! Your new plan and monthly credits will appear shortly.' });
            window.history.replaceState({}, '', window.location.pathname + '?page=ai-content-bridge');
        } else if (params.get('upgrade') === 'cancelled') {
            setNotice({ type: 'info', text: 'Upgrade cancelled. No charge was made.' });
            window.history.replaceState({}, '', window.location.pathname + '?page=ai-content-bridge');
        }
    }, []);

    const handleUpgrade = async (planId) => {
        setUpgrading(planId);
        setNotice(null);
        try {
            const result = await apiFetch({
                path:   '/ai-content/v1/create-checkout',
                method: 'POST',
                data:   { plan: planId },
            });
            if (result?.checkout_url) {
                window.location.href = result.checkout_url;
            } else {
                setNotice({ type: 'error', text: 'Could not start checkout. Please try again.' });
                setUpgrading(null);
            }
        } catch (err) {
            setNotice({ type: 'error', text: err?.message || 'Checkout failed. Please try again.' });
            setUpgrading(null);
        }
    };

    const normalisedPlan = (() => {
        const s = (currentPlan || 'free').toLowerCase();
        if (s.includes('agency'))  return 'agency';
        if (s.includes('pro'))     return 'pro';
        if (s.includes('starter')) return 'starter';
        return 'free';
    })();

    const visiblePlans = PLANS.filter(p => TIER_ORDER[p.id] > TIER_ORDER[normalisedPlan]);
    if (visiblePlans.length === 0) return null;

    return (
        <div style={{ marginBottom: '28px' }}>
            {/* Section header */}
            <div style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: T.slate900, fontFamily: T.font }}>
                    Upgrade Your Plan
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: T.slate500, fontFamily: T.font }}>
                    Unlock more content types, credits, and features. Cancel anytime.
                </p>
            </div>

            {notice && (
                <div style={{
                    marginBottom: '16px', padding: '11px 14px', borderRadius: T.radiusSm,
                    fontSize: '13px', fontFamily: T.font, fontWeight: 600,
                    background: notice.type === 'success' ? T.greenLight : notice.type === 'error' ? T.redLight : T.tealLight,
                    border: `1px solid ${notice.type === 'success' ? T.greenBorder : notice.type === 'error' ? T.redBorder : T.blueBorder}`,
                    color: notice.type === 'success' ? '#047857' : notice.type === 'error' ? '#b91c1c' : T.blueDark,
                }}>
                    {notice.text}
                </div>
            )}

            {/* Plan cards */}
            <div
                className="acb-upgrade-grid"
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${visiblePlans.length}, 1fr)`,
                    gap: '16px',
                }}
            >
                {visiblePlans.map(plan => (
                    <div
                        key={plan.id}
                        style={{
                            background: T.white,
                            borderRadius: T.radius,
                            border: `${plan.popular ? '2px' : '1px'} solid ${plan.popular ? plan.colour : T.slate200}`,
                            padding: '24px',
                            boxShadow: plan.popular ? `0 0 0 4px ${plan.colour}22` : T.shadow,
                            position: 'relative',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        {/* Popular badge */}
                        {plan.popular && (
                            <div style={{
                                position: 'absolute', top: '-13px', left: '50%',
                                transform: 'translateX(-50%)',
                                background: plan.colour, color: T.white,
                                fontSize: '11px', fontWeight: 700,
                                padding: '3px 14px', borderRadius: '9999px',
                                whiteSpace: 'nowrap', fontFamily: T.font,
                            }}>
                                MOST POPULAR
                            </div>
                        )}

                        {/* Plan name + price */}
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{
                                fontSize: '13px', fontWeight: 700,
                                color: plan.colour, fontFamily: T.font,
                                textTransform: 'uppercase', letterSpacing: '0.06em',
                                marginBottom: '4px',
                            }}>
                                {plan.name}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px', marginBottom: '2px' }}>
                                <span style={{ fontSize: '36px', fontWeight: 800, color: T.slate900, lineHeight: 1, fontFamily: T.font }}>{plan.price}</span>
                                <span style={{ fontSize: '14px', color: T.slate400, fontFamily: T.font }}>{plan.period}</span>
                            </div>
                            <div style={{
                                display: 'inline-block', padding: '3px 10px',
                                borderRadius: '9999px',
                                background: plan.colourLight,
                                border: `1px solid ${plan.colourBorder}`,
                                fontSize: '12px', fontWeight: 700,
                                color: plan.colour, fontFamily: T.font,
                            }}>
                                {plan.credits}
                            </div>
                        </div>

                        {/* USPs */}
                        <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', flex: 1 }}>
                            {plan.usps.map((usp, i) => (
                                <li key={i} style={{
                                    display: 'flex', alignItems: 'flex-start',
                                    gap: '8px', marginBottom: '8px',
                                    fontSize: '13px', color: T.slate700,
                                    fontFamily: T.font,
                                }}>
                                    <span
                                        className="dashicons dashicons-yes-alt"
                                        style={{ color: plan.colour, fontSize: '16px', flexShrink: 0, marginTop: '1px' }}
                                    />
                                    {usp}
                                </li>
                            ))}
                        </ul>

                        {/* CTA button */}
                        <button
                            onClick={() => handleUpgrade(plan.id)}
                            disabled={!!upgrading}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                gap: '6px', width: '100%', padding: '11px',
                                borderRadius: T.radiusSm,
                                background: plan.popular ? plan.colour : 'transparent',
                                color: plan.popular ? T.white : plan.colour,
                                border: `2px solid ${plan.colour}`,
                                fontFamily: T.font, fontWeight: 700, fontSize: '14px',
                                cursor: upgrading ? 'wait' : 'pointer', textDecoration: 'none',
                                transition: 'all 0.15s ease',
                                boxSizing: 'border-box',
                                opacity: upgrading && upgrading !== plan.id ? 0.5 : 1,
                            }}
                        >
                            {upgrading === plan.id ? (
                                'Redirecting…'
                            ) : (
                                <>
                                    <span className="dashicons dashicons-arrow-up-alt" style={{ fontSize: '16px' }} />
                                    Upgrade to {plan.name}
                                </>
                            )}
                        </button>
                    </div>
                ))}
            </div>
            <p style={{ marginTop: '12px', fontSize: '12px', color: T.slate400, fontFamily: T.font, textAlign: 'center' }}>
                Secure payment via Stripe. Your plan activates instantly. Cancel anytime from your account.
            </p>
        </div>
    );
};

// -- Credit bundle purchase UI ---------------------------------
const BUNDLES = [
    { id: 'starter', name: 'Starter Pack', credits: 20,  price: '$9',  priceNote: 'One-time', popular: false, colour: '#3b82f6' },
    { id: 'popular', name: 'Popular Pack', credits: 50,  price: '$19', priceNote: 'One-time', popular: true,  colour: '#1B6EF3' },
    { id: 'power',   name: 'Power Pack',   credits: 120, price: '$39', priceNote: 'One-time', popular: false, colour: '#8b5cf6' },
];

const CreditBundles = () => {
    const [purchasing, setPurchasing] = useState(null);
    const [notice, setNotice]         = useState(null);

    // Check for Stripe return params on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('credits') === 'success') {
            setNotice({ type: 'success', text: 'Payment successful! Your credits have been added and will appear shortly.' });
            // Clean URL without reloading
            window.history.replaceState({}, '', window.location.pathname + '?page=ai-content-bridge');
        } else if (params.get('credits') === 'cancelled') {
            setNotice({ type: 'info', text: 'Purchase cancelled. No charge was made.' });
            window.history.replaceState({}, '', window.location.pathname + '?page=ai-content-bridge');
        }
    }, []);

    const handlePurchase = async (bundleId) => {
        setPurchasing(bundleId);
        setNotice(null);
        try {
            const result = await apiFetch({
                path:   '/ai-content/v1/create-checkout',
                method: 'POST',
                data:   { bundle_id: bundleId },
            });
            if (result?.checkout_url) {
                window.location.href = result.checkout_url;
            } else {
                setNotice({ type: 'error', text: 'Could not start checkout. Please try again.' });
                setPurchasing(null);
            }
        } catch (err) {
            const msg = err?.message || 'Checkout failed. Please try again.';
            setNotice({ type: 'error', text: msg });
            setPurchasing(null);
        }
    };

    const T2 = {
        teal: '#1B6EF3', tealLight: '#EFF6FF', blueBorder: '#BFDBFE', tealDark: '#1458CC',
        slate900: '#06101E', slate700: '#122038', slate500: '#4A7BA7', slate400: '#7BA3C4',
        slate200: '#D6E4F0', slate100: '#EBF2F9', white: '#ffffff',
        green: '#10b981', greenLight: '#ecfdf5', greenBorder: '#6ee7b7',
        red: '#ef4444', redLight: '#fef2f2', redBorder: '#fca5a5',
        radius: '12px', radiusSm: '8px', shadow: '0 1px 3px 0 rgb(0 0 0 / 0.07)',
        font: '"DM Sans", system-ui, -apple-system, sans-serif',
    };

    return (
        <div style={{ marginTop: '28px' }}>
            {/* Section header */}
            <div style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: T2.slate900, fontFamily: T2.font }}>Buy Credit Bundles</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: T2.slate500, fontFamily: T2.font }}>
                    One-time purchases that never expire -- use them whenever you need them.
                </p>
            </div>

            {/* Notice */}
            {notice && (
                <div style={{
                    padding: '12px 16px', borderRadius: T2.radiusSm, marginBottom: '16px',
                    background: notice.type === 'success' ? T2.greenLight : notice.type === 'error' ? T2.redLight : T2.tealLight,
                    color: notice.type === 'success' ? T2.tealDark : notice.type === 'error' ? '#991b1b' : T2.tealDark,
                    border: `1px solid ${notice.type === 'success' ? T2.greenBorder : notice.type === 'error' ? T2.redBorder : T2.tealBorder}`,
                    fontSize: '14px', fontFamily: T2.font, display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                    <span className={`dashicons ${notice.type === 'success' ? 'dashicons-yes-alt' : notice.type === 'error' ? 'dashicons-warning' : 'dashicons-info'}`} style={{ fontSize: '18px' }}></span>
                    {notice.text}
                    <button onClick={() => setNotice(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', opacity: 0.5, lineHeight: 1 }}>x</button>
                </div>
            )}

            {/* Bundle cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {BUNDLES.map(bundle => (
                    <div key={bundle.id} style={{
                        background: T2.white, borderRadius: T2.radius,
                        border: `${bundle.popular ? '2px' : '1px'} solid ${bundle.popular ? bundle.colour : T2.slate200}`,
                        padding: '24px', boxShadow: bundle.popular ? `0 0 0 4px ${bundle.colour}22` : T2.shadow,
                        position: 'relative', transition: 'box-shadow 0.15s ease',
                    }}>
                        {bundle.popular && (
                            <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: bundle.colour, color: T2.white, fontSize: '11px', fontWeight: 700, padding: '3px 12px', borderRadius: '9999px', whiteSpace: 'nowrap', fontFamily: T2.font }}>
                                MOST POPULAR
                            </div>
                        )}
                        <div style={{ fontSize: '15px', fontWeight: 700, color: T2.slate900, marginBottom: '4px', fontFamily: T2.font }}>{bundle.name}</div>
                        <div style={{ fontSize: '36px', fontWeight: 800, color: bundle.colour, lineHeight: 1, marginBottom: '4px', fontFamily: T2.font }}>{bundle.price}</div>
                        <div style={{ fontSize: '12px', color: T2.slate400, marginBottom: '16px', fontFamily: T2.font }}>{bundle.priceNote}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                            <span className="dashicons dashicons-star-filled" style={{ color: bundle.colour, fontSize: '16px' }}></span>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: T2.slate700, fontFamily: T2.font }}>{bundle.credits} credits</span>
                            <span style={{ fontSize: '12px', color: T2.slate400, fontFamily: T2.font }}>-- never expire</span>
                        </div>
                        <button
                            onClick={() => handlePurchase(bundle.id)}
                            disabled={!!purchasing}
                            onMouseEnter={e => { if (!purchasing) e.currentTarget.style.opacity='0.85'; e.currentTarget.style.transform='translateY(-1px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.transform='translateY(0)'; }}
                            style={{
                                width: '100%', padding: '10px', borderRadius: T2.radiusSm, border: 'none',
                                background: purchasing === bundle.id ? T2.slate200 : bundle.colour,
                                color: purchasing === bundle.id ? T2.slate500 : T2.white,
                                fontFamily: T2.font, fontWeight: 700, fontSize: '14px',
                                cursor: purchasing ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                            }}
                        >
                            {purchasing === bundle.id ? (
                                <><span className="dashicons dashicons-update" style={{ fontSize: '16px', animation: 'acb-spin 0.7s linear infinite' }}></span>Redirecting...</>
                            ) : (
                                <><span className="dashicons dashicons-cart" style={{ fontSize: '16px' }}></span>Buy Now</>
                            )}
                        </button>
                    </div>
                ))}
            </div>
            <p style={{ marginTop: '12px', fontSize: '12px', color: T2.slate400, fontFamily: T2.font, textAlign: 'center' }}>
                Secure payment via Stripe. Credits are added to your account instantly after payment.
            </p>
        </div>
    );
};

const Usage = () => {
    const [usage, setUsage] = useState({
        plan: 'free', postsUsed: 0, postsLimit: 5,
        creditsRemaining: 5, daysUntilReset: null,
        totalPostsEver: 0, avgPostsPerMonth: 0,
        recentActivity: [], licenseValid: false, email: '', domain: ''
    });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    const fetchLicenseStatus = async () => {
        setRefreshing(true);
        try {
            const settings = await apiFetch({ path: '/ai-content/v1/settings' });
            if (!settings.license_key) {
                setUsage(prev => ({ ...prev, plan: 'free', licenseValid: false, creditsRemaining: 5, postsLimit: 5, daysUntilReset: null }));
                setLoading(false); setRefreshing(false); return;
            }
            const creditsData = await fetch(
                `https://ai-content-bridge-license-server-production.up.railway.app/api/credits?license_key=${settings.license_key}`
            ).then(r => r.json());
            const entriesRes = await apiFetch({ path: '/ai-content/v1/entries' });
            const totalArticles = entriesRes?.entries?.length || 0;
            if (creditsData.success) {
                const tier = creditsData.tier || 'free';
                const isUnlimited = creditsData.monthly_credit_limit === -1;
                const limit = isUnlimited ? 'Unlimited' : (creditsData.monthly_credit_limit || creditsData.credits_remaining || 5);
                const remaining = isUnlimited ? 'Unlimited' : (creditsData.credits_remaining || 0);

                // Calculate real days until next credit expiry from the server response
                let daysUntilReset = null;
                if (creditsData.next_expiry_date) {
                    const expiry = new Date(creditsData.next_expiry_date);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const diffMs = expiry - today;
                    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                    // Only show if it's a real expiry (bundle credits expire 2099-12-31, ignore those)
                    daysUntilReset = diffDays > 0 && diffDays < 180 ? diffDays : null;
                }

                setUsage({ plan: tier, postsUsed: totalArticles, postsLimit: limit, creditsRemaining: remaining, daysUntilReset, totalPostsEver: totalArticles, avgPostsPerMonth: totalArticles > 0 ? Math.round(totalArticles / 3) : 0, recentActivity: [], licenseValid: true, email: settings.email || '', domain: settings.domain || '' });
            } else {
                setUsage(prev => ({ ...prev, plan: 'free', licenseValid: false, creditsRemaining: 0, postsLimit: 5 }));
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Could not connect to license server.' });
            setUsage({ plan: 'free', postsUsed: 2, postsLimit: 5, creditsRemaining: 3, daysUntilReset: null, totalPostsEver: 0, avgPostsPerMonth: 0, recentActivity: [], licenseValid: false, email: '', domain: '' });
        }
        setLoading(false); setRefreshing(false);
    };

    useEffect(() => { fetchLicenseStatus(); }, []);

    const getPlanDisplayName = (plan) => ({ free: 'Free', starter: 'Starter', pro: 'Pro', agency: 'Agency' }[plan] || 'Free');
    const getPlanColor = (plan) => ({ free: T.slate500, starter: '#3b82f6', pro: T.teal, agency: '#8b5cf6' }[plan] || T.slate500);
    const getPlanBg = (plan) => ({ free: T.slate100, starter: '#eff6ff', pro: T.tealLight, agency: '#f5f3ff' }[plan] || T.slate100);

    // Monthly subscription credits only (not bundles) for the progress bar
    // Total remaining may exceed monthly limit if the user has purchased bundles
    const monthlyLimit  = usage.postsLimit === 'Unlimited' ? null : usage.postsLimit;
    const totalRemaining = typeof usage.creditsRemaining === 'number' ? usage.creditsRemaining : 0;
    // Progress bar shows subscription usage � capped so it never goes negative or over 100%
    const usedPct = monthlyLimit ? Math.min(100, Math.max(0, ((monthlyLimit - Math.min(totalRemaining, monthlyLimit)) / monthlyLimit) * 100)) : 20;

    const StatCard = ({ label, value, sub, icon, color, bg }) => (
        <div style={{ background: bg || T.white, border: `1px solid ${T.slate200}`, borderRadius: T.radius, padding: '20px', boxShadow: T.shadow, flex: 1, minWidth: '160px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: T.slate400, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: T.font }}>{label}</div>
                {icon && <span className={`dashicons ${icon}`} style={{ color: color || T.slate400, fontSize: '20px' }}></span>}
            </div>
            <div style={{ fontSize: '36px', fontWeight: 800, color: color || T.slate900, lineHeight: 1, fontFamily: T.font }}>{value}</div>
            {sub && <div style={{ fontSize: '13px', color: T.slate500, marginTop: '6px', fontFamily: T.font }}>{sub}</div>}
        </div>
    );

    return (
        <>
            <style>{`
                .acb-usage * { box-sizing: border-box; }
                .acb-refresh:hover { background: ${T.slate100} !important; }
                @media (max-width: 768px) {
                    .acb-stats-grid { flex-direction: column !important; }
                    .acb-upgrade-grid { grid-template-columns: 1fr !important; }
                }
            `}</style>

            <div className="acb-usage" style={{ padding: '28px', fontFamily: T.font }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: T.slate900, fontFamily: T.font }}>Usage & Credits</h2>
                        <p style={{ margin: '4px 0 0', fontSize: '14px', color: T.slate500, fontFamily: T.font }}>Live data from your license server</p>
                    </div>
                    <button
                        className="acb-refresh"
                        onClick={fetchLicenseStatus}
                        disabled={refreshing}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: T.radiusSm, border: `1px solid ${T.slate200}`, background: T.white, color: T.slate700, fontFamily: T.font, fontWeight: 600, fontSize: '13px', cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, transition: 'background 0.15s ease' }}
                    >
                        <span className="dashicons dashicons-update" style={{ fontSize: '16px', animation: refreshing ? 'acb-spin 0.7s linear infinite' : 'none' }}></span>
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>

                {/* Notice */}
                {message.text && (
                    <div style={{ padding: '12px 16px', borderRadius: T.radiusSm, marginBottom: '20px', background: message.type === 'error' ? T.redLight : T.greenLight, color: message.type === 'error' ? '#991b1b' : T.tealDark, border: `1px solid ${message.type === 'error' ? T.redBorder : T.greenBorder}`, fontSize: '14px', fontFamily: T.font }}>
                        {message.text}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px', color: T.slate400 }}>
                        <span className="dashicons dashicons-update" style={{ fontSize: '32px', animation: 'acb-spin 0.7s linear infinite', display: 'block', marginBottom: '12px' }}></span>
                        <div style={{ fontFamily: T.font, fontSize: '14px' }}>Loading your usage data...</div>
                    </div>
                ) : (
                    <>
                        {/* Plan hero card */}
                        <div style={{ background: getPlanBg(usage.plan), border: `1px solid ${T.slate200}`, borderRadius: T.radius, padding: '24px', marginBottom: '20px', boxShadow: T.shadow }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: T.slate400, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px', fontFamily: T.font }}>Current Plan</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                        <span style={{ fontSize: '32px', fontWeight: 800, color: getPlanColor(usage.plan), fontFamily: T.font }}>{getPlanDisplayName(usage.plan)}</span>
                                        <span style={{ padding: '4px 12px', borderRadius: '9999px', background: getPlanColor(usage.plan), color: T.white, fontSize: '12px', fontWeight: 700, fontFamily: T.font }}>
                                            {usage.postsLimit === 'Unlimited' ? 'Unlimited credits' : `${usage.postsLimit} credits/mo`}
                                        </span>
                                    </div>
                                    {/* Progress bar � subscription credits only */}
                                    <div style={{ width: '280px', maxWidth: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: T.slate500, marginBottom: '6px', fontFamily: T.font }}>
                                            <span>Monthly credits</span>
                                            <span>
                                                <strong style={{ color: getPlanColor(usage.plan) }}>
                                                    {monthlyLimit ? `${monthlyLimit} / mo` : 'Unlimited'}
                                                </strong>
                                            </span>
                                        </div>
                                        <div style={{ height: '8px', background: T.slate200, borderRadius: '9999px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${usedPct}%`, background: getPlanColor(usage.plan), borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                                        </div>
                                        <div style={{ fontSize: '12px', color: T.slate500, marginTop: '6px', fontFamily: T.font }}>
                                            {usage.daysUntilReset !== null
                                                ? <>Expires in <strong>{usage.daysUntilReset} day{usage.daysUntilReset === 1 ? '' : 's'}</strong></>
                                                : <span style={{ color: T.green, fontWeight: 600 }}>Credits never expire</span>
                                            }
                                        </div>
                                    </div>
                                </div>

                                {/* Credits remaining */}
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: T.slate400, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px', fontFamily: T.font }}>Total Credits</div>
                                    <div style={{ fontSize: '56px', fontWeight: 800, color: getPlanColor(usage.plan), lineHeight: 1, fontFamily: T.font }}>{totalRemaining}</div>
                                    <div style={{ fontSize: '12px', color: T.slate500, marginTop: '6px', fontFamily: T.font }}>available to use</div>
                                </div>
                            </div>
                        </div>

                        {/* Stat cards */}
                        <div className="acb-stats-grid" style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                            <StatCard label="Total Articles" value={usage.totalPostsEver} sub="All time" icon="dashicons-admin-post" color={T.teal} bg={T.tealLight} />
                            <StatCard label="Avg Per Month" value={usage.avgPostsPerMonth} sub="Rolling average" icon="dashicons-chart-bar" />
                            <StatCard label="License Status" value={usage.licenseValid ? 'Active' : 'Inactive'} sub={usage.domain || 'No domain'} icon={usage.licenseValid ? 'dashicons-yes-alt' : 'dashicons-warning'} color={usage.licenseValid ? T.teal : '#ef4444'} />
                        </div>

                        {/* Upgrade plans */}
                        <UpgradePlans currentPlan={usage.plan} />

                        {/* Credit bundle purchases */}
                        <CreditBundles />
                    </>
                )}

                <style>{`
                    @keyframes acb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                `}</style>
            </div>
        </>
    );
};

export default Usage;