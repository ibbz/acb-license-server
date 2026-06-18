// lib/serp.js
// SERP grounding engine for AI Content Bridge.
//
// Given a keyword, fetches the live Google top results (via Serper.dev) and
// extracts the headings the ranking pages actually use, so the outline /
// article can be grounded in real search intent instead of generated blind.
//
// Powers two things:
//   • invisible grounding  — inject competitor headings into the article prompt
//   • outline review        — return a structured, editable outline to the UI
//
// FAILS SOFT by design: if SERP_API_KEY is missing or any network step fails,
// every function resolves to null/empty so generate.js falls back to the
// existing ungrounded behaviour. SERP must never be able to break a generation.
//
//   const serp = require('./lib/serp');
//   const ground = await serp.getSerpGrounding('electric van leasing', { gl: 'uk' });

const SERPER_URL = 'https://google.serper.dev/search';
const FETCH_TIMEOUT_MS = 6000;   // per competitor page
const SERP_TIMEOUT_MS  = 7000;   // serper call
const MAX_PAGES        = 5;      // pages we fetch headings from

function enabled() {
  return !!process.env.SERP_API_KEY;
}

// fetch with a hard timeout — competitor pages are flaky, never hang a generation
async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── 1. live SERP via Serper.dev ────────────────────────────────────────────
/**
 * @returns {Promise<{organic:Array, paa:Array, related:Array}|null>}
 */
async function fetchSerp(keyword, { gl = 'us', hl = 'en', num = 10 } = {}) {
  if (!enabled() || !keyword) return null;
  try {
    const res = await fetchWithTimeout(SERPER_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: keyword, gl, hl, num }),
    }, SERP_TIMEOUT_MS);

    if (!res.ok) {
      console.warn(`[serp] Serper responded ${res.status}`);
      return null;
    }
    const data = await res.json();
    return {
      organic: Array.isArray(data.organic) ? data.organic : [],
      // "People also ask" — gold for FAQ sections / search intent
      paa: Array.isArray(data.peopleAlsoAsk) ? data.peopleAlsoAsk.map(q => q.question).filter(Boolean) : [],
      related: Array.isArray(data.relatedSearches) ? data.relatedSearches.map(r => r.query).filter(Boolean) : [],
    };
  } catch (err) {
    console.warn('[serp] Serper call failed:', err.message);
    return null;
  }
}

// ─── 2. heading extraction from a competitor page ───────────────────────────
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function extractHeadingsFromHtml(html) {
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const level = Number(m[1]);
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    // skip nav/boilerplate noise
    if (text.length >= 3 && text.length <= 120 && !/^(menu|search|share|home|skip to)/i.test(text)) {
      out.push({ level, text });
    }
    if (out.length >= 25) break;
  }
  return out;
}

async function fetchPageHeadings(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ACBBot/1.0; +https://aicontentbridge.com)' },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/html')) return null;
    const html = (await res.text()).slice(0, 600_000); // cap parse size
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      url,
      title: titleMatch ? decodeEntities(titleMatch[1]) : '',
      headings: extractHeadingsFromHtml(html),
    };
  } catch (err) {
    console.warn(`[serp] page fetch failed (${url}):`, err.message);
    return null;
  }
}

// ─── 3. the public grounding call ───────────────────────────────────────────
/**
 * Returns a compact grounding object the prompt builder can stitch in, or null.
 * {
 *   keyword, competitors:[{title,url,headings:[...]}],
 *   peopleAlsoAsk:[...], relatedSearches:[...], commonTopics:[...]
 * }
 */
async function getSerpGrounding(keyword, opts = {}) {
  const serp = await fetchSerp(keyword, opts);
  if (!serp || serp.organic.length === 0) return null;

  const top = serp.organic.slice(0, MAX_PAGES);
  const pages = (await Promise.all(top.map(r => fetchPageHeadings(r.link).catch(() => null))))
    .filter(p => p && p.headings.length);

  if (pages.length === 0 && serp.paa.length === 0) return null;

  // surface topics that recur across competitors (appear on ≥2 pages)
  const freq = {};
  pages.forEach(p => {
    const seen = new Set();
    p.headings.forEach(h => {
      const key = h.text.toLowerCase();
      if (!seen.has(key)) { freq[key] = (freq[key] || 0) + 1; seen.add(key); }
    });
  });
  const commonTopics = Object.entries(freq)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);

  return {
    keyword,
    competitors: pages.map(p => ({
      title: p.title,
      url: p.url,
      headings: p.headings.filter(h => h.level >= 2).map(h => h.text).slice(0, 12),
    })),
    peopleAlsoAsk: serp.paa.slice(0, 8),
    relatedSearches: serp.related.slice(0, 8),
    commonTopics,
  };
}

// ─── 4. render grounding into a prompt block ────────────────────────────────
// Stitched into the article/outline prompt so Claude covers what ranks + gaps.
function groundingToPromptBlock(g) {
  if (!g) return '';
  const lines = [];
  lines.push('**LIVE SEARCH GROUNDING — the pages currently ranking for this keyword cover the following.**');
  lines.push('Use this to ensure full topical coverage and to find gaps competitors miss. Do NOT copy their wording.');
  if (g.commonTopics.length) {
    lines.push(`\nTopics most competitors cover: ${g.commonTopics.join('; ')}.`);
  }
  if (g.peopleAlsoAsk.length) {
    lines.push(`\nQuestions searchers ask (People Also Ask): ${g.peopleAlsoAsk.join(' | ')}.`);
  }
  if (g.relatedSearches.length) {
    lines.push(`\nRelated searches: ${g.relatedSearches.join('; ')}.`);
  }
  lines.push('\nWrite content that comprehensively covers the common topics, answers the PAA questions where relevant, and adds genuine depth or an angle the ranking pages lack.');
  return lines.join('\n');
}

// ─── 5. structured outline for the review UI ────────────────────────────────
// Asks Claude (via the caller's existing Anthropic helper) to turn grounding
// into an editable outline. We only build the PROMPT here; the caller runs it
// through its own generateContent()/Anthropic call and JSON-parses the result.
function buildOutlinePrompt(keyword, title, g) {
  return `You are an expert SEO content strategist. Produce an outline for an article.

Title: ${title || keyword}
Focus keyword: ${keyword}

${groundingToPromptBlock(g) || 'No live search data available — use best-practice SEO structure.'}

Return ONLY valid JSON, no commentary, in exactly this shape:
{
  "suggested_title": "string — compelling, includes the keyword, <= 60 chars",
  "meta_description": "string — 140-155 chars, includes the keyword",
  "sections": [
    { "heading": "H2 heading text", "points": ["key point", "key point"] }
  ],
  "faq": ["question", "question"],
  "content_gap": "string — one angle/insight the ranking pages miss that we should own"
}`;
}

module.exports = {
  enabled,
  getSerpGrounding,
  groundingToPromptBlock,
  buildOutlinePrompt,
  // exported for unit testing
  extractHeadingsFromHtml,
  decodeEntities,
};
