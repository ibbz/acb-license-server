/**
 * lib/image-suggestions.js
 *
 * AICOBR_INBODY_IMAGES_2026_08
 *
 * The single definition of what an in-body image suggestion IS. Two producers
 * emit them and both go through this module, so they cannot drift:
 *
 *   1. AT GENERATION (free). routes/generate.js appends buildSuggestionBlock()
 *      to the article prompt; the model returns a fenced block alongside the
 *      SEO block, which parseSuggestionBlock() extracts and strips. There is NO
 *      second API call and NO extra credit — the model has already read the
 *      article it just wrote, which is also why its placement is better than
 *      anything a later pass could infer.
 *
 *   2. RETROACTIVELY. routes/image-suggestions.js runs one small Claude call
 *      over an EXISTING article for the back catalogue. Same block, same
 *      parser, same normalisation.
 *
 * A suggestion is a DESCRIPTION, never an image. Nothing here spends money on
 * OpenAI. The user clicks a suggestion in the image modal, which populates the
 * existing prompt box, and only then does a 1-credit generation happen. That
 * separation is deliberate: suggestions are free to browse, generation is not.
 *
 * Pure module: no DB, no network, no env. Unit-tested standalone in
 * test-image-suggestions.js, same convention as lib/pricing.js.
 */

const { LAYOUTS, DEFAULT_LAYOUT, isValidLayout } = require('./image-gen');

// Hard ceiling regardless of content type or what the user asked for. Three
// images in a 1,500-word article is roughly one every four or five hundred
// words, which breaks up the wall without turning the piece into a gallery.
const SUGGESTIONS_MAX = 3;

// Where a figure may sit relative to its section, and which layouts each
// position can legally carry. `before-heading` with a float is rejected because
// a floated figure above a heading has nothing to wrap against — it is the
// ugliest failure this feature can produce, so it is made unrepresentable.
// AICOBR_INBODY_POSITION_2026_08
// Reduced to ONE position, deliberately.
//
// 'before-heading' and 'end-of-section' both place a figure with no body text
// following it inside that section — and .acb-content h2/h3 carry `clear: both`
// so the next heading drops below the float. The result is a left- or
// right-aligned image sitting alone on its own row with a blank column beside
// it, which is worse than no image at all.
//
// AICOBR_INBODY_AFTER_HEADING_2026_08: the survivor places the figure directly
// beneath its heading, before the first paragraph, so the ENTIRE section body
// wraps around it. The earlier variant sat after the opening paragraph, which
// left that paragraph full width and gave the float less text to wrap. The old
// key 'after-intro' expressed the same intent and is still honoured by
// aicobr_insert_figure(), so images placed before this change land in the
// improved position rather than needing a migration.
//
// Kept as a MAP rather than collapsed to a constant so the position field stays
// in the data model: entries generated before this change still carry the old
// values, and aicobr_insert_figure() still understands all three so those keep
// working. We simply stop producing new ones.
//
// 'band' remains legal here: a full-width image after a section's opening
// paragraph reads fine, and the free tier depends on it — gpt-image-1-mini has
// no priced portrait row, so every free-tier inline request resolves to a band.
const POSITION_LAYOUTS = {
    'after-heading': ['band', 'inline-left', 'inline-right'],
};
const DEFAULT_POSITION = 'after-heading';
const POSITIONS = Object.keys(POSITION_LAYOUTS);

// Content types eligible for in-body images. This MIRRORS the 'article' and
// 'doc' tiers of AICOBR_Content_Formatter::tier() in the plugin — the types
// where ACB owns the page layout. The 'body' tier (WooCommerce product, vehicle
// listing, event description, job listing) and the 'skip' tier (email
// newsletter, quiz) are excluded: a destination template owns those pages, and
// a floated figure in a product description is simply wrong.
//
// If AICOBR_Content_Formatter::tier() changes, change this to match. The two
// lists are asserted against each other by hand at review time; there is no
// runtime link because one is PHP and one is Node.
const IMAGE_SUGGESTION_TYPES = new Set([
    // article tier
    'blog_post', 'tutorial', 'faq_page', 'review_comparison', 'explainer_guide',
    'service_page', 'landing_page', 'about_us', 'press_release',
    // doc tier
    'policy_procedure', 'sop', 'onboarding_doc', 'workshop_guide',
    'course_overview', 'training_module', 'case_study_ld',
]);

