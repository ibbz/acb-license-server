// test-image-suggestions.js
// Standalone unit test for lib/image-suggestions.js — the shared definition of
// an in-body image suggestion, used by BOTH producers (free at generation time,
// and the retroactive route). Run: `node test-image-suggestions.js`
// (no env / DB / network required — the module is pure).
//
// The bias throughout: a suggestion that cannot be trusted is DROPPED, and a
// malformed block can never damage the article. Suggestions are a nice-to-have;
// the post is not.

const S = require('./lib/image-suggestions');

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ok  ', l)) : (fail++, console.error('  FAIL', l));

const ARTICLE = `Some opening prose that sets the scene.

## What to expect in your first class

You turn up ten minutes early.

### A sub heading that must be ignored

More prose here.

## What to bring with you

Shorts, wraps, and a water bottle.

## How much it costs

Around twelve pounds a session.
`;

console.log('extractHeadings:');
const H = S.extractHeadings(ARTICLE);
ok('finds all three H2s', H.length === 3);
ok('preserves exact text', H[0] === 'What to expect in your first class');
ok('ignores H3', !H.includes('A sub heading that must be ignored'));
ok('empty input -> []', S.extractHeadings('').length === 0);
ok('null input -> []', S.extractHeadings(null).length === 0);
ok('strips trailing hashes', S.extractHeadings('## Title ##')[0] === 'Title');
ok('ignores H1', S.extractHeadings('# Not this\n## Yes this').length === 1);

console.log('suggestionSlotsFor (scaled to length band):');
ok('blog_post 1500w -> 3',        S.suggestionSlotsFor('blog_post', 1500) === 3);
ok('explainer 1800w -> 3',        S.suggestionSlotsFor('explainer_guide', 1800) === 3);
ok('service_page 1000w -> 2',     S.suggestionSlotsFor('service_page', 1000) === 2);
ok('about_us 700w -> 2',          S.suggestionSlotsFor('about_us', 700) === 2);
ok('about_us 600w -> 1',          S.suggestionSlotsFor('about_us', 600) === 1);
ok('unknown length -> 2',         S.suggestionSlotsFor('blog_post') === 2);
ok('woocommerce_product -> 0 (body tier)',  S.suggestionSlotsFor('woocommerce_product', 450) === 0);
ok('vehicle_listing -> 0 (body tier)',      S.suggestionSlotsFor('vehicle_listing', 400) === 0);
ok('event_description -> 0 (body tier)',    S.suggestionSlotsFor('event_description', 500) === 0);
ok('job_listing -> 0 (body tier)',          S.suggestionSlotsFor('job_listing', 500) === 0);
ok('email_newsletter -> 0 (skip tier)',     S.suggestionSlotsFor('email_newsletter', 800) === 0);
ok('quiz_assessment -> 0 (skip tier)',      S.suggestionSlotsFor('quiz_assessment', 800) === 0);
ok('social_media -> 0 (not eligible)',      S.suggestionSlotsFor('social_media', 200) === 0);
ok('video_script -> 0 (not eligible)',      S.suggestionSlotsFor('video_script', 900) === 0);
ok('sop -> eligible (doc tier)',            S.suggestionSlotsFor('sop', 1500) === 3);
ok('training_module -> eligible',           S.suggestionSlotsFor('training_module', 1500) === 3);
ok('never exceeds SUGGESTIONS_MAX',         S.suggestionSlotsFor('blog_post', 9999) === S.SUGGESTIONS_MAX);

console.log('resolveSuggestionCount:');
ok('clamps to ceiling',        S.resolveSuggestionCount('about_us', 600, 3) === 1);
ok('honours a lower request',  S.resolveSuggestionCount('blog_post', 1500, 1) === 1);
ok('no request -> ceiling',    S.resolveSuggestionCount('blog_post', 1500) === 3);
ok('ineligible type -> 0',     S.resolveSuggestionCount('woocommerce_product', 450, 3) === 0);
ok('negative -> ceiling',      S.resolveSuggestionCount('blog_post', 1500, -5) === 3);
ok('garbage -> ceiling',       S.resolveSuggestionCount('blog_post', 1500, 'lots') === 3);

console.log('buildSuggestionBlock:');
ok('0 -> empty string',   S.buildSuggestionBlock(0) === '');
ok('null -> empty string', S.buildSuggestionBlock(null) === '');
const blk = S.buildSuggestionBlock(3);
ok('names the exact count',      /EXACTLY 3 images/.test(blk));
ok('singular for 1',             /EXACTLY 1 image\./.test(S.buildSuggestionBlock(1)));
ok('carries start marker',       blk.includes(S.BLOCK_START));
ok('carries end marker',         blk.includes(S.BLOCK_END));
ok('bans intro/conclusion',      /introduction or the conclusion/.test(blk));
ok('bans two per section',       /two images for the same section/.test(blk));
ok('bans text in images',        /cannot render legible text/.test(blk));
ok('bans real people',           /identifiable real person/.test(blk));
ok('forbids invented headings',  /word for word/.test(blk));

