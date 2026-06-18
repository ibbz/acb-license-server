// lib/seo-score.js
// Deterministic, dependency-free SEO scorer for AI Content Bridge.
//
// Runs server-side in generate.js after the article is produced, so every
// generation returns a 0-100 SEO score + a Yoast/Rank-Math-style checklist
// with actionable fixes. No external API, no marginal cost, instant.
//
// Mirrors the checks an SEO plugin would run, but in ACB's own workflow and
// across ALL content types — not just blog posts.
//
//   const { scoreSeo, parseSeoBlock } = require('./lib/seo-score');
//   const seo = scoreSeo({ content, title, metaTitle, metaDescription,
//                          focusKeyword, targetWordCount, hasImage, videoCount });

// ─── tunables ─────────────────────────────────────────────────────────────
// Each check carries a weight; the score is the weighted % of points earned.
// A 'warn' earns half its weight, a 'fail' earns none, a 'pass' earns all.
const CHECKS = {
  keyword_set:        { weight: 6,  label: 'Focus keyword is set' },
  keyword_in_title:   { weight: 12, label: 'Keyword in SEO title' },
  keyword_in_meta:    { weight: 8,  label: 'Keyword in meta description' },
  keyword_early:      { weight: 10, label: 'Keyword in opening paragraph' },
  keyword_in_heading: { weight: 8,  label: 'Keyword in a subheading' },
  keyword_density:    { weight: 8,  label: 'Keyword density in range' },
  title_length:       { weight: 8,  label: 'SEO title length (30–60 chars)' },
  meta_length:        { weight: 8,  label: 'Meta description length (120–160)' },
  word_count:         { weight: 10, label: 'Content length meets target' },
  headings:           { weight: 8,  label: 'Has subheading structure' },
  links:              { weight: 6,  label: 'Contains at least one link' },
  readability:        { weight: 6,  label: 'Readable (Flesch ≥ 50)' },
  media:              { weight: 2,  label: 'Has featured image or video' },
};

const DENSITY_MIN = 0.4;   // %
const DENSITY_MAX = 2.8;   // %  (above this → keyword stuffing warning)
const DENSITY_STUFF = 3.5; // %  hard fail

// ─── small text helpers ─────────────────────────────────────────────────────

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

// Strip the SEO_DATA block, markdown syntax, code fences and HTML to plain prose.
function toPlainText(markdown) {
  let t = String(markdown || '');
  t = t.replace(/-{3,}\s*SEO_DATA_START-{3,}[\s\S]*?-{3,}\s*SEO_DATA_END-{3,}/g, '');
  t = t.replace(/-{3,}\s*QUIZ_DATA_START-{3,}[\s\S]*?-{3,}\s*QUIZ_DATA_END-{3,}/g, '');
  t = t.replace(/```[\s\S]*?```/g, ' ');          // code fences
  t = t.replace(/`[^`]*`/g, ' ');                  // inline code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');     // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // links → keep anchor text
  t = t.replace(/<[^>]+>/g, ' ');                  // raw HTML
  t = t.replace(/[#>*_~|]/g, ' ');                 // md punctuation
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function words(plain) {
  const m = norm(plain).match(/[a-z0-9']+/g);
  return m || [];
}

function sentences(plain) {
  return (plain.match(/[^.!?]+[.!?]+/g) || [plain]).filter(s => s.trim().length > 0);
}

// Count occurrences of a (possibly multi-word) keyword in normalised text.
function countKeyword(plain, keyword) {
  const kw = norm(keyword).trim();
  if (!kw) return 0;
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${esc}\\b`, 'g');
  return (norm(plain).match(re) || []).length;
}

// Loose keyword presence: exact phrase OR all keyword tokens present nearby.
function keywordIn(text, keyword) {
  const t = norm(text);
  const kw = norm(keyword).trim();
  if (!kw) return false;
  if (t.includes(kw)) return true;
  const tokens = kw.split(/\s+/).filter(w => w.length > 2);
  if (tokens.length < 2) return false;
  return tokens.every(tok => t.includes(tok));
}