/**
 * How many suggestions a content type should offer.
 *
 * Scaled to the piece's length band rather than fixed, because three images in
 * a 700-word About Us page is a slideshow with captions, not an article. Uses
 * the resolved word count when the caller has one (it already clamps to the
 * type's band in content-types.js), falling back to the type alone.
 *
 * Returns 0 for ineligible types, which is the signal not to emit the prompt
 * block at all.
 */
function suggestionSlotsFor(contentType, effectiveWordCount) {
    if (!IMAGE_SUGGESTION_TYPES.has(contentType)) return 0;

    const words = parseInt(effectiveWordCount, 10);
    if (!words || isNaN(words)) return 2; // unknown length — a safe middle

    if (words < 700)  return 1;
    if (words < 1400) return 2;
    return SUGGESTIONS_MAX;
}

/** Clamp any requested count into [0, slots available for this type]. */
function resolveSuggestionCount(contentType, effectiveWordCount, requested) {
    const ceiling = suggestionSlotsFor(contentType, effectiveWordCount);
    if (ceiling === 0) return 0;
    const n = parseInt(requested, 10);
    if (!n || isNaN(n) || n < 0) return ceiling;
    return Math.max(0, Math.min(ceiling, n));
}

// Markers, deliberately shaped like the existing ---SEO_DATA_START--- block so
// the model treats it as the same kind of trailing metadata and the PHP side
// has an identical stripping pattern to copy.
const BLOCK_START = '---IMAGE_SUGGESTIONS_START---';
const BLOCK_END   = '---IMAGE_SUGGESTIONS_END---';

/**
 * The prompt block appended to a generation. Returns '' when count is 0, so a
 * caller can concatenate unconditionally.
 *
 * The constraints here are load-bearing, exactly as in the <internal_link>
 * block: without "one per section" the model clusters every image in the first
 * two sections; without the intro/conclusion ban it puts a picture above the
 * first paragraph, which is where the featured image already is.
 */
function suggestionRules(n) {
    return `**IMAGE SUGGESTION RULES:**
- Suggest EXACTLY ${n} image${n === 1 ? '' : 's'}. No more, no fewer.
- "section_heading" MUST copy an existing heading from the article word for word. Do not invent one, do not paraphrase, do not use the article title.
- Never suggest two images for the same section.
- Never suggest an image for the introduction or the conclusion — the article already has a lead image above it.
- "position" is ALWAYS "after-heading". There is no other option — the image sits directly under its section heading so the section's text wraps around it.
- PREFER the inline layouts. "inline-left" and "inline-right" are narrow images that body text wraps around, and they read far better inside an article than a full-width band does.
- Use "band" (full width) SPARINGLY: at most one per article, and only when the image genuinely deserves the whole column, such as a wide scene or a before/after.
- Alternate "inline-left" and "inline-right" if you suggest more than one inline image.
- Choose sections that have at least two paragraphs of prose, so there is enough text for the image to sit beside.
- "description" must describe a REAL, photographable or illustratable scene tied to what that section actually says. Not a concept, not a metaphor, not "an image representing growth".
- Never suggest an image containing text, charts, diagrams, logos or user-interface screenshots — the image model cannot render legible text.
- Never describe a specific identifiable real person.
- Output valid JSON only. No trailing commas, no comments.`;
}

const SCHEMA_EXAMPLE = `[
  {
    "section_heading": "the EXACT text of one section heading from the article",
    "position": "after-heading",
    "layout": "band | inline-left | inline-right",
    "description": "what the picture shows, in plain language, as you would brief a photographer",
    "alt_text": "a literal description of the image for a screen-reader user",
    "caption": "a short caption that adds something the image alone does not say"
  }
]`;

/**
 * Prompt block appended to a GENERATION (producer 1). Returns '' when the count
 * is 0, so a caller can concatenate unconditionally.
 */
function buildSuggestionBlock(count) {
    const n = parseInt(count, 10);
    if (!n || n < 1) return '';

    return `

**AFTER THE SEO BLOCK — output this exact block with no extra commentary:**

${BLOCK_START}
${SCHEMA_EXAMPLE}
${BLOCK_END}

${suggestionRules(n)}`;
}

