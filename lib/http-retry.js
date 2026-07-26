/**
 * lib/http-retry.js — bounded retry for outbound provider calls.
 *
 * AICOBR_FETCH_RETRY_2026_07_26
 *
 * Why this exists
 * ---------------
 * On 2026-07-26 a Railway egress blip took out EVERY outbound call in one
 * generation run — Anthropic, OpenAI, YouTube and the customer's own WordPress
 * host all threw `TypeError: fetch failed` while Postgres (private network)
 * stayed up. The image/SERP/YouTube steps fail soft so they only degraded the
 * output, but the Anthropic text call had no retry at all, so a sub-second DNS
 * blip destroyed a run that had already deducted credits, taken a concurrency
 * slot and written a usage row.
 *
 * What it retries
 * ---------------
 *   1. Transient network throws — DNS/TCP/TLS failures, socket resets, and our
 *      own request timeout. See classifyError().
 *   2. Retryable HTTP statuses — 408/425/429 and 5xx, including Anthropic's 529
 *      "overloaded". `Retry-After` is honoured when the provider sends it.
 *
 * Everything else (400/401/403/404/413/422 …) is returned to the caller
 * untouched on the first attempt: those are deterministic, so retrying only
 * burns wall-clock while holding a concurrency slot.
 *
 * Billing caveat (deliberate, documented trade-off)
 * -------------------------------------------------
 * classifyError() separates 'preconnect' failures (the request provably never
 * reached the provider — safe to replay) from 'inflight' ones (ECONNRESET and
 * friends, where the provider MAY have processed and billed the request before
 * the socket died). We retry both, because losing the run costs the customer a
 * credit and costs us the tokens anyway — but the two are logged distinctly so
 * an unexplained spend in /api/admin/costs can be traced back to an 'inflight'
 * replay. The Messages API has no idempotency key, so this cannot be deduped.
 *
 * Wall-clock safety
 * -----------------
 * Retries happen while the caller holds a ConcurrencyGate permit, and the
 * plugin marks an entry stuck after 12 minutes. `totalBudgetMs` caps the whole
 * attempt sequence so a run can never outlive that window and strand an entry.
 */

// Failures that provably happened BEFORE the request reached the provider.
// Replaying these cannot double-bill.
const TRANSIENT_PRECONNECT = new Set([
    'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH',
    'ENETUNREACH', 'ENETDOWN', 'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT',
]);

