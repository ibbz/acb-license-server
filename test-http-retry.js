// test-http-retry.js
// Standalone unit test for lib/http-retry.js — the bounded retry that wraps the
// Anthropic text call and the OpenAI image call. Run: `node test-http-retry.js`
// (no env / DB / real network required — global fetch is stubbed per case).
//
// Regression cover for AICOBR_FETCH_RETRY_2026_07_26: the 2026-07-26 Railway
// egress blip that failed every outbound call with `TypeError: fetch failed`
// and killed a paid generation run outright, because the text call had no retry.

const {
    fetchWithRetry, classifyError, isReplayableBody, retryAfterMs, backoffMs,
} = require('./lib/http-retry');

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ok  ', l)) : (fail++, console.error('  FAIL', l));

// Silence the helper's own retry logging so test output stays readable.
const realWarn = console.warn;
console.warn = () => {};

// ── Helpers ─────────────────────────────────────────────────────────────────
const realFetch = global.fetch;
const res = (status, body = '', headers = {}) =>
    new Response(body, { status, headers });

/** Stub global fetch with a scripted sequence; records how many calls landed. */
function stub(sequence) {
    const state = { calls: 0 };
    global.fetch = async () => {
        const step = sequence[Math.min(state.calls, sequence.length - 1)];
        state.calls++;
        if (step instanceof Error) throw step;
        return step();
    };
    return state;
}

/** Build the undici-shaped error the outage actually produced. */
function fetchFailed(code) {
    const err = new TypeError('fetch failed');
    if (code) err.cause = Object.assign(new Error('upstream'), { code });
    return err;
}

// ── classifyError ───────────────────────────────────────────────────────────
console.log('classifyError:');
ok('bare "fetch failed" -> preconnect', classifyError(fetchFailed()) === 'preconnect');
ok('EAI_AGAIN (DNS) -> preconnect', classifyError(fetchFailed('EAI_AGAIN')) === 'preconnect');
ok('ENOTFOUND -> preconnect', classifyError(fetchFailed('ENOTFOUND')) === 'preconnect');
ok('ECONNREFUSED -> preconnect', classifyError(fetchFailed('ECONNREFUSED')) === 'preconnect');
ok('ECONNRESET -> inflight (may have billed)', classifyError(fetchFailed('ECONNRESET')) === 'inflight');
ok('UND_ERR_SOCKET -> inflight', classifyError(fetchFailed('UND_ERR_SOCKET')) === 'inflight');
ok('TimeoutError -> inflight', classifyError(Object.assign(new Error('t'), { name: 'TimeoutError' })) === 'inflight');
ok('caller AbortError -> null (never retry)', classifyError(Object.assign(new Error('a'), { name: 'AbortError' })) === null);
ok('plain TypeError -> null', classifyError(new TypeError('bad arg')) === null);
ok('SyntaxError -> null', classifyError(new SyntaxError('nope')) === null);
ok('null -> null', classifyError(null) === null);

// Nested cause + AggregateError (multi-address DNS) still resolve.
const nested = new TypeError('fetch failed');
nested.cause = { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) };
ok('nested .cause chain is walked', classifyError(nested) === 'inflight');
const agg = new TypeError('fetch failed');
agg.cause = { errors: [Object.assign(new Error('v6'), { code: 'ENETUNREACH' })] };
ok('AggregateError .errors is walked', classifyError(agg) === 'preconnect');

// ── Body replay guard ───────────────────────────────────────────────────────
console.log('isReplayableBody:');
ok('JSON string is replayable', isReplayableBody(JSON.stringify({ a: 1 })) === true);
ok('undefined is replayable', isReplayableBody(undefined) === true);
ok('Buffer is replayable', isReplayableBody(Buffer.from('x')) === true);
ok('ReadableStream is NOT replayable', isReplayableBody(new ReadableStream()) === false);

// ── Retry-After parsing ─────────────────────────────────────────────────────
console.log('retryAfterMs:');
ok('delta-seconds', retryAfterMs(res(429, '', { 'retry-after': '2' }), 8000) === 2000);
ok('capped at maxDelayMs', retryAfterMs(res(429, '', { 'retry-after': '600' }), 8000) === 8000);
ok('absent header -> null', retryAfterMs(res(429), 8000) === null);
ok('garbage header -> null', retryAfterMs(res(429, '', { 'retry-after': 'soon' }), 8000) === null);

