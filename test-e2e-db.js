// test-e2e-db.js — end-to-end against a REAL Postgres (local test instance).
// Exercises the exact production write paths (cost-log.js) and then the exact
// /api/admin/costs + dashboard queries over the resulting rows.
// Run: DATABASE_URL=postgres://acb:acb@localhost/acbprod node test-e2e-db.js
const { Pool } = require('pg');
const costLog = require('./lib/cost-log');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const check = (label, cond, detail='') => cond
    ? (pass++, console.log(`  ok   ${label}`))
    : (fail++, console.error(`  FAIL ${label}${detail?' — '+detail:''}`));

(async () => {
    // ── Simulate generate.js: deduction-time insert with RETURNING id ───────
    const ins = await pool.query(`
        INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
        VALUES ((SELECT id FROM license_keys WHERE license_key = $1), 'site.com', 'E2E success brief', 3, 'blog_post', NOW())
        RETURNING id
    `, ['ACB-PRO-KEY']);
    const genRowId = ins.rows[0].id;
    check('deduction insert RETURNING id works', !!genRowId);

    // attempt 1 — success, full shape (the model's "typical brief")
    await costLog.attachCost(pool, genRowId, {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        stop_reason: 'end_turn',
        image: { model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium' },
        serpCalls: 1,
        costEvent: 'generate', succeeded: true, generationSeconds: 93,
    });
    let row = (await pool.query('SELECT * FROM usage_logs WHERE id=$1', [genRowId])).rows[0];
    check('text_cost 0.057', parseFloat(row.text_cost_usd) === 0.057);
    check('image_cost 0.05', parseFloat(row.image_cost_usd) === 0.05);
    check('total 0.108', parseFloat(row.total_cost_usd) === 0.108, row.total_cost_usd);
    check('succeeded true', row.succeeded === true);
    check('generation seconds 93', row.generation_time_seconds === 93);
    check('price_version stamped', !!row.price_version);

    // ── Regeneration = second attempt = SECOND row (append, not overwrite) ──
    const ins2 = await pool.query(`
        INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
        VALUES ((SELECT id FROM license_keys WHERE license_key = $1), 'site.com', 'E2E success brief', 3, 'blog_post', NOW())
        RETURNING id
    `, ['ACB-PRO-KEY']);
    await costLog.attachCost(pool, ins2.rows[0].id, {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 4200, output_tokens: 6800 },
        stop_reason: 'max_tokens',   // a truncation
        image: null, serpCalls: 0,
        costEvent: 'generate', succeeded: true,
    });
    const attempts = await pool.query(`SELECT COUNT(*) FROM usage_logs WHERE post_title='E2E success brief' AND total_cost_usd IS NOT NULL`);
    check('regeneration appended a second costed row', parseInt(attempts.rows[0].count) === 2);

    // ── Failure path on the free tier (waste + free burn) ───────────────────
    const ins3 = await pool.query(`
        INSERT INTO usage_logs (license_key_id, domain, post_title, credits_used, content_type, created_at)
        VALUES ((SELECT id FROM license_keys WHERE license_key = $1), 'free.com', 'E2E failed brief', 3, 'blog_post', NOW())
        RETURNING id
    `, ['ACB-TEST-KEY']);
    await costLog.attachCost(pool, ins3.rows[0].id, {
        model: 'claude-sonnet-4-6',
        usage: null,  // Anthropic call itself failed — not billed
        stop_reason: null,
        image: { model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium' }, // image returned before the throw
        serpCalls: 1,
        costEvent: 'generate', succeeded: false, generationSeconds: 12,
    });
    row = (await pool.query('SELECT * FROM usage_logs WHERE id=$1', [ins3.rows[0].id])).rows[0];
    check('failed attempt: text cost 0', parseFloat(row.text_cost_usd) === 0);
    check('failed attempt: total 0.051 (image+serp)', parseFloat(row.total_cost_usd) === 0.051, row.total_cost_usd);
    check('failed attempt: succeeded false', row.succeeded === false);

    // ── Unattributed outline (old plugin, NULL licence) ─────────────────────
    await costLog.insertCostRow(pool, {
        licenseKeyId: null, domain: 'old-plugin.com', postTitle: 'seo keyword', contentType: 'outline',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 2500, output_tokens: 1800 },
        stop_reason: 'end_turn', image: null, serpCalls: 1,
        costEvent: 'outline', succeeded: true,
    });
    const orphan = await pool.query(`SELECT * FROM usage_logs WHERE cost_event='outline'`);
    check('unattributed outline row inserted (NULL licence ok)', orphan.rows.length === 1 && orphan.rows[0].license_key_id === null);

    // ── Support chat with real cache tokens ─────────────────────────────────
    const lic = await pool.query(`SELECT id FROM license_keys WHERE license_key='ACB-PRO-KEY'`);
    await costLog.insertCostRow(pool, {
        licenseKeyId: lic.rows[0].id, domain: 'portal', postTitle: 'Support assistant reply', contentType: 'support_chat',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 500, output_tokens: 400, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0 },
        stop_reason: 'end_turn', image: null, serpCalls: 0,
        costEvent: 'support_chat', succeeded: true,
    });
    row = (await pool.query(`SELECT * FROM usage_logs WHERE cost_event='support_chat'`)).rows[0];
    check('cache-read text cost 0.0255', parseFloat(row.text_cost_usd) === 0.0255, row.text_cost_usd);
    check('cache_read_tokens 60000 stored', row.cache_read_tokens === 60000);

    // ── Now run the EXACT admin queries over these rows ─────────────────────
    console.log('admin /costs queries over live rows:');
    const days = 30;
    const summary = await pool.query(`
        SELECT
            COALESCE(SUM(total_cost_usd), 0)                             AS total_cost,
            COALESCE(SUM(total_cost_usd) FILTER (WHERE succeeded = false), 0) AS waste_cost,
            COUNT(*) FILTER (WHERE succeeded = false)                    AS failed_attempts,
            COUNT(*) FILTER (WHERE stop_reason = 'max_tokens')           AS truncations,
            COUNT(*) FILTER (WHERE total_cost_usd IS NOT NULL)           AS priced_rows,
            COUNT(*)                                                     AS all_rows
        FROM usage_logs
        WHERE created_at >= NOW() - ($1 || ' days')::interval
          AND post_title != 'VALIDATION_CHECK'
    `, [days]);
    const s = summary.rows[0];
    // expected total: 0.108 + (4200*3+6800*15)/1e6=0.1146 + 0.051 + ((2500*3+1800*15)/1e6 + 1 serp)=0.0355 + 0.0255 = 0.3346
    check('summary total_cost 0.3346', parseFloat(s.total_cost) === 0.3346, s.total_cost);
    check('waste 0.051 (the failed attempt)', parseFloat(s.waste_cost) === 0.051);
    check('1 truncation counted', parseInt(s.truncations) === 1);
    check('priced 5 of 6 rows (legacy row unpriced)', parseInt(s.priced_rows) === 5 && parseInt(s.all_rows) === 6, `${s.priced_rows}/${s.all_rows}`);

    const byTier = await pool.query(`
        SELECT COALESCE(lk.tier, 'unattributed') AS tier,
               COALESCE(SUM(ul.total_cost_usd), 0) AS cost
        FROM usage_logs ul
        LEFT JOIN license_keys lk ON lk.id = ul.license_key_id
        WHERE ul.total_cost_usd IS NOT NULL
        GROUP BY COALESCE(lk.tier, 'unattributed') ORDER BY cost DESC
    `);
    const tierMap = Object.fromEntries(byTier.rows.map(r => [r.tier, parseFloat(r.cost)]));
    check('free-tier burn = 0.051', tierMap.free === 0.051, JSON.stringify(tierMap));
    check('unattributed bucket = 0.0355 (incl. its serp call)', tierMap.unattributed === 0.0355);
    check('pro = 0.2481', tierMap.pro === 0.2481);

    const dist = await pool.query(`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_cost_usd) AS p50,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_cost_usd) AS p95
        FROM usage_logs WHERE cost_event = 'generate' AND total_cost_usd IS NOT NULL
    `);
    check('p50/p95 compute without error', dist.rows[0].p50 !== null && dist.rows[0].p95 !== null);

    // Generation counts stay clean of the new event rows
    const genCount = await pool.query(`
        SELECT COUNT(*) FROM usage_logs
        WHERE post_title != 'VALIDATION_CHECK'
          AND (cost_event IS NULL OR cost_event IN ('generate', 'strategist_plan'))
    `);
    check('generation count excludes outline/support rows (4 of 6)', parseInt(genCount.rows[0].count) === 4, genCount.rows[0].count);

    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