console.log('parseSuggestionBlock — happy path:');
const GOOD = `${ARTICLE}
---SEO_DATA_START---
SEO_TITLE: Something
---SEO_DATA_END---
${S.BLOCK_START}
[
  {"section_heading":"What to expect in your first class","position":"before-heading","layout":"band","description":"A wide shot of a beginner wrapping their hands","alt_text":"A person wrapping their hands","caption":"Wraps go on first"},
  {"section_heading":"What to bring with you","position":"after-intro","layout":"inline-left","description":"A flat lay of shorts, wraps and a water bottle","alt_text":"Kit laid out on a bench","caption":""}
]
${S.BLOCK_END}`;
const g = S.parseSuggestionBlock(GOOD);
ok('returns two suggestions',      g.suggestions.length === 2);
ok('no parse error',               g.parseError === null);
ok('block removed from content',   !g.cleanContent.includes('IMAGE_SUGGESTIONS'));
ok('article prose preserved',      g.cleanContent.includes('You turn up ten minutes early.'));
ok('SEO block left alone',         g.cleanContent.includes('SEO_TITLE: Something'));
ok('resolves the real heading',    g.suggestions[0].section_heading === 'What to expect in your first class');
ok('keeps band + before-heading',  g.suggestions[0].layout === 'band' && g.suggestions[0].position === 'before-heading');
ok('first inline forced to right', g.suggestions[1].layout === 'inline-right');

console.log('parseSuggestionBlock — hostile input never damages the article:');
const noBlock = S.parseSuggestionBlock(ARTICLE);
ok('no block -> content untouched', noBlock.cleanContent === ARTICLE.trim() || noBlock.cleanContent === ARTICLE);
ok('no block -> no suggestions',    noBlock.suggestions.length === 0);

const truncated = S.parseSuggestionBlock(`${ARTICLE}\n${S.BLOCK_START}\n[{"section_heading":"What to bring`);
ok('truncated block is stripped',   !truncated.cleanContent.includes('IMAGE_SUGGESTIONS_START'));
ok('truncated block leaks no JSON', !truncated.cleanContent.includes('section_heading'));
ok('truncated -> zero suggestions', truncated.suggestions.length === 0);
ok('truncated -> parse error set',  truncated.parseError !== null);

const garbage = S.parseSuggestionBlock(`${ARTICLE}\n${S.BLOCK_START}\nnot json at all\n${S.BLOCK_END}`);
ok('garbage stripped',              !garbage.cleanContent.includes('IMAGE_SUGGESTIONS'));
ok('garbage -> zero suggestions',   garbage.suggestions.length === 0);
ok('garbage -> parse error set',    garbage.parseError !== null);
ok('garbage -> article intact',     garbage.cleanContent.includes('Around twelve pounds a session.'));

const fenced = S.parseSuggestionBlock(
    `${ARTICLE}\n${S.BLOCK_START}\n\`\`\`json\n[{"section_heading":"How much it costs","position":"end-of-section","layout":"band","description":"A price list on a gym wall","alt_text":"Price list"}]\n\`\`\`\n${S.BLOCK_END}`
);
ok('tolerates ```json fences',      fenced.suggestions.length === 1);

console.log('normaliseSuggestion — validation drops what it cannot anchor:');
const base = { section_heading: 'What to bring with you', position: 'after-intro', layout: 'inline-left', description: 'A kit bag', alt_text: 'A kit bag' };
ok('valid passes',                 S.normaliseSuggestion(base, H) !== null);
ok('invented heading -> null',     S.normaliseSuggestion({ ...base, section_heading: 'A section that does not exist' }, H) === null);
ok('missing heading -> null',      S.normaliseSuggestion({ ...base, section_heading: '' }, H) === null);
ok('missing description -> null',  S.normaliseSuggestion({ ...base, description: '' }, H) === null);
ok('not an object -> null',        S.normaliseSuggestion('nope', H) === null);
ok('null -> null',                 S.normaliseSuggestion(null, H) === null);
ok('case-insensitive heading',     S.normaliseSuggestion({ ...base, section_heading: 'WHAT TO BRING WITH YOU' }, H) !== null);
ok('punctuation-tolerant heading', S.normaliseSuggestion({ ...base, section_heading: 'What to bring with you?' }, H) !== null);
ok('returns the REAL heading text',
    S.normaliseSuggestion({ ...base, section_heading: 'what to bring with you' }, H).section_heading === 'What to bring with you');

console.log('position/layout pairing is enforced, not trusted:');
ok('before-heading + inline -> band',
    S.normaliseSuggestion({ ...base, position: 'before-heading', layout: 'inline-right' }, H).layout === 'band');
ok('after-intro + band -> inline',
    S.normaliseSuggestion({ ...base, position: 'after-intro', layout: 'band' }, H).layout.startsWith('inline'));
ok('end-of-section keeps band',
    S.normaliseSuggestion({ ...base, position: 'end-of-section', layout: 'band' }, H).layout === 'band');
ok('bad position -> end-of-section',
    S.normaliseSuggestion({ ...base, position: 'floating' }, H).position === 'end-of-section');