// ── Backoff ─────────────────────────────────────────────────────────────────
console.log('backoffMs:');
{
    const samples = Array.from({ length: 200 }, (_, i) => backoffMs(1, 800, 8000));
    ok('attempt 1 stays within [400,800]', samples.every(m => m >= 400 && m <= 800));
    ok('jitter actually varies', new Set(samples).size > 1);
    ok('never exceeds maxDelayMs', Array.from({ length: 200 }, () => backoffMs(9, 800, 8000)).every(m => m <= 8000));
}

// ── fetchWithRetry behaviour ────────────────────────────────────────────────
(async () => {
    console.log('fetchWithRetry:');
    const fast = { baseDelayMs: 1, maxDelayMs: 2, label: 'test' };

    // The outage case: transient throw, then success.
    let s = stub([fetchFailed('EAI_AGAIN'), () => res(200, 'ok')]);
    let r = await fetchWithRetry('https://x.test', {}, fast);
    ok('recovers from a transient DNS failure', r.status === 200 && s.calls === 2);

    // Exhaustion still surfaces the original error to the caller.
    s = stub([fetchFailed('EAI_AGAIN')]);
    let threw = null;
    try { await fetchWithRetry('https://x.test', {}, { ...fast, attempts: 3 }); }
    catch (e) { threw = e; }
    ok('rethrows after exhausting attempts', threw instanceof TypeError && s.calls === 3);

    // Non-transient errors must not be retried at all.
    s = stub([new SyntaxError('bad')]);
    threw = null;
    try { await fetchWithRetry('https://x.test', {}, fast); } catch (e) { threw = e; }
    ok('non-transient error fails fast (1 call)', threw instanceof SyntaxError && s.calls === 1);

    // 4xx is deterministic — returned untouched on the first attempt.
    s = stub([() => res(400, 'bad request')]);
    r = await fetchWithRetry('https://x.test', {}, fast);
    ok('400 returned immediately, no retry', r.status === 400 && s.calls === 1);
    ok('400 body still readable by caller', (await r.text()) === 'bad request');

    s = stub([() => res(401, '')]);
    r = await fetchWithRetry('https://x.test', {}, fast);
    ok('401 not retried', r.status === 401 && s.calls === 1);

    // 429 / 529 / 5xx are retried.
    s = stub([() => res(429, 'slow down'), () => res(200, 'ok')]);
    r = await fetchWithRetry('https://x.test', {}, fast);
    ok('429 retried then succeeds', r.status === 200 && s.calls === 2);

    s = stub([() => res(529, 'overloaded'), () => res(200, 'ok')]);
    r = await fetchWithRetry('https://x.test', {}, fast);
    ok('529 (Anthropic overloaded) retried', r.status === 200 && s.calls === 2);

    s = stub([() => res(503, ''), () => res(502, ''), () => res(200, 'ok')]);
    r = await fetchWithRetry('https://x.test', {}, { ...fast, attempts: 3 });
    ok('5xx retried across attempts', r.status === 200 && s.calls === 3);

    // Final retryable status is handed back rather than thrown.
    s = stub([() => res(500, 'boom')]);
    r = await fetchWithRetry('https://x.test', {}, { ...fast, attempts: 2 });
    ok('exhausted 5xx returned to caller, not thrown', r.status === 500 && s.calls === 2);

    // Non-replayable body must never be sent twice.
    s = stub([fetchFailed('EAI_AGAIN'), () => res(200, 'ok')]);
    threw = null;
    try { await fetchWithRetry('https://x.test', { body: new ReadableStream() }, fast); }
    catch (e) { threw = e; }
    ok('stream body disables retry (1 call)', threw !== null && s.calls === 1);

    // Wall-clock budget stops the sequence early.
    s = stub([fetchFailed('EAI_AGAIN')]);
    threw = null;
    try {
        await fetchWithRetry('https://x.test', {}, {
            ...fast, attempts: 10, baseDelayMs: 50, totalBudgetMs: 1,
        });
    } catch (e) { threw = e; }
    ok('totalBudgetMs halts retries immediately', threw !== null && s.calls === 1);

    // A single attempt is honoured.
    s = stub([fetchFailed('ECONNRESET')]);
    threw = null;
    try { await fetchWithRetry('https://x.test', {}, { ...fast, attempts: 1 }); } catch (e) { threw = e; }
    ok('attempts:1 disables retry', threw !== null && s.calls === 1);

    global.fetch = realFetch;
    console.warn = realWarn;
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