/**
 * Standalone prompt for the RETROACTIVE pass (producer 2) — one small Claude
 * call over an article that already exists, for the back catalogue.
 *
 * The article is passed as rendered HTML (post_content). The model is told to
 * read headings from it verbatim, and normaliseSuggestion validates every
 * returned heading against the real ones anyway, so a paraphrase is dropped
 * rather than producing an anchor the insertion step cannot find.
 */
function buildRetroPrompt(article, title, count) {
    const n = parseInt(count, 10) || SUGGESTIONS_MAX;
    return `You are choosing photographs to illustrate an article that has already been written and published.

<article title="${String(title || '').replace(/"/g, "'")}">
${String(article || '')}
</article>

Read the article above and suggest ${n} image${n === 1 ? '' : 's'} that would genuinely help a reader — breaking up long stretches of text and showing what the writing describes.

Respond with ONLY a JSON array in exactly this shape, wrapped in the markers:

${BLOCK_START}
${SCHEMA_EXAMPLE}
${BLOCK_END}

${suggestionRules(n)}`;
}

/** Strip ```json fences and pull the first JSON array out of a loose string. */
function parseJsonArrayLoose(text) {
    let t = String(text || '').trim().replace(/```json\s*|\s*```/g, '');
    const start = t.indexOf('[');
    const end   = t.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        const parsed = JSON.parse(t.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

/** Collapse a heading to a comparable form (case, punctuation and spacing). */
function normaliseHeading(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[#*_`]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Every ## heading in a markdown article, in document order. Used to validate
 * that a suggestion points at a section that genuinely exists — the model will
 * otherwise occasionally paraphrase a heading, which would make the insertion
 * step unable to find its anchor.
 */
function extractHeadings(source) {
    const src = String(source || '');
    const out = [];

    // Rendered HTML — the retroactive path reads an EXISTING post, whose
    // post_content is Parsedown output (`<h2 class="wp-block-heading">…</h2>`),
    // not the markdown the generation path sees. Both producers use this
    // function, so it handles both rather than making callers know which.
    const htmlRe = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
    let h;
    while ((h = htmlRe.exec(src)) !== null) {
        const text = h[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&#0?39;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/\s+/g, ' ')
            .trim();
        if (text) out.push(text);
    }

    // Markdown — the generation path, where the model's output has not been
    // rendered yet.
    const mdRe = /^[ \t]{0,3}##[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
    let m;
    while ((m = mdRe.exec(src)) !== null) {
        const text = m[1].replace(/[*_`]/g, '').trim();
        if (text && !out.includes(text)) out.push(text);
    }

    return out;
}

const MAX_FIELD = {
    section_heading: 200,
    description:     400,
    alt_text:        250,
    caption:         200,
};

function clampField(v, key) {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > MAX_FIELD[key] ? s.slice(0, MAX_FIELD[key]).trim() : s;
}

/**
 * Validate and normalise one raw suggestion against the article's real headings.
 * Returns null when the suggestion cannot be trusted — a dropped suggestion is
 * always better than one that points at a section which does not exist, because
 * the insertion step resolves its anchor by heading match.
 */
function normaliseSuggestion(raw, headings) {
    if (!raw || typeof raw !== 'object') return null;

    const wanted = normaliseHeading(raw.section_heading);
    if (!wanted) return null;

    // Exact (normalised) match first; then a containment match, which catches
    // the model dropping a trailing question mark or an article word.
    let heading = headings.find(h => normaliseHeading(h) === wanted);
    if (!heading) {
        heading = headings.find(h => {
            const n = normaliseHeading(h);
            return n.length > 3 && wanted.length > 3 && (n.includes(wanted) || wanted.includes(n));
        });
    }
    if (!heading) return null; // no anchor → unusable

    let position = String(raw.position || '').trim().toLowerCase();
    if (!POSITIONS.includes(position)) position = DEFAULT_POSITION;

    let layout = String(raw.layout || '').trim().toLowerCase();
    if (!isValidLayout(layout)) layout = DEFAULT_LAYOUT;

    // Enforce the position/layout pairing rather than trusting the model.
    if (!POSITION_LAYOUTS[position].includes(layout)) {
        layout = POSITION_LAYOUTS[position][0];
    }

    const description = clampField(raw.description, 'description');
    if (!description) return null; // nothing to generate from

    const alt = clampField(raw.alt_text, 'alt_text');

    return {
        section_heading: heading,                    // the REAL heading, not the model's copy
        position,
        layout,
        description,
        // Alt text is mandatory for accessibility. If the model omitted it, fall
        // back to the description rather than shipping an image with none.
        alt_text: alt || description,
        caption:  clampField(raw.caption, 'caption'),
    };
}

/**
 * Enforce the collection-level rules the per-item pass cannot see: one image per
 * section, the count ceiling, and alternating inline sides.
 */
function dedupeAndCap(suggestions, max) {
    const seen = new Set();
    const out  = [];
    let inlineCount = 0;

    let bandCount = 0;
    for (const s of suggestions) {
        const key = normaliseHeading(s.section_heading);
        if (seen.has(key)) continue;      // one image per section
        seen.add(key);

        // At most ONE band per article. Inline images read better inside a
        // column of text; a stack of full-width bands turns the piece into a
        // slideshow. The prompt asks for this, but a prompt is guidance —
        // enforcing it here makes it a guarantee. A second band is demoted to an
        // inline image, unless its position is band-only, in which case it moves
        // to end-of-section where an inline layout is legal.
        if (s.layout === 'band') {
            if (bandCount >= 1) {
                s.layout = 'inline-right';
                if (!POSITION_LAYOUTS[s.position]?.includes('inline-right')) {
                    s.position = DEFAULT_POSITION;
                }
            } else {
                bandCount++;
            }
        }

        // Alternate inline sides regardless of what the model chose. Always-right
        // reads as a template; alternating reads as design.
        if (s.layout === 'inline-left' || s.layout === 'inline-right') {
            s.layout = (inlineCount % 2 === 0) ? 'inline-right' : 'inline-left';
            inlineCount++;
        }

        out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * Extract suggestions from a model response and return the content with the
 * block removed.
 *
 * ALWAYS returns a usable cleanContent, even when parsing fails — suggestions
 * are a nice-to-have and must never be able to damage the article. A malformed
 * block is stripped and dropped, exactly as a failed SERP call degrades to an
 * ungrounded post.
 *
 * @param {string} text      Raw model output (article + SEO block + this block).
 * @param {object} [opts]
 * @param {number} [opts.max]      Cap on returned suggestions.
 * @param {string} [opts.article]  Markdown to source headings from. Defaults to
 *                                 the cleaned text, which is correct at
 *                                 generation time; the retroactive route passes
 *                                 the existing article explicitly.
 * @returns {{suggestions: Array, cleanContent: string, parseError: string|null}}
 */
function parseSuggestionBlock(text, opts = {}) {
    const raw = String(text || '');
    const max = parseInt(opts.max, 10) || SUGGESTIONS_MAX;

    // Strip the block whatever happens, including an unterminated one — a
    // truncated response must never leave "---IMAGE_SUGGESTIONS_START---" and a
    // half-written JSON array visible in the published post.
    const blockRe = new RegExp(
        `\\n*-{3,}\\s*IMAGE_SUGGESTIONS_START-{3,}([\\s\\S]*?)(?:-{3,}\\s*IMAGE_SUGGESTIONS_END-{3,}|$)\\n*`,
        'i'
    );
    const match = raw.match(blockRe);
    const cleanContent = match ? raw.replace(blockRe, '\n').trim() : raw;

    if (!match) return { suggestions: [], cleanContent, parseError: null };

    const parsedArray = parseJsonArrayLoose(match[1]);
    if (!parsedArray) {
        return { suggestions: [], cleanContent, parseError: 'unparseable JSON in image-suggestions block' };
    }

    const headings = extractHeadings(opts.article || cleanContent);
    if (headings.length === 0) {
        return { suggestions: [], cleanContent, parseError: 'article has no ## headings to anchor against' };
    }

    const normalised = parsedArray
        .map(s => normaliseSuggestion(s, headings))
        .filter(Boolean);

    return {
        suggestions: dedupeAndCap(normalised, max),
        cleanContent,
        parseError: null,
    };
}

module.exports = {
    SUGGESTIONS_MAX,
    POSITIONS, POSITION_LAYOUTS, DEFAULT_POSITION, LAYOUTS,
    IMAGE_SUGGESTION_TYPES,
    BLOCK_START, BLOCK_END,
    suggestionSlotsFor, resolveSuggestionCount,
    buildSuggestionBlock, buildRetroPrompt, suggestionRules,
    extractHeadings, normaliseHeading, normaliseSuggestion, dedupeAndCap,
    parseSuggestionBlock,
};