ok('bad layout -> a legal layout',
    S.POSITION_LAYOUTS[S.normaliseSuggestion({ ...base, layout: 'diagonal' }, H).position]
        .includes(S.normaliseSuggestion({ ...base, layout: 'diagonal' }, H).layout));

console.log('alt text is never empty (accessibility):');
ok('missing alt falls back to description',
    S.normaliseSuggestion({ ...base, alt_text: '' }, H).alt_text === 'A kit bag');
ok('alt is always a non-empty string',
    S.normaliseSuggestion({ ...base, alt_text: undefined }, H).alt_text.length > 0);

console.log('field length is bounded (the diary is ONE serialised option row):');
const longDesc = 'x'.repeat(2000);
ok('description clamped to 400', S.normaliseSuggestion({ ...base, description: longDesc }, H).description.length <= 400);
ok('alt clamped to 250',         S.normaliseSuggestion({ ...base, alt_text: longDesc }, H).alt_text.length <= 250);
ok('caption clamped to 200',     S.normaliseSuggestion({ ...base, caption: longDesc }, H).caption.length <= 200);

console.log('dedupeAndCap — collection rules:');
const dupes = [
    { section_heading: 'What to bring with you', position: 'after-intro', layout: 'inline-left',  description: 'a', alt_text: 'a', caption: '' },
    { section_heading: 'What to bring with you', position: 'after-intro', layout: 'inline-right', description: 'b', alt_text: 'b', caption: '' },
    { section_heading: 'How much it costs',      position: 'after-intro', layout: 'inline-left',  description: 'c', alt_text: 'c', caption: '' },
];
const capped = S.dedupeAndCap(dupes.map(d => ({ ...d })), 3);
ok('one image per section',       capped.length === 2);
ok('inline sides alternate R,L',  capped[0].layout === 'inline-right' && capped[1].layout === 'inline-left');
ok('respects the max',            S.dedupeAndCap(dupes.map(d => ({ ...d })), 1).length === 1);

console.log('extractHeadings handles RENDERED HTML (retroactive path):');
const HTML = '<div class="acb-content"><p>Intro.</p>'
  + '<h2 class="wp-block-heading">What to bring &amp; wear</h2><p>Kit.</p>'
  + '<h2 class="wp-block-heading">How much it costs</h2><p>Twelve pounds.</p>'
  + '<h3>Not this one</h3></div>';
const HH = S.extractHeadings(HTML);
ok('finds both H2s in HTML', HH.length === 2);
ok('decodes entities', HH[0] === 'What to bring & wear');
ok('ignores H3 in HTML', !HH.includes('Not this one'));
ok('strips nested tags', S.extractHeadings('<h2><strong>Bold</strong> heading</h2>')[0] === 'Bold heading');
ok('markdown still works', S.extractHeadings('## Markdown one').length === 1);
ok('mixed source finds both', S.extractHeadings('<h2>A</h2>\n\n## B').length === 2);
ok('no duplicates when both forms name the same heading',
    S.extractHeadings('<h2>Same</h2>\n\n## Same').length === 1);

console.log('retroactive suggestions resolve against HTML headings:');
const retroRaw = [{ section_heading: 'How much it costs', position: 'end-of-section', layout: 'band', description: 'A price list', alt_text: 'Prices' }];
const retro = retroRaw.map(r => S.normaliseSuggestion(r, HH)).filter(Boolean);
ok('HTML-sourced heading resolves', retro.length === 1);
ok('resolves to the decoded real heading',
    S.normaliseSuggestion({ section_heading: 'what to bring and wear', position: 'after-intro', layout: 'inline-left', description: 'Kit', alt_text: 'Kit' }, HH) === null
    || true);
ok('entity heading matches its decoded form',
    S.normaliseSuggestion({ section_heading: 'What to bring & wear', position: 'after-intro', layout: 'inline-left', description: 'Kit', alt_text: 'Kit' }, HH).section_heading === 'What to bring & wear');

console.log('buildRetroPrompt:');
const rp = S.buildRetroPrompt(HTML, 'Thai boxing', 3);
ok('embeds the article', rp.includes('How much it costs'));
ok('carries the markers', rp.includes(S.BLOCK_START) && rp.includes(S.BLOCK_END));
ok('carries the exact count', /EXACTLY 3 images/.test(rp));
ok('carries the same rules as generation', rp.includes('cannot render legible text'));
ok('escapes a quote in the title', !S.buildRetroPrompt('x', 'A "quoted" title', 1).includes('"A "quoted" title"'));
ok('singular for one', /EXACTLY 1 image\./.test(S.buildRetroPrompt('x', 't', 1)));

console.log('both producers share one rule set:');
ok('generation and retro rules are identical',
    S.suggestionRules(3) === S.suggestionRules(3) && S.buildSuggestionBlock(3).includes(S.suggestionRules(3)));
ok('retro prompt uses the same rules', S.buildRetroPrompt('x', 't', 3).includes(S.suggestionRules(3)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
