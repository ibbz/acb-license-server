// lib/serp-events.js
// Time-bound event / news research for the Content Strategist.
//
// Sibling to lib/serp.js — deliberately a SEPARATE module so serp.js (which the
// proven generation + outline paths depend on) is never touched. Reuses the same
// Serper.dev conventions and the same FAIL-SOFT contract: if SERP_API_KEY is
// missing or anything throws, every function resolves to [] so the Strategist
// degrades to a plan with no event anchors rather than failing the run.
//
// What it does: given an industry + location, finds upcoming industry events
// (trade shows, conferences, expos) so the planning pass can place a "preview"
// post a week or two ahead of each one. We do NOT trust scraped dates — Serper's
// organic results rarely carry a clean, structured date — so every candidate is
// returned with unverified:true and the human confirms/edits in the review gate.
// (Matches the spec's §11 mitigation: "label event-anchored items as unverified".)

const SERPER_SEARCH = 'https://google.serper.dev/search';
const SERPER_NEWS   = 'https://google.serper.dev/news';
const TIMEOUT_MS    = 7000;
const MAX_EVENTS    = 8;

function enabled() {
  return !!process.env.SERP_API_KEY;
}

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function serperPost(url, body) {
  if (!enabled()) return null;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERP_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[serp-events] Serper ${url} responded ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[serp-events] Serper call failed:', err.message);
    return null;
  }
}

// Best-effort date sniff from a title/snippet. Returns an ISO date string if a
// confident match is found, else null. NEVER authoritative — the item stays
// unverified regardless; this only pre-fills the field to save the user typing.
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function sniffDate(text) {
  const s = String(text || '').toLowerCase();
  // e.g. "12 March 2026" / "March 12, 2026" / "12-14 May 2026" (take first day)
  let m = s.match(/(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})/);
  if (!m) m = s.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/) && (() => {
    const mm = s.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    return mm ? [mm[0], mm[2], mm[1], mm[3]] : null;
  })();
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].slice(0, 3)];
  const year = parseInt(m[3], 10);
  if (mon === undefined || !day || day > 31 || year < 2024 || year > 2100) return null;
  const d = new Date(Date.UTC(year, mon, day));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/**
 * Find upcoming events relevant to the business, inside [windowStartISO, windowEndISO].
 * @returns {Promise<Array<{name, url, snippet, date:string|null, unverified:true}>>}
 */
async function getTimeboundEvents(industry, location, windowStartISO, windowEndISO) {
  if (!enabled() || !industry) return [];

  const loc = (location || '').trim();
  const yr  = new Date(windowStartISO || Date.now()).getFullYear();
  const yrs = [yr, yr + 1].join(' OR ');

  // A couple of complementary queries — events listings + fresh news of upcoming
  // shows. gl/hl left to Serper defaults; the location is in the query text so it
  // works regardless of the SERP locale used for keyword grounding.
  const queries = [
    `${industry} trade shows conferences ${loc} ${yrs}`.trim(),
    `upcoming ${industry} events expo ${loc}`.trim(),
  ];

  const seen = new Set();
  const out  = [];

  for (const q of queries) {
    if (out.length >= MAX_EVENTS) break;
    const search = await serperPost(SERPER_SEARCH, { q, num: 10 });
    const organic = search && Array.isArray(search.organic) ? search.organic : [];
    for (const r of organic) {
      const name = (r.title || '').trim();
      const key  = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        url: r.link || '',
        snippet: r.snippet || '',
        date: sniffDate(`${name} ${r.snippet || ''}`),
        unverified: true,
      });
      if (out.length >= MAX_EVENTS) break;
    }
  }

  // Fold in a news pass for very fresh announcements (best-effort, never fatal).
  if (out.length < MAX_EVENTS) {
    const news = await serperPost(SERPER_NEWS, { q: `${industry} ${loc} event ${yr}`.trim(), num: 10 });
    const items = news && Array.isArray(news.news) ? news.news : [];
    for (const r of items) {
      const name = (r.title || '').trim();
      const key  = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        url: r.link || '',
        snippet: r.snippet || '',
        date: sniffDate(`${name} ${r.snippet || ''}`),
        unverified: true,
      });
      if (out.length >= MAX_EVENTS) break;
    }
  }

  return out;
}

module.exports = { enabled, getTimeboundEvents, sniffDate };