function extractHeadings(markdown) {
  const out = [];
  const re = /^\s{0,3}(#{2,4})\s+(.+?)\s*#*\s*$/gm;
  let m;
  while ((m = re.exec(String(markdown || '')))) out.push(m[2].trim());
  return out;
}

function countLinks(markdown) {
  const md = String(markdown || '');
  const mdLinks = (md.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) || []).length;
  const htmlLinks = (md.match(/<a\s[^>]*href=/gi) || []).length;
  return mdLinks + htmlLinks;
}

// Rough syllable estimate for Flesch — good enough for a readability band.
function syllables(word) {
  const w = word.replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

// Flesch Reading Ease: 206.835 - 1.015(words/sentence) - 84.6(syllables/word).
function fleschReadingEase(plain) {
  const ws = words(plain);
  const ss = sentences(plain);
  if (ws.length < 20 || ss.length === 0) return 60; // too short to judge — neutral
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  const score = 206.835 - 1.015 * (ws.length / ss.length) - 84.6 * (syl / ws.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── SEO_DATA block parser (so generate.js can score what Claude emitted) ───
// Server-side mirror of the plugin's regex parse. Returns {} if no block.
function parseSeoBlock(rawText) {
  const t = String(rawText || '');
  const block = t.match(/-{3,}\s*SEO_DATA_START-{3,}([\s\S]*?)-{3,}\s*SEO_DATA_END-{3,}/);
  if (!block) return {};
  const body = block[1];
  const grab = (key) => {
    const m = body.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
    return m ? m[1].trim() : '';
  };
  return {
    metaTitle:       grab('SEO_TITLE'),
    metaDescription: grab('SEO_DESCRIPTION'),
    focusKeyword:    grab('SEO_FOCUS_KEYWORD'),
    ogTitle:         grab('SEO_OG_TITLE'),
    ogDescription:   grab('SEO_OG_DESCRIPTION'),
  };
}

// ─── the scorer ─────────────────────────────────────────────────────────────
/**
 * @param {object} input
 *   content          markdown article (SEO/quiz blocks tolerated)
 *   title            the post H1 / title
 *   metaTitle        SEO meta title
 *   metaDescription  SEO meta description
 *   focusKeyword     focus keyword/keyphrase
 *   targetWordCount  desired length (optional; default 600)
 *   hasImage         boolean — featured image attached
 *   videoCount       number of embedded videos
 * @returns {object} { score, grade, checks[], stats }
 */
function scoreSeo(input = {}) {
  const {
    content = '',
    title = '',
    metaTitle = '',
    metaDescription = '',
    focusKeyword = '',
    targetWordCount = 600,
    hasImage = false,
    videoCount = 0,
  } = input;

  const plain = toPlainText(content);
  const ws = words(plain);
  const wordCount = ws.length;
  const headings = extractHeadings(content);
  const linkCount = countLinks(content);
  const kwCount = countKeyword(plain, focusKeyword);
  const density = wordCount ? (kwCount / wordCount) * 100 : 0;
  const flesch = fleschReadingEase(plain);
  const firstChunk = ws.slice(0, Math.max(50, Math.round(wordCount * 0.12))).join(' ');

  const results = {};
  const set = (id, status, detail, fix) => { results[id] = { status, detail, fix }; };

  // keyword present at all
  set('keyword_set',
    focusKeyword ? 'pass' : 'fail',
    focusKeyword ? `Focus keyword: “${focusKeyword}”` : 'No focus keyword set',
    'Set a focus keyword so the rest of the SEO checks can run.');

  // keyword in title
  set('keyword_in_title',
    keywordIn(metaTitle || title, focusKeyword) ? 'pass' : 'fail',
    keywordIn(metaTitle || title, focusKeyword) ? 'Keyword appears in the SEO title' : 'Keyword missing from the SEO title',
    'Work the focus keyword into the SEO title, ideally near the front.');

  // keyword in meta description
  set('keyword_in_meta',
    keywordIn(metaDescription, focusKeyword) ? 'pass' : 'warn',
    keywordIn(metaDescription, focusKeyword) ? 'Keyword appears in the meta description' : 'Keyword missing from the meta description',
    'Include the focus keyword once in the meta description.');

  // keyword early in body
  set('keyword_early',
    keywordIn(firstChunk, focusKeyword) ? 'pass' : 'warn',
    keywordIn(firstChunk, focusKeyword) ? 'Keyword used in the opening' : 'Keyword not found in the first paragraph',
    'Mention the focus keyword within the first ~100 words.');

  // keyword in a subheading
  const inHeading = headings.some(h => keywordIn(h, focusKeyword));
  set('keyword_in_heading',
    inHeading ? 'pass' : 'warn',
    inHeading ? 'Keyword used in a subheading' : 'No subheading contains the keyword',
    'Use the focus keyword (or a close variant) in at least one H2/H3.');

  // density
  let densityStatus = 'pass';
  if (!focusKeyword || density === 0) densityStatus = 'fail';
  else if (density < DENSITY_MIN) densityStatus = 'warn';
  else if (density > DENSITY_STUFF) densityStatus = 'fail';
  else if (density > DENSITY_MAX) densityStatus = 'warn';
  set('keyword_density',
    densityStatus,
    `Density ${density.toFixed(2)}% (${kwCount}× in ${wordCount} words)`,
    density > DENSITY_MAX
      ? 'Ease off the keyword — aim for roughly 0.5–2.5%.'
      : 'Use the keyword a few more times naturally — aim for ~0.5–2.5%.');

  // title length
  const tLen = (metaTitle || title).length;
  set('title_length',
    tLen >= 30 && tLen <= 60 ? 'pass' : (tLen > 0 && tLen <= 70 ? 'warn' : 'fail'),
    `SEO title is ${tLen} characters`,
    tLen > 60 ? 'Trim the SEO title to 60 characters or fewer.' : 'Lengthen the SEO title to 30–60 characters.');

  // meta length
  const dLen = metaDescription.length;
  set('meta_length',
    dLen >= 120 && dLen <= 160 ? 'pass' : (dLen >= 80 && dLen <= 175 ? 'warn' : 'fail'),
    `Meta description is ${dLen} characters`,
    dLen > 160 ? 'Trim the meta description to ~155 characters.' : 'Aim for a 140–155 character meta description.');

  // word count vs target
  const target = targetWordCount || 600;
  const ratio = target ? wordCount / target : 1;
  set('word_count',
    ratio >= 0.85 ? 'pass' : (ratio >= 0.6 ? 'warn' : 'fail'),
    `${wordCount} words (target ~${target})`,
    'Expand the content to better match the target length.');

  // heading structure
  set('headings',
    headings.length >= 3 ? 'pass' : (headings.length >= 1 ? 'warn' : 'fail'),
    `${headings.length} subheading${headings.length === 1 ? '' : 's'}`,
    'Break the content up with at least 3 descriptive subheadings.');

  // links
  set('links',
    linkCount >= 1 ? 'pass' : 'warn',
    `${linkCount} link${linkCount === 1 ? '' : 's'} found`,
    'Add at least one relevant internal or external link.');

  // readability
  set('readability',
    flesch >= 50 ? 'pass' : (flesch >= 35 ? 'warn' : 'fail'),
    `Flesch reading ease ${flesch}`,
    'Shorten sentences and simplify wording to improve readability.');

  // media
  set('media',
    (hasImage || videoCount > 0) ? 'pass' : 'warn',
    hasImage ? 'Featured image present' : (videoCount > 0 ? `${videoCount} video(s) embedded` : 'No image or video'),
    'Add a featured image or an embedded video.');

  // ─── tally weighted score ───
  let earned = 0, total = 0;
  const checks = Object.keys(CHECKS).map(id => {
    const def = CHECKS[id];
    const r = results[id] || { status: 'fail', detail: '', fix: '' };
    const pts = r.status === 'pass' ? def.weight : r.status === 'warn' ? def.weight / 2 : 0;
    earned += pts; total += def.weight;
    return { id, label: def.label, status: r.status, weight: def.weight, detail: r.detail, fix: r.fix };
  });

  const score = total ? Math.round((earned / total) * 100) : 0;
  const grade = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'ok' : 'poor';

  // sort: failures first, then warnings, then passes — so the UI shows fixes up top
  const order = { fail: 0, warn: 1, pass: 2 };
  checks.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);

  return {
    score,
    grade,
    checks,
    stats: {
      wordCount,
      keywordCount: kwCount,
      keywordDensity: Number(density.toFixed(2)),
      fleschReadingEase: flesch,
      headingCount: headings.length,
      linkCount,
      metaTitleLength: tLen,
      metaDescriptionLength: dLen,
    },
  };
}

module.exports = { scoreSeo, parseSeoBlock, toPlainText };
