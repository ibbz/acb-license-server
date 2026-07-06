// test-cost-log.js
// Standalone test for lib/cost-log.js using a stub pool (no DB required).
// Run: `node test-cost-log.js`. Exit code non-zero on failure.
//
// Verifies the three things that only ever break at runtime:
//   1. attachCost / insertCostRow build valid SQL whose $n parameter count
//      matches the values array.
//   2. Every column they write exists in add-cost-columns.sql or schema.sql
//      (catches a column/migration drift before it 500s in production).
//   3. The computed cost values land in the right positional parameters,
//      including the failure shape (no usage -> text cost 0, not null) and
//      the cache-token pass-through.

const fs = require('fs');
const costLog = require('./lib/cost-log');

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fail++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// Columns known to the schema (migration + schema.sql + base table)
const migration = fs.readFileSync('./add-cost-columns.sql', 'utf8');
const schema    = fs.readFileSync('./schema.sql', 'utf8');
function columnKnown(col) {
    return migration.includes(col) || schema.includes(col);
}

// Stub pool that records queries instead of executing them
function stubPool() {
    const calls = [];
    return {
        calls,
        query(sql, params) {
            calls.push({ sql, params });
            return Promise.resolve({ rows: [{ id: 42 }] });
        },
    };
}

function paramCount(sql) {
    const m = sql.match(/\$\d+/g) || [];
    return new Set(m).size;
}

function extractUpdateColumns(sql) {
    // columns on the left of '=' inside SET ... WHERE
    const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    return [...setPart.matchAll(/(\w+)\s*=/g)].map(m => m[1]);
}

function extractInsertColumns(sql) {
    const m = sql.match(/INSERT INTO usage_logs\s*\(([^)]+)\)/s);
    return m ? m[1].split(',').map(c => c.trim()) : [];
}

(async () => {
    // ── 1. attachCost — success shape ────────────────────────────────────────
    console.log('attachCost (success, full usage):');
    let pool = stubPool();
    await costLog.attachCost(pool, 42, {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        stop_reason: 'end_turn',
        image: { model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium' },
        serpCalls: 1,
        costEvent: 'generate',
        succeeded: true,
        generationSeconds: 93,
    });
    check('one UPDATE issued', pool.calls.length === 1);
    const upd = pool.calls[0];
    check('param placeholders match values array', paramCount(upd.sql) === upd.params.length,
        `${paramCount(upd.sql)} placeholders vs ${upd.params.length} values`);
    const updCols = extractUpdateColumns(upd.sql);
    for (const col of updCols) {
        check(`UPDATE column '${col}' exists in migration/schema`, columnKnown(col));
    }
    // positional value checks (id, then the SET params in order)
    check('id is $1', upd.params[0] === 42);
    check('model lands in params', upd.params.includes('claude-sonnet-4-6'));
    check('text cost = 0.057', upd.params.includes(0.057));
    check('image cost = 0.05', upd.params.includes(0.05));
    check('serp cost = 0.001', upd.params.includes(0.001));
    check('total = 0.108', upd.params.includes(0.108));
    check('succeeded true', upd.params.includes(true));
    check('generation seconds = 93', upd.params.includes(93));

    // ── 2. attachCost — failure shape, no Anthropic response ────────────────
    console.log('attachCost (failure before Anthropic returned):');
    pool = stubPool();
    await costLog.attachCost(pool, 43, {
        model: 'claude-sonnet-4-6',
        usage: null,                       // API call failed — not billed
        stop_reason: null,
        image: { model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium' }, // image DID return before the throw
        serpCalls: 1,
        costEvent: 'generate',
        succeeded: false,
    });
    let p = pool.calls[0].params;
    check('text cost is 0 (not null) when no usage', p.includes(0) && !p.slice(11, 12).includes(null));
    check('image still costed at 0.05', p.includes(0.05));
    check('total = 0.051 (image + serp only)', p.includes(0.051));
    check('succeeded false recorded', p.includes(false));

    // ── 3. attachCost — null id no-ops ───────────────────────────────────────
    console.log('attachCost (null id):');
    pool = stubPool();
    await costLog.attachCost(pool, null, { costEvent: 'generate', succeeded: false });
    check('no query issued for null id', pool.calls.length === 0);

    // ── 4. insertCostRow — outline/support shape, cache tokens through ──────
    console.log('insertCostRow (support_chat with cache tokens):');
    pool = stubPool();
    await costLog.insertCostRow(pool, {
        licenseKeyId: 7,
        domain: 'portal',
        postTitle: 'Support assistant reply',
        contentType: 'support_chat',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 500, output_tokens: 400, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0 },
        stop_reason: 'end_turn',
        image: null,
        serpCalls: 0,
        costEvent: 'support_chat',
        succeeded: true,
    });
    check('one INSERT issued', pool.calls.length === 1);
    const ins = pool.calls[0];
    check('insert placeholders match values', paramCount(ins.sql) === ins.params.length,
        `${paramCount(ins.sql)} vs ${ins.params.length}`);
    const insCols = extractInsertColumns(ins.sql);
    // credits_used is a literal 0 in the SQL, not a param — count columns vs params+1
    check('insert column count = params + 2 (credits_used + created_at literals)', insCols.length === ins.params.length + 2,
        `${insCols.length} cols vs ${ins.params.length} params`);
    for (const col of insCols) {
        check(`INSERT column '${col}' exists in migration/schema`, columnKnown(col));
    }
    check('cache-heavy text cost = 0.0255', ins.params.includes(0.0255));
    check('cache read tokens stored', ins.params.includes(60000));
    check('null image -> image cost 0', ins.params.includes(0));

    // ── 5. insertCostRow — unattributed (old plugin, no licence key) ────────
    console.log('insertCostRow (unattributed outline):');
    pool = stubPool();
    await costLog.insertCostRow(pool, {
        licenseKeyId: null, domain: 'example.com', postTitle: 'kw', contentType: 'outline',
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 2000, output_tokens: 1500 },
        stop_reason: 'end_turn', image: null, serpCalls: 1,
        costEvent: 'outline', succeeded: true,
    });
    check('null license_key_id accepted as $1', pool.calls[0].params[0] === null);

    // ── 6. contract: both helpers swallow DB errors ──────────────────────────
    console.log('error swallowing (must never throw):');
    const boomPool = { query: () => Promise.reject(new Error('db down')) };
    let threw = false;
    try {
        await costLog.attachCost(boomPool, 1, { costEvent: 'generate', succeeded: true });
        await costLog.insertCostRow(boomPool, { costEvent: 'outline', succeeded: true });
    } catch { threw = true; }
    check('attachCost/insertCostRow never throw on DB failure', !threw);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