// Failures where the request may already have been processed. Ambiguous —
// retried, but logged loudly so cost anomalies stay traceable.
const TRANSIENT_INFLIGHT = new Set([
    'ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT',
    'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

// 529 = Anthropic "overloaded". 425 = too early. The rest are standard.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Decide whether a thrown error is worth retrying, and which risk class it is.
 * Returns 'preconnect' | 'inflight' | null (null = do not retry).
 */
function classifyError(err) {
    if (!err) return null;

    // The caller aborted on purpose — never retry over the top of that.
    if (err.name === 'AbortError') return null;
    // Our own AbortSignal.timeout fired: the connection hung.
    if (err.name === 'TimeoutError') return 'inflight';

    // undici reports `TypeError: fetch failed` and hangs the real errno off
    // .cause (sometimes nested, e.g. AggregateError for multi-address DNS).
    for (let cur = err, depth = 0; cur && depth < 5; cur = cur.cause, depth++) {
        const code = cur.code ? String(cur.code) : null;
        if (code && TRANSIENT_PRECONNECT.has(code)) return 'preconnect';
        if (code && TRANSIENT_INFLIGHT.has(code)) return 'inflight';
        if (Array.isArray(cur.errors)) {
            for (const sub of cur.errors) {
                const c = sub && sub.code ? String(sub.code) : null;
                if (c && TRANSIENT_PRECONNECT.has(c)) return 'preconnect';
                if (c && TRANSIENT_INFLIGHT.has(c)) return 'inflight';
            }
        }
    }

    // Bare "fetch failed" with no usable errno — undici's generic connection
    // failure. No response was received, so treat it as pre-connect.
    if (err instanceof TypeError && /fetch failed/i.test(err.message || '')) return 'preconnect';

    return null;
}

/**
 * A body may only be replayed if it is a fully-buffered value. Streams are
 * consumed by the first attempt, so retrying would send an empty body.
 */
function isReplayableBody(body) {
    if (body == null) return true;
    if (typeof body === 'string') return true;
    if (Buffer.isBuffer(body)) return true;
    if (body instanceof URLSearchParams) return true;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
    return false;
}

/** Half-jittered exponential backoff — spreads a thundering herd on 429/529. */
function backoffMs(attempt, baseDelayMs, maxDelayMs) {
    const ceiling = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** Honour Retry-After (delta-seconds or HTTP date), capped at maxDelayMs. */
function retryAfterMs(res, maxDelayMs) {
    const raw = res.headers.get('retry-after');
    if (!raw) return null;
    let ms;
    const secs = Number(raw);
    if (Number.isFinite(secs)) {
        ms = secs * 1000;
    } else {
        const at = Date.parse(raw);
        if (!Number.isFinite(at)) return null;
        ms = at - Date.now();
    }
    return ms > 0 ? Math.min(ms, maxDelayMs) : null;
}

/**
 * Drain a response we're about to discard. undici keeps the socket checked out
 * until the body is consumed, so skipping this leaks connections on every retry.
 * Returns a short snippet for the log line.
 */
async function drain(res) {
    try {
        const text = await res.text();
        return text ? ` — ${text.slice(0, 200)}` : '';
    } catch {
        return '';
    }
}

/** Compose the caller's signal (if any) with our per-attempt timeout. */
function buildSignal(callerSignal, timeoutMs) {
    if (!timeoutMs) return callerSignal || null;
    const timeout = AbortSignal.timeout(timeoutMs);
    return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

/**
 * fetch() with bounded retry. Drop-in replacement — returns the same Response,
 * so existing `if (!res.ok)` handling at call sites keeps working unchanged.
 *
 * @param {string} url
 * @param {object} init            standard fetch init
 * @param {object} [opts]
 * @param {number} [opts.attempts=3]        total attempts, including the first
 * @param {number} [opts.baseDelayMs=800]
 * @param {number} [opts.maxDelayMs=8000]
 * @param {number} [opts.timeoutMs=0]       per-attempt timeout, 0 = none
 * @param {number} [opts.totalBudgetMs=0]   wall-clock cap on all attempts
 * @param {string} [opts.label='http']      log prefix
 */
async function fetchWithRetry(url, init = {}, opts = {}) {
    const {
        attempts       = 3,
        baseDelayMs    = 800,
        maxDelayMs     = 8000,
        timeoutMs      = 0,
        totalBudgetMs  = 0,
        label          = 'http',
    } = opts;

    const startedAt = Date.now();
    const replayable = isReplayableBody(init.body);
    const maxAttempts = replayable ? Math.max(1, attempts) : 1;

    if (!replayable && attempts > 1) {
        console.warn(`[${label}] body is not replayable (stream) — retry disabled for this call`);
    }

    // Would sleeping `wait` AND running one more full attempt overrun the budget?
    // Counting timeoutMs here is what makes the budget actually bounding: a call
    // that hung for the full per-attempt timeout won't be retried into a second
    // hang, while a fast-failing connection error still gets its retries.
    const budgetExhausted = wait =>
        totalBudgetMs > 0 && (Date.now() - startedAt + wait + timeoutMs) >= totalBudgetMs;

    for (let attempt = 1; ; attempt++) {
        const signal = buildSignal(init.signal, timeoutMs);

        try {
            const res = await fetch(url, signal ? { ...init, signal } : init);

            if (!RETRYABLE_STATUS.has(res.status) || attempt >= maxAttempts) return res;

            const wait = retryAfterMs(res, maxDelayMs) ?? backoffMs(attempt, baseDelayMs, maxDelayMs);
            if (budgetExhausted(wait)) {
                console.warn(`[${label}] HTTP ${res.status} on attempt ${attempt} — retry budget spent, returning to caller`);
                return res;
            }

            const snippet = await drain(res);
            console.warn(`[${label}] HTTP ${res.status} (attempt ${attempt}/${maxAttempts}) — retrying in ${wait}ms${snippet}`);
            await sleep(wait);

        } catch (err) {
            const kind = classifyError(err);
            if (!kind || attempt >= maxAttempts) throw err;

            const wait = backoffMs(attempt, baseDelayMs, maxDelayMs);
            if (budgetExhausted(wait)) {
                console.warn(`[${label}] ${kind} failure on attempt ${attempt} — retry budget spent, giving up`);
                throw err;
            }

            // 'inflight' means the provider may already have billed this call.
            const note = kind === 'inflight'
                ? ' (may have been processed upstream — possible duplicate spend)'
                : '';
            console.warn(`[${label}] ${kind} network failure "${err.message}" (attempt ${attempt}/${maxAttempts}) — retrying in ${wait}ms${note}`);
            await sleep(wait);
        }
    }
}

module.exports = {
    fetchWithRetry,
    // exported for unit tests
    classifyError,
    isReplayableBody,
    retryAfterMs,
    backoffMs,
    RETRYABLE_STATUS,
};
