/**
 * content-types.js
 * 
 * Defines all available content types, their tier requirements,
 * and generates the appropriate prompt for each type.
 * 
 * Imported by generate.js
 */

// ── Tier definitions ──────────────────────────────────────────────────────────

const TIER_RANK = { free: 0, starter: 1, pro: 2, agency: 3 };

const CONTENT_TYPES = {

    // ── FREE ────────────────────────────────────────────────────────────────

    'blog_post': {
        credits:     2,
        label:       'Blog Post / Article',
        tier:        'free',
        group:       'Content Marketing',
        description: 'SEO-optimised long-form article with headings, FAQ, and CTA',
        meta_fields: [],
    },

    // ── STARTER ─────────────────────────────────────────────────────────────

    'tutorial': {
        credits:     2,
        label:       'Tutorial / How-To',
        tier:        'starter',
        group:       'Content Marketing',
        description: 'Step-by-step guide with prerequisites, steps, and outcomes',
        meta_fields: [
            { key: 'difficulty', label: 'Difficulty Level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] },
            { key: 'estimated_time', label: 'Estimated Time', type: 'text', placeholder: 'e.g. 30 minutes' },
        ],
    },

    'faq_page': {
        credits:     1,
        label:       'FAQ Page',
        tier:        'starter',
        group:       'Content Marketing',
        description: 'Schema-ready FAQ page with questions and detailed answers',
        meta_fields: [
            { key: 'num_questions', label: 'Number of Questions', type: 'select', options: ['6', '8', '10', '12', '15'] },
        ],
    },

    'woocommerce_product': {
        credits:     1,
        label:       'WooCommerce Product',
        tier:        'starter',
        group:       'Sales & Commerce',
        description: 'Persuasive product description with features, benefits, and specs',
        meta_fields: [
            { key: 'product_name', label: 'Product Name', type: 'text', placeholder: 'e.g. Leather Laptop Bag' },
            { key: 'key_features', label: 'Key Features / Specs', type: 'textarea', placeholder: 'e.g. Full grain leather, fits 15" laptop, 3 compartments...' },
            { key: 'price', label: 'Price (optional)', type: 'text', placeholder: 'e.g. £49.99' },
            { key: 'target_customer', label: 'Target Customer', type: 'text', placeholder: 'e.g. Professionals aged 25-45' },
        ],
    },

    'service_page': {
        credits:     2,
        label:       'Service Page',
        tier:        'starter',
        group:       'Sales & Commerce',
        description: 'What you offer, who it\'s for, your process, and pricing CTA',
        meta_fields: [
            { key: 'service_name', label: 'Service Name', type: 'text', placeholder: 'e.g. Social Media Management' },
            { key: 'target_audience', label: 'Target Audience', type: 'text', placeholder: 'e.g. Small businesses in the UK' },
            { key: 'key_benefits', label: 'Key Benefits', type: 'textarea', placeholder: 'e.g. Saves time, increases engagement, grows followers...' },
        ],
    },

    'about_us': {
        credits:     1,
        label:       'About Us / Company Page',
        tier:        'starter',
        group:       'Business',
        description: 'Origin story, mission, values, and team — builds trust and connection',
        meta_fields: [
            { key: 'company_name', label: 'Company Name', type: 'text', placeholder: 'e.g. Acme Digital Ltd' },
            { key: 'founded', label: 'Founded', type: 'text', placeholder: 'e.g. 2018, London' },
            { key: 'mission', label: 'Mission / Values', type: 'textarea', placeholder: 'e.g. We believe every small business deserves...' },
        ],
    },

    // ── PRO ─────────────────────────────────────────────────────────────────

    'vehicle_listing': {
        credits:     1,
        label:       'Vehicle Listing',
        tier:        'pro',
        group:       'Sales & Commerce',
        description: 'Compelling vehicle description with specs, condition, and selling points',
        meta_fields: [
            { key: 'make', label: 'Make', type: 'text', placeholder: 'e.g. Ford' },
            { key: 'model', label: 'Model', type: 'text', placeholder: 'e.g. Transit Custom' },
            { key: 'year', label: 'Year', type: 'text', placeholder: 'e.g. 2022' },
            { key: 'mileage', label: 'Mileage', type: 'text', placeholder: 'e.g. 24,000 miles' },
            { key: 'condition', label: 'Condition', type: 'select', options: ['Excellent', 'Good', 'Fair', 'Spares or Repair'] },
            { key: 'key_features', label: 'Key Features', type: 'textarea', placeholder: 'e.g. Full service history, one owner, air con, cruise control...' },
            { key: 'price', label: 'Asking Price', type: 'text', placeholder: 'e.g. £18,995' },
        ],
    },

    'landing_page': {
        credits:     3,
        label:       'Landing Page',
        tier:        'pro',
        group:       'Sales & Commerce',
        description: 'Hero copy, benefits, social proof, objection handling, and strong CTA',
        meta_fields: [
            { key: 'offer', label: 'The Offer', type: 'text', placeholder: 'e.g. Free 14-day trial of our project management tool' },
            { key: 'target_audience', label: 'Target Audience', type: 'text', placeholder: 'e.g. Freelancers and small agency owners' },
            { key: 'main_benefit', label: 'Main Benefit', type: 'text', placeholder: 'e.g. Save 5 hours a week on admin' },
            { key: 'objections', label: 'Common Objections', type: 'textarea', placeholder: 'e.g. Too expensive, too complicated, already use spreadsheets' },
        ],
    },

    'press_release': {
        credits:     1,
        label:       'Press Release',
        tier:        'pro',
        group:       'Business',
        description: 'Formal structure with dateline, quotes, and boilerplate',
        meta_fields: [
            { key: 'announcement', label: 'The Announcement', type: 'textarea', placeholder: 'e.g. Launch of new product, partnership, award win...' },
            { key: 'quote_attribution', label: 'Quote Attribution', type: 'text', placeholder: 'e.g. Jane Smith, CEO of Acme Ltd' },
            { key: 'location', label: 'Location / Dateline', type: 'text', placeholder: 'e.g. London, UK' },
        ],
    },

    'job_listing': {
        credits:     1,
        label:       'Job Listing',
        tier:        'pro',
        group:       'Business',
        description: 'Role overview, responsibilities, requirements, benefits, and apply CTA',
        meta_fields: [
            { key: 'job_title', label: 'Job Title', type: 'text', placeholder: 'e.g. Senior React Developer' },
            { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Remote, London, Hybrid' },
            { key: 'salary', label: 'Salary Range', type: 'text', placeholder: 'e.g. £45,000 - £55,000' },
            { key: 'key_responsibilities', label: 'Key Responsibilities', type: 'textarea', placeholder: 'e.g. Build React components, lead code reviews...' },
            { key: 'requirements', label: 'Requirements', type: 'textarea', placeholder: 'e.g. 3+ years React, TypeScript, strong communication...' },
        ],
    },

    'review_comparison': {
        credits:     3,
        label:       'Review / Comparison Article',
        tier:        'pro',
        group:       'Content Marketing',
        description: '"X vs Y" or "Best X for Y" — high SEO traffic, ideal for affiliate content',
        meta_fields: [
            { key: 'review_type', label: 'Review Type', type: 'select', options: ['Single Product Review', 'Head-to-Head Comparison', 'Best Of Roundup'] },
            { key: 'products', label: 'Products / Services', type: 'text', placeholder: 'e.g. Mailchimp vs ConvertKit, or Top 5 CRMs' },
            { key: 'verdict', label: 'Overall Verdict (optional)', type: 'text', placeholder: 'e.g. ConvertKit wins for creators' },
        ],
    },

    'email_newsletter': {
        credits:     1,
        label:       'Email Newsletter',
        tier:        'pro',
        group:       'Content Marketing',
        description: 'Subject line, preview text, engaging body, and CTA',
        meta_fields: [
            { key: 'audience', label: 'Audience', type: 'text', placeholder: 'e.g. Existing customers, newsletter subscribers' },
            { key: 'main_topic', label: 'Main Topic / Angle', type: 'textarea', placeholder: 'e.g. Announcing our summer sale, sharing industry news...' },
            { key: 'cta', label: 'Call to Action', type: 'text', placeholder: 'e.g. Shop now, Read more, Book a call' },
        ],
    },

    'video_script': {
        credits:     2,
        label:       'Video Script',
        tier:        'pro',
        group:       'Content Marketing',
        description: 'Hook, structured content, b-roll notes, and end screen CTA',
        meta_fields: [
            { key: 'platform', label: 'Platform', type: 'select', options: ['YouTube', 'TikTok', 'Instagram Reels', 'LinkedIn', 'Facebook', 'Explainer / Corporate'] },
            { key: 'duration', label: 'Target Duration', type: 'select', options: ['30 seconds', '60 seconds', '3 minutes', '5 minutes', '10 minutes'] },
            { key: 'style', label: 'Style', type: 'select', options: ['Educational', 'Entertaining', 'Promotional', 'Documentary', 'Tutorial'] },
        ],
    },

    'social_media': {
        credits:     1,
        label:       'Social Media Post',
        tier:        'pro',
        group:       'Content Marketing',
        description: 'Platform-optimised posts with hooks, hashtags, and CTAs',
        meta_fields: [
            { key: 'platforms', label: 'Platforms', type: 'multiselect', options: ['LinkedIn', 'Facebook', 'Instagram', 'X (Twitter)', 'TikTok'] },
            { key: 'variations', label: 'Variations per Platform', type: 'select', options: ['1', '3', '5'] },
            { key: 'post_goal', label: 'Post Goal', type: 'select', options: ['Brand Awareness', 'Drive Traffic', 'Generate Leads', 'Engagement', 'Product Promotion', 'Thought Leadership'] },
        ],
    },

    'policy_procedure': {
        credits:     2,
        label:       'Policy & Procedure',
        tier:        'pro',
        group:       'Business',
        description: 'Corporate policy document with purpose, scope, responsibilities, and steps',
        meta_fields: [
            { key: 'policy_type', label: 'Policy Type', type: 'text', placeholder: 'e.g. Remote Working Policy, Expense Policy' },
            { key: 'audience', label: 'Audience', type: 'text', placeholder: 'e.g. All employees, Management, HR' },
            { key: 'key_points', label: 'Key Points to Cover', type: 'textarea', placeholder: 'e.g. Eligibility, approval process, equipment...' },
        ],
    },

    'onboarding_doc': {
        credits:     2,
        label:       'Onboarding Document',
        tier:        'pro',
        group:       'Business',
        description: 'Welcome, what to expect, key contacts, and first steps for new starters',
        meta_fields: [
            { key: 'role', label: 'Role / Department', type: 'text', placeholder: 'e.g. Marketing Executive, Sales Team' },
            { key: 'company_name', label: 'Company Name', type: 'text', placeholder: 'e.g. Acme Ltd' },
            { key: 'key_info', label: 'Key Information', type: 'textarea', placeholder: 'e.g. Tools used, key contacts, first week schedule...' },
        ],
    },

    // ── AGENCY ──────────────────────────────────────────────────────────────

    'event_description': {
        credits:     1,
        label:       'Event Description',
        tier:        'pro',
        group:       'Content Marketing',
        description: 'Compelling event page with date, venue, agenda and CTA',
        meta_fields: [
            { key: 'event_date',      label: 'Event Date & Time',  type: 'text',     placeholder: 'e.g. Saturday 14th June 2026, 10am–4pm BST' },
            { key: 'event_location',  label: 'Venue / Location',   type: 'text',     placeholder: 'e.g. The Barbican, London EC2Y 8DS' },
            { key: 'event_type',      label: 'Event Type',         type: 'select',   options: ['Conference', 'Workshop', 'Webinar', 'Meetup', 'Training Day', 'Networking', 'Exhibition', 'Launch Event', 'Other'] },
            { key: 'ticket_price',    label: 'Ticket Price',       type: 'text',     placeholder: 'e.g. Free, £49, £99–£299' },
            { key: 'event_url',       label: 'Event / Tickets URL',type: 'text',     placeholder: 'e.g. https://eventbrite.com/...' },
            { key: 'organiser',       label: 'Organiser',          type: 'text',     placeholder: 'e.g. London WordPress Meetup' },
            { key: 'agenda',          label: 'Agenda / Highlights',type: 'textarea', placeholder: 'e.g. Keynote speakers, panel sessions, networking lunch...' },
            { key: 'target_audience', label: 'Target Audience',    type: 'text',     placeholder: 'e.g. WordPress developers, small business owners' },
        ],
    },

    'course_overview': {
        credits:     3,
        label:       'Course Overview / Syllabus',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Course objectives, module breakdown, outcomes, and who it\'s for',
        meta_fields: [
            { key: 'course_name', label: 'Course Name', type: 'text', placeholder: 'e.g. Introduction to Digital Marketing' },
            { key: 'audience', label: 'Target Audience', type: 'text', placeholder: 'e.g. Marketing assistants, career changers' },
            { key: 'duration', label: 'Duration', type: 'text', placeholder: 'e.g. 6 weeks, 3 hours per week' },
            { key: 'num_modules', label: 'Number of Modules', type: 'select', options: ['4', '6', '8', '10', '12'] },
        ],
    },

    'training_module': {
        credits:     3,
        label:       'Training Module / Lesson',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Intro, content sections, summary, and knowledge check questions',
        meta_fields: [
            { key: 'module_title', label: 'Module Title', type: 'text', placeholder: 'e.g. Understanding Customer Personas' },
            { key: 'learning_objectives', label: 'Learning Objectives', type: 'textarea', placeholder: 'e.g. By the end learners will be able to...' },
            { key: 'audience_level', label: 'Audience Level', type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] },
            { key: 'num_questions', label: 'Knowledge Check Questions', type: 'select', options: ['3', '5', '8', '10'] },
        ],
    },

    'case_study_ld': {
        credits:     3,
        label:       'Case Study (L&D)',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Scenario-based learning with situation, challenge, solution, and discussion questions',
        meta_fields: [
            { key: 'scenario_context', label: 'Scenario Context', type: 'textarea', placeholder: 'e.g. A manager dealing with a conflict between two team members...' },
            { key: 'learning_focus', label: 'Learning Focus', type: 'text', placeholder: 'e.g. Conflict resolution, leadership, communication' },
            { key: 'num_questions', label: 'Discussion Questions', type: 'select', options: ['3', '5', '8'] },
        ],
    },

    'explainer_guide': {
        credits:     2,
        label:       'Explainer / Concept Guide',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Break down a complex topic for a specific audience level',
        meta_fields: [
            { key: 'concept', label: 'Concept to Explain', type: 'text', placeholder: 'e.g. Machine Learning, GDPR, Cash Flow' },
            { key: 'audience_level', label: 'Audience Level', type: 'select', options: ['Complete Beginner', 'Some Knowledge', 'Intermediate', 'Advanced'] },
            { key: 'analogy_style', label: 'Use Analogies?', type: 'select', options: ['Yes — use everyday analogies', 'No — keep it technical'] },
        ],
    },

    'quiz_assessment': {
        credits:     3,
        label:       'Quiz / Assessment',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Multiple choice or open questions with answer keys — LMS ready',
        meta_fields: [
            { key: 'quiz_type', label: 'Question Type', type: 'select', options: ['Multiple Choice', 'True / False', 'Open Questions', 'Mixed'] },
            { key: 'num_questions', label: 'Number of Questions', type: 'select', options: ['5', '10', '15', '20'] },
            { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['Easy', 'Medium', 'Hard', 'Mixed'] },
            { key: 'include_answers', label: 'Include Answer Key?', type: 'select', options: ['Yes', 'No'] },
        ],
    },

    'workshop_guide': {
        credits:     3,
        label:       'Workshop Facilitation Guide',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Agenda, timings, facilitator notes, activities, and discussion prompts',
        meta_fields: [
            { key: 'workshop_topic', label: 'Workshop Topic', type: 'text', placeholder: 'e.g. Team Communication, Change Management' },
            { key: 'duration', label: 'Workshop Duration', type: 'select', options: ['1 hour', '2 hours', 'Half day', 'Full day'] },
            { key: 'num_participants', label: 'Number of Participants', type: 'text', placeholder: 'e.g. 10-15' },
            { key: 'format', label: 'Format', type: 'select', options: ['In-person', 'Virtual', 'Hybrid'] },
        ],
    },

    'sop': {
        credits:     2,
        label:       'Standard Operating Procedure',
        tier:        'agency',
        group:       'Learning & Development',
        description: 'Step-by-step process documentation with roles, responsibilities, and compliance notes',
        meta_fields: [
            { key: 'process_name', label: 'Process Name', type: 'text', placeholder: 'e.g. Customer Complaint Handling' },
            { key: 'department', label: 'Department / Team', type: 'text', placeholder: 'e.g. Customer Service, Finance' },
            { key: 'roles', label: 'Roles Involved', type: 'text', placeholder: 'e.g. Team Leader, Agent, Manager' },
            { key: 'key_steps', label: 'Key Steps / Process Notes', type: 'textarea', placeholder: 'e.g. 1. Receive complaint, 2. Log in CRM...' },
        ],
    },
};

// ── Tier access check ─────────────────────────────────────────────────────────

function canAccessContentType(contentTypeId, userTier) {
    const ct = CONTENT_TYPES[contentTypeId];
    if (!ct) return false;
    // AICOBR_AGENCY_TRIAL_2026_08: real tier gating restored. The free trial
    // ("10 Agency credits — every content type until they're spent") is
    // implemented at the call sites (generate.js / strategist.js), which pass
    // an EFFECTIVE tier of 'agency' while the free_tier_initial batch still
    // has balance, and the licence's real tier once it's spent.
    return TIER_RANK[userTier] >= TIER_RANK[ct.tier];
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Per-content-type length profiles — the single source of truth for how long
 * each type should be. `target` is the centre, `min`/`max` the acceptable band.
 *
 *   • Flexible types (blog, guide, tutorial, reviews, courses) get wide bands —
 *     depth genuinely adds value.
 *   • Tight types (service/landing/about pages, products, listings) get narrow
 *     bands — there is a right length and longer is just padding (and, for
 *     landing pages, worse for conversion).
 *   • Structural types (social, video script, quiz/assessment, SOPs, etc.) have
 *     NO profile: their length follows their structure, so they get a generous
 *     token budget only (see maxTokensFor) and no word band in the prompt.
 *
 * Behaviour driven from here:
 *   1. acbLengthGuidance() — the band line injected into buildPrompt.
 *   2. resolveTargetWords() — clamps a requested word count into the band.
 *   3. maxTokensFor() — sizes the API max_tokens to the type's ceiling so large
 *      pieces have headroom and nothing silently truncates.
 */
const LENGTH_PROFILES = {
    // Flexible — depth adds value
    blog_post:         { target: 1500, min: 1000, max: 2500 },
    explainer_guide:   { target: 1800, min: 1200, max: 3000 },
    tutorial:          { target: 1200, min: 900,  max: 2200 },
    review_comparison: { target: 1500, min: 1000, max: 2500 },
    course_overview:   { target: 1500, min: 1000, max: 2500 },
    training_module:   { target: 1500, min: 1000, max: 2500 },
    case_study_ld:     { target: 1200, min: 800,  max: 2000 },
    // Tight — a right length; longer hurts
    service_page:      { target: 1000, min: 700,  max: 1400 },
    landing_page:      { target: 900,  min: 600,  max: 1300 },
    about_us:          { target: 700,  min: 500,  max: 1000 },
    faq_page:          { target: 800,  min: 400,  max: 1400 },
    woocommerce_product:{ target: 450, min: 300,  max: 700  },
    vehicle_listing:   { target: 400,  min: 250,  max: 650  },
    press_release:     { target: 600,  min: 400,  max: 800  },
    recipe:            { target: 600,  min: 350,  max: 1000 },
    onboarding_doc:    { target: 800,  min: 500,  max: 1400 },
};
const DEFAULT_PROFILE = { target: 1200, min: 600, max: 2000 };
const GLOBAL_MAX_WORDS = 4000;        // hard backstop, no matter what a user requests
const STRUCTURAL_MAX_TOKENS = 8000;   // budget for typeless/structural content (lists, JSON, etc.)

function getLengthProfile(contentTypeId) {
    return LENGTH_PROFILES[contentTypeId] || DEFAULT_PROFILE;
}

// Clamp a requested word count into the type's band (falling back to target).
function resolveTargetWords(contentTypeId, requested) {
    const p = getLengthProfile(contentTypeId);
    const max = Math.min(p.max, GLOBAL_MAX_WORDS);
    const min = Math.min(p.min, max);
    let t = parseInt(requested, 10);
    if (!t || isNaN(t)) t = p.target;
    return Math.max(min, Math.min(max, t));
}

// The length line injected into the prompt — a band, not a bare number, so the
// model writes what the topic needs instead of padding to hit a count.
function acbLengthGuidance(contentTypeId, requested) {
    const p = getLengthProfile(contentTypeId);
    const max = Math.min(p.max, GLOBAL_MAX_WORDS);
    const min = Math.min(p.min, max);
    const target = resolveTargetWords(contentTypeId, requested);
    return `aim for ~${target} words (${min}–${max} is a fine range — write what the topic genuinely needs and don't pad to hit a number)`;
}

// Size the API max_tokens to the type's ceiling. The generated output is not
// plain prose — it's Markdown (headings, lists) PLUS an appended SEO data block,
// meta description and FAQ. Real token usage for that runs ~2.2–2.5 tokens/word,
// well above a naive prose ratio. The old 1.6×words + 1600 factor under-budgeted
// and truncated longer/structured types (e.g. tutorials hit the ceiling mid-article).
// 2.4 tokens/word + 2200 overhead gives every type headroom for the trailing
// SEO/FAQ block without exceeding model limits (hard-capped at 24000).
function maxTokensFor(contentTypeId) {
    const p = LENGTH_PROFILES[contentTypeId];
    if (!p) return STRUCTURAL_MAX_TOKENS;
    const ceilingWords = Math.min(p.max, GLOBAL_MAX_WORDS);
    return Math.min(24000, Math.ceil(ceilingWords * 2.4) + 2200);
}

function buildPrompt(contentTypeId, title, primaryKeyword, targetWordCount, meta) {
    const m = meta || {};

    const seoBlock = `
**AFTER THE CONTENT — output this exact block with no extra commentary:**

---SEO_DATA_START---
SEO_TITLE: [A compelling meta title, max 60 characters, including the primary keyword]
SEO_DESCRIPTION: [A meta description, 140-155 characters, including the primary keyword, written to encourage clicks]
SEO_FOCUS_KEYWORD: ${primaryKeyword || title}
SEO_OG_TITLE: [An engaging Open Graph title for social sharing, max 60 characters]
SEO_OG_DESCRIPTION: [An Open Graph description optimised for social sharing, max 155 characters]
---SEO_DATA_END---

Output the content in clean Markdown first, then the SEO_DATA block. Nothing else.`;

    const formattingRules = `
**FORMATTING RULES:**
- Use proper Markdown: ## for H2, ### for H3, **bold**, *italic*
- Do NOT repeat the title and do NOT use a level-1 heading (a single #, i.e. H1) anywhere — the page already displays the title above your content. Begin with your opening paragraph and use ## for the first section heading.
- Leave a blank line between every paragraph
- Leave a blank line before and after every heading
- Leave a blank line before and after every list
- Do not stack headings — always have at least one paragraph between headings
- Keep paragraphs to 3-5 sentences maximum for readability

**STYLED COMPONENTS — use these EXACT formats so they render as designed:**
- Callouts: to flag a tip, caution, or note, write it as its own paragraph that begins with a bold label and a colon, then the text. Use only these labels: **Pro tip:**, **Warning:**, or **Note:**. Example: **Pro tip:** Batch related edits so you only test once.
- Key takeaways: where a short summary of the main points helps the reader, add a heading titled exactly "## Key takeaways" immediately followed (with no paragraph in between) by a 3-5 item bullet list.
- FAQ section: when an article includes a FAQ as one of its sections, title that section exactly "## Frequently Asked Questions" and write each question as an H3 heading ("### How do I …?") with its answer in the paragraph(s) directly beneath it. (This does not apply to a dedicated FAQ Page, which keeps its own question format.)
- Step-by-step procedures: when the content presents an explicit sequence of actions to follow in order, format each step as an H3 heading titled exactly "### Step 1: short title" (then "### Step 2: …", and so on), with that step's details in the paragraph(s) beneath it. Use this only for genuine procedures — not for general listicle or "N ways to…" sections.`;

    // AICOBR_ANSWER_SHAPE_2026_08
    // Answer-shaped writing helps a reader who lands mid-article and takes one
    // section — which is also how answer engines read. It is deliberately NOT
    // applied to every type: "answer the central question in the first 40-60
    // words" is meaningless for a quiz or a video script, and actively wrong for
    // a product or vehicle listing, where the destination template owns the
    // shape and the opening should sell, not define. Scoped to the prose types
    // a reader arrives at from a search — the same set that gets SERP grounding,
    // plus the explanatory L&D/doc types where self-contained sections matter.
    const ANSWER_SHAPE_TYPES = new Set([
        'blog_post', 'tutorial', 'faq_page', 'service_page', 'about_us',
        'landing_page', 'review_comparison', 'explainer_guide',
        'policy_procedure', 'onboarding_doc', 'sop', 'training_module',
        'course_overview', 'workshop_guide', 'case_study_ld', 'press_release',
    ]);

    const answerShape = ANSWER_SHAPE_TYPES.has(contentTypeId) ? `
**ANSWER SHAPE — write so a section can be lifted out and still make sense:**
This is how people actually read: they arrive at one section, take what they need, and leave.
Every rule below also makes the piece better for a human skimmer, which is why it applies
regardless of any SEO or AI-visibility fashion.
- Answer first. Open the article by answering its central question directly in the first 40-60
  words, in plain language, before any context, story or scene-setting. A reader who stops after
  two sentences should already have the answer. Then expand.
- Where a section poses a question, answer it in that section's FIRST sentence, then explain.
  Do not build up to the answer and reveal it at the end.
- Make sections self-contained. Avoid "as mentioned above", "as we saw earlier", or a bare
  "this"/"that" pointing back to an earlier section — name the thing again. A section pulled out
  on its own must still read correctly.
- Prefer specific, checkable statements over vague ones: a number, a timeframe, a named standard
  or a concrete condition beats "often", "many" or "it depends". Where it genuinely does depend,
  say what it depends ON.
- Define a term the first time it is used, in one sentence, before using it further.
- Write headings as the question or task a reader would actually type, not as clever labels:
  "How much does a boiler service cost?" not "Understanding the cost equation".
- Never state a statistic, price, date or study you are not confident is real. An invented figure
  is worse than none — write the qualitative statement instead.`  : '';

    switch (contentTypeId) {

        case 'blog_post':
            return `**CONTENT BRIEF:**
- Title: ${title}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**ARTICLE REQUIREMENTS:**
1. Open with a powerful hook that immediately addresses the reader's pain point or curiosity
2. Naturally include the primary keyword within the first 100 words
3. Use clear H2 and H3 subheadings that target secondary/LSI keywords
4. Include relevant statistics, expert opinions, or real-world examples to satisfy E-E-A-T signals
5. Use bullet points and numbered lists where they genuinely aid readability
6. Immediately after the introduction, add a "## Key takeaways" summary — the heading followed straight away (no paragraph in between) by a 3-5 item bullet list of the article's main points
7. Add a FAQ section near the end titled exactly "## Frequently Asked Questions", with 4-6 questions, each written as an H3 heading ("### …?") with its answer directly below
8. End with a clear, helpful CTA that feels natural — not salesy
9. Aim for a Flesch reading ease score of 60 or higher
10. Do NOT use filler phrases like "In today's world", "In conclusion", "It's worth noting", or "Delve into"
${formattingRules}${answerShape}
${seoBlock}`;

        case 'tutorial':
            return `**CONTENT BRIEF:**
- Title: ${title}
- Topic: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}
- Difficulty: ${m.difficulty || 'Beginner'}
- Estimated Time: ${m.estimated_time || 'Not specified'}

**TUTORIAL REQUIREMENTS:**
1. Open with what the reader will achieve by the end
2. List prerequisites (tools, knowledge, or materials needed)
3. Format each step as an H3 heading titled exactly "Step N: short title" (e.g. "### Step 1: Gather your tools"), with that step's details in the paragraph(s) below it
4. Include tips, warnings, or "Pro tip" callouts where relevant
5. Add a "Troubleshooting" section covering common mistakes
6. End with next steps or related tutorials
7. Use code blocks if any code or commands are involved
${formattingRules}${answerShape}
${seoBlock}`;

        case 'faq_page':
            return `**CONTENT BRIEF:**
- Topic: ${title}
- Primary Keyword: ${primaryKeyword || title}
- Number of Questions: ${m.num_questions || '8'}

**FAQ PAGE REQUIREMENTS:**
1. Write a short intro paragraph (2-3 sentences) explaining what this FAQ covers
2. Generate exactly ${m.num_questions || '8'} questions and detailed answers
3. Format each question as an H2 heading (## Question here)
4. Each answer should be 2-5 sentences — thorough but concise
5. Include the primary keyword naturally in at least 3 questions
6. Order questions from most basic to most advanced
7. The output must be valid schema.org FAQPage structured data ready (questions as H2, answers as paragraphs)
8. End with a brief "Still have questions?" CTA
${formattingRules}${answerShape}
${seoBlock}`;

        case 'woocommerce_product':
            return `**CONTENT BRIEF:**
- Product: ${m.product_name || title}
- Primary Keyword: ${primaryKeyword || title}
- Price: ${m.price || 'Not specified'}
- Target Customer: ${m.target_customer || 'General consumer'}
- Key Features / Specs: ${m.key_features || 'Not specified'}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**PRODUCT DESCRIPTION REQUIREMENTS:**
1. Open with a compelling one-liner that captures the product's core benefit
2. Write a persuasive 2-3 paragraph description focusing on benefits over features
3. Include a "Key Features" bullet list (5-8 points)
4. Include a "Specifications" section if relevant
5. Address the target customer's main pain point directly
6. End with a subtle urgency or value statement — not pushy
7. Tone should be confident and persuasive — this copy needs to sell
8. Naturally include the primary keyword 2-3 times
${formattingRules}${answerShape}
${seoBlock}`;

        case 'service_page':
            return `**CONTENT BRIEF:**
- Service: ${m.service_name || title}
- Primary Keyword: ${primaryKeyword || title}
- Target Audience: ${m.target_audience || 'Not specified'}
- Key Benefits: ${m.key_benefits || 'Not specified'}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**SERVICE PAGE REQUIREMENTS:**
1. Open with a hero statement that immediately communicates value
2. Explain what the service is and who it's for
3. Cover key benefits with an H2 section for each major benefit
4. Include a "How It Works" section with 3-5 steps
5. Add a "Who Is This For?" section
6. Include a "Why Choose Us?" or trust-building section
7. End with a strong CTA (book a call, get a quote, contact us)
8. Tone: professional, confident, and customer-focused
${formattingRules}${answerShape}
${seoBlock}`;

        case 'about_us':
            return `**CONTENT BRIEF:**
- Company: ${m.company_name || title}
- Founded: ${m.founded || 'Not specified'}
- Mission / Values: ${m.mission || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**ABOUT US REQUIREMENTS:**
1. Open with a compelling hook — NOT "We are a company that..."
2. Tell the origin story — why the company was founded, what problem it solves
3. Cover mission, vision, and core values naturally in the narrative
4. Include a "Meet the Team" placeholder section
5. Explain what makes the company different
6. End with an invitation — visit, contact, or follow
7. Tone: warm, human, and authentic — this page builds trust
8. Write in third person unless instructed otherwise
${formattingRules}${answerShape}
${seoBlock}`;

        case 'recipe':
            return `**CONTENT BRIEF:**
- Recipe: ${title}
- Cuisine: ${m.cuisine || 'Not specified'}
- Servings: ${m.servings || '4'}
- Prep + Cook Time: ${m.prep_time || 'Not specified'}
- Dietary: ${m.dietary || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}

**RECIPE REQUIREMENTS:**
1. Write a short, enticing intro (2-3 sentences) — why this recipe is worth making
2. List all ingredients with exact measurements in a bullet list under ## Ingredients
3. Write numbered method steps under ## Method — one action per step
4. Include ## Tips & Variations section with 3-5 practical tips
5. Include ## Nutritional Information (approximate per serving)
6. Schema-ready format: ingredients as list, method as ordered list
7. Tone: friendly, encouraging, and practical
${formattingRules}${answerShape}
${seoBlock}`;

        case 'vehicle_listing':
            return `**CONTENT BRIEF:**
- Vehicle: ${m.year || ''} ${m.make || ''} ${m.model || ''}
- Mileage: ${m.mileage || 'Not specified'}
- Condition: ${m.condition || 'Good'}
- Key Features: ${m.key_features || 'Not specified'}
- Asking Price: ${m.price || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}

**VEHICLE LISTING REQUIREMENTS:**
1. Open with a compelling headline description of the vehicle
2. Write a punchy 2-3 sentence overview that sells the vehicle immediately
3. Include a ## Vehicle Details section with key specs as bullet points
4. Include a ## Key Features & Highlights section (bullet list)
5. Include a ## Condition & History section — be honest and specific
6. Include a ## Why Buy This Vehicle? section with 3 strong selling points
7. End with a clear CTA — call, message, or visit to view
8. Tone: honest, enthusiastic, and professional
9. Never exaggerate condition or hide known issues
${formattingRules}${answerShape}
${seoBlock}`;

        case 'landing_page':
            return `**CONTENT BRIEF:**
- Offer: ${m.offer || title}
- Target Audience: ${m.target_audience || 'Not specified'}
- Main Benefit: ${m.main_benefit || 'Not specified'}
- Common Objections: ${m.objections || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**LANDING PAGE REQUIREMENTS:**
1. Open with a powerful headline and subheading that state the core benefit immediately
2. Write a hero paragraph — what it is, who it's for, what they get
3. ## Key Benefits section — 3-5 benefits, each with a bold headline and 2-3 sentences
4. ## How It Works — 3 simple steps
5. ## Who Is This For? — paint the picture of the ideal customer
6. ## Common Questions — address the objections listed above directly
7. ## Social Proof placeholder — "[Testimonial 1]", "[Testimonial 2]"
8. End with a strong, specific CTA above and below the fold
9. Tone: direct, confident, benefit-led — every word must earn its place
${formattingRules}${answerShape}
${seoBlock}`;

        case 'press_release':
            return `**CONTENT BRIEF:**
- Announcement: ${m.announcement || title}
- Quote Attribution: ${m.quote_attribution || 'Company spokesperson'}
- Location: ${m.location || 'London, UK'}
- Primary Keyword: ${primaryKeyword || title}

**PRESS RELEASE REQUIREMENTS:**
1. Start with: FOR IMMEDIATE RELEASE
2. Write a dateline: ${m.location || 'London'} — [Today's Date]
3. Strong headline (already provided as title)
4. Lead paragraph answers: Who, What, When, Where, Why
5. Second paragraph expands on the announcement with key details
6. Include a quote from ${m.quote_attribution || 'a company spokesperson'}
7. Include a "About [Company]" boilerplate section at the end
8. End with: ### (press release standard end marker)
9. Contact details placeholder: "For media enquiries contact: [NAME] at [EMAIL]"
10. Tone: formal, factual, and newsworthy
${formattingRules}${answerShape}
${seoBlock}`;

        case 'job_listing':
            return `**CONTENT BRIEF:**
- Job Title: ${m.job_title || title}
- Location: ${m.location || 'Not specified'}
- Salary: ${m.salary || 'Competitive'}
- Key Responsibilities: ${m.key_responsibilities || 'Not specified'}
- Requirements: ${m.requirements || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}

**JOB LISTING REQUIREMENTS:**
1. Open with an engaging 2-3 sentence overview of the role and company culture
2. ## About the Role — what they'll actually be doing day to day
3. ## Key Responsibilities — bullet list of 6-8 responsibilities
4. ## What We're Looking For — bullet list of must-haves and nice-to-haves
5. ## What We Offer — salary, benefits, culture, perks
6. ## About Us — 2-3 sentences about the company
7. End with clear application instructions placeholder
8. Tone: welcoming and human — job ads should attract, not intimidate
${formattingRules}${answerShape}
${seoBlock}`;

        case 'review_comparison':
            return `**CONTENT BRIEF:**
- Review Type: ${m.review_type || 'Head-to-Head Comparison'}
- Products / Services: ${m.products || title}
- Overall Verdict: ${m.verdict || 'To be determined based on analysis'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**REVIEW / COMPARISON REQUIREMENTS:**
1. Open with why this comparison/review matters to the reader
2. Include a summary comparison table near the top
3. Cover each product/option with its own ## section
4. For each: overview, key strengths, weaknesses, who it's best for
5. Include a ## Head-to-Head comparison by key criteria
6. Include a ## Our Verdict section with a clear recommendation
7. Add a FAQ section addressing common buying questions
8. Disclose if content may contain affiliate links (placeholder)
9. Tone: honest, balanced, and genuinely helpful — readers trust reviewers who acknowledge flaws
${formattingRules}${answerShape}
${seoBlock}`;

        case 'email_newsletter':
            return `**CONTENT BRIEF:**
- Audience: ${m.audience || 'Newsletter subscribers'}
- Main Topic: ${m.main_topic || title}
- CTA: ${m.cta || 'Read more'}
- Primary Keyword: ${primaryKeyword || title}

**EMAIL NEWSLETTER REQUIREMENTS:**
1. Start with: SUBJECT LINE: [compelling subject line, max 50 chars]
2. Then: PREVIEW TEXT: [preview text, max 90 chars]
3. Then: --- EMAIL BODY ---
4. Open with a personal, conversational hook (1-2 sentences)
5. Main content section — valuable, interesting, on-topic
6. Include 1-2 subheadings to break up the content
7. Keep paragraphs short — 2-3 sentences max for email readability
8. Include a clear, single CTA button placeholder: [CTA: ${m.cta || 'Read more'}]
9. Sign off warmly
10. Tone: personal, valuable, conversational — like an email from a trusted friend
${formattingRules}${answerShape}
${seoBlock}`;

        case 'video_script':
            return `**CONTENT BRIEF:**
- Platform: ${m.platform || 'YouTube'}
- Duration: ${m.duration || '5 minutes'}
- Style: ${m.style || 'Educational'}
- Topic: ${title}
- Primary Keyword: ${primaryKeyword || title}

**VIDEO SCRIPT REQUIREMENTS:**
1. Start with: [HOOK - 0:00-0:15] — an attention-grabbing opening line/question
2. [INTRO - 0:15-0:30] — what the video covers and why they should watch
3. Main content broken into clearly labelled sections with timestamps (approximate)
4. Include [B-ROLL SUGGESTION: ...] notes throughout for visual variety
5. Include [ON SCREEN TEXT: ...] suggestions for key points
6. [OUTRO] — summary of key points, subscribe/follow CTA, next video suggestion
7. Write in natural spoken English — contractions, short sentences, conversational
8. For ${m.platform || 'YouTube'} optimise for ${m.duration || '5 minutes'} — pace accordingly
9. Tone: ${m.style || 'Educational'} — match the energy to the platform and style
${formattingRules}${answerShape}
${seoBlock}`;

        case 'social_media': {
            const platforms = m.platforms
                ? (Array.isArray(m.platforms) ? m.platforms : m.platforms.split(','))
                : ['LinkedIn'];
            const variations = parseInt(m.variations || '1');
            const goal = m.post_goal || 'Brand Awareness';

            const platformGuidelines = platforms.map(p => {
                const guidelines = {
                    'LinkedIn':     `LinkedIn: Professional tone, 150-300 words, 3-5 hashtags, thought leadership angle, no slang`,
                    'Facebook':     `Facebook: Conversational, 40-80 words optimal, question or story hook, 1-2 hashtags`,
                    'Instagram':    `Instagram: Visual-first, 125-150 words, 10-20 relevant hashtags, emoji-friendly, strong hook in line 1`,
                    'X (Twitter)':  `X (Twitter): Max 280 chars per tweet, punchy and direct, 1-2 hashtags, consider thread format`,
                    'TikTok':       `TikTok: Hook in first 2 seconds, casual and energetic, trending-aware, 3-5 hashtags, very short`,
                };
                return guidelines[p] || `${p}: Appropriate tone and format for the platform`;
            }).join('\n');

            return `**CONTENT BRIEF:**
- Topic: ${title}
- Primary Keyword: ${primaryKeyword || title}
- Platforms: ${platforms.join(', ')}
- Variations per Platform: ${variations}
- Goal: ${goal}

**SOCIAL MEDIA POST REQUIREMENTS:**
For each platform, write ${variations} variation${variations > 1 ? 's' : ''}. Label clearly as:

## [Platform Name] — Variation 1
[post content]

## [Platform Name] — Variation 2
[post content]

Platform-specific guidelines:
${platformGuidelines}

General rules:
1. Hook must stop the scroll — first line is everything
2. Every post must serve the goal: ${goal}
3. Include a CTA on every post
4. Write authentically — not like a press release
5. Hashtags at the end, not scattered through the copy (except TikTok/Instagram)
${formattingRules}${answerShape}
${seoBlock}`;
        }

        case 'policy_procedure':
            return `**CONTENT BRIEF:**
- Policy: ${m.policy_type || title}
- Audience: ${m.audience || 'All employees'}
- Key Points: ${m.key_points || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}

**POLICY & PROCEDURE REQUIREMENTS:**
1. ## 1. Purpose — why this policy exists (2-3 sentences)
2. ## 2. Scope — who this applies to
3. ## 3. Policy Statement — the core position of the organisation
4. ## 4. Responsibilities — who is responsible for what (use a table if multiple roles)
5. ## 5. Procedure — numbered step-by-step process
6. ## 6. Compliance & Consequences — what happens if not followed
7. ## 7. Review Date — placeholder: "This policy will be reviewed on [DATE]"
8. Document version placeholder: "Version 1.0 | [DATE] | Approved by: [NAME]"
9. Tone: formal, clear, and unambiguous — no room for misinterpretation
${formattingRules}${answerShape}
${seoBlock}`;

        case 'onboarding_doc':
            return `**CONTENT BRIEF:**
- Role: ${m.role || 'New Starter'}
- Company: ${m.company_name || 'The Company'}
- Key Information: ${m.key_info || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**ONBOARDING DOCUMENT REQUIREMENTS:**
1. Open with a warm, genuine welcome — make the new starter feel valued
2. ## Your First Week — what to expect, day by day overview
3. ## Key Contacts — placeholder table: Name | Role | Email | Best way to reach
4. ## Tools & Systems — list of key tools with brief description
5. ## Company Culture — values, ways of working, do's and don'ts
6. ## Key Policies to Know — brief list with links placeholder
7. ## Your 30/60/90 Day Goals — outline of expectations
8. End with an encouragement and open door message
9. Tone: warm, clear, and reassuring — first days are stressful enough
${formattingRules}${answerShape}
${seoBlock}`;

        case 'course_overview':
            return `**CONTENT BRIEF:**
- Course: ${m.course_name || title}
- Target Audience: ${m.audience || 'Not specified'}
- Duration: ${m.duration || 'Not specified'}
- Number of Modules: ${m.num_modules || '6'}
- Primary Keyword: ${primaryKeyword || title}

**COURSE OVERVIEW REQUIREMENTS:**
1. ## Course Overview — 2-3 sentences summarising the course
2. ## What You'll Learn — 5-8 learning outcomes as bullet points
3. ## Who This Course Is For — describe the ideal learner in detail
4. ## Prerequisites — what knowledge or tools are needed (if any)
5. ## Course Structure — list ${m.num_modules || '6'} module titles with 1-sentence description each
6. ## Time Commitment — expected hours per week
7. ## What's Included — videos, quizzes, assignments, certificate etc. (as applicable)
8. ## Meet Your Instructor — placeholder bio section
9. Tone: motivating and clear — learners should feel excited and prepared
${formattingRules}${answerShape}
${seoBlock}`;

        case 'training_module':
            return `**CONTENT BRIEF:**
- Module: ${m.module_title || title}
- Learning Objectives: ${m.learning_objectives || 'Not specified'}
- Audience Level: ${m.audience_level || 'Intermediate'}
- Knowledge Check Questions: ${m.num_questions || '5'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**TRAINING MODULE REQUIREMENTS:**
1. ## Module Introduction — context and why this topic matters (1 paragraph)
2. ## Learning Objectives — bullet list: "By the end of this module you will be able to..."
3. Main content divided into 3-5 clear sections, each with its own H2
4. Each section: concept explanation, example, practical application
5. ## Key Takeaways — 5-7 bullet point summary
6. ## Knowledge Check — ${m.num_questions || '5'} multiple choice questions to test understanding
   Write each in human-readable format:
   Q1. [Question]
   A) [Option]  B) [Option]  C) [Option]  D) [Option]
   Correct: [letter] — [one sentence explanation]
7. ## Further Reading / Resources — placeholder list
8. Tone: clear, engaging, and educational — avoid jargon unless the audience level warrants it

---CRITICAL: After the human-readable content above, append this EXACT structured block so the knowledge check can be auto-built as a quiz in the LMS---

---QUIZ_DATA_START---
{
  "quiz_intro": "[1-2 sentence intro for the knowledge check]",
  "question_type": "multiple_choice",
  "questions": [
    {
      "text": "[question text]",
      "type": "multiple_choice",
      "answers": [
        { "text": "[answer]", "correct": false },
        { "text": "[answer]", "correct": true },
        { "text": "[answer]", "correct": false },
        { "text": "[answer]", "correct": false }
      ],
      "explanation": "[why the correct answer is correct]"
    }
  ]
}
---QUIZ_DATA_END---

JSON rules: exactly ${m.num_questions || '5'} questions | exactly 4 answers per question | exactly 1 correct:true | CRITICAL: vary which position holds the correct answer across questions — distribute correct answers roughly evenly across A/B/C/D, never default to the first slot (a quiz where every correct answer is option A is unusable) | valid JSON, escape inner quotes
${formattingRules}${answerShape}
${seoBlock}`;

        case 'case_study_ld':
            return `**CONTENT BRIEF:**
- Scenario: ${m.scenario_context || title}
- Learning Focus: ${m.learning_focus || 'Not specified'}
- Discussion Questions: ${m.num_questions || '5'}
- Primary Keyword: ${primaryKeyword || title}

**L&D CASE STUDY REQUIREMENTS:**
1. ## Background — set the scene clearly (who, what, where, context)
2. ## The Situation — describe the challenge or problem in detail
3. ## The Decision Point — what choice or action must be taken?
4. ## What Happened — describe the outcome (can leave open-ended for discussion)
5. ## Discussion Questions — ${m.num_questions || '5'} thoughtful questions for group or individual reflection
6. ## Learning Points — 4-6 key lessons from this scenario
7. ## Facilitator Notes — tips for how to run this case study in a training session
8. Tone: realistic, neutral, and thought-provoking — avoid making it too obvious
${formattingRules}${answerShape}
${seoBlock}`;

        case 'explainer_guide':
            return `**CONTENT BRIEF:**
- Concept: ${m.concept || title}
- Audience Level: ${m.audience_level || 'Beginner'}
- Use Analogies: ${m.analogy_style || 'Yes — use everyday analogies'}
- Primary Keyword: ${primaryKeyword || title}
- Target Length: ${acbLengthGuidance(contentTypeId, targetWordCount)}

**EXPLAINER / CONCEPT GUIDE REQUIREMENTS:**
1. Open by explaining why understanding this concept matters
2. ## What Is ${m.concept || title}? — a plain English definition
3. ${m.analogy_style?.includes('Yes') ? '## The Simple Analogy — explain using an everyday comparison' : '## Technical Definition — precise explanation'}
4. ## How It Works — break it down into digestible components
5. ## Real-World Examples — 2-3 concrete examples
6. ## Common Misconceptions — address 2-3 things people get wrong
7. ## Why It Matters — practical relevance for the ${m.audience_level || 'beginner'} audience
8. ## Summary — 5 bullet point recap
9. Tone: patient, clear, and encouraging — never condescending
${formattingRules}${answerShape}
${seoBlock}`;

        case 'quiz_assessment':
            return `**CONTENT BRIEF:**
- Topic: ${title}
- Question Type: ${m.quiz_type || 'Multiple Choice'}
- Number of Questions: ${m.num_questions || '10'}
- Difficulty: ${m.difficulty || 'Medium'}
- Include Answer Key: ${m.include_answers || 'Yes'}
- Primary Keyword: ${primaryKeyword || title}

**QUIZ / ASSESSMENT REQUIREMENTS:**
1. Write a brief introduction paragraph for the quiz (2-3 sentences, no heading)
2. Generate exactly ${m.num_questions || '10'} questions in human-readable format:
   Q1. [Question]
   A) [Option]  B) [Option]  C) [Option]  D) [Option]
   ${m.include_answers !== 'No' ? 'Correct: [letter] — [one sentence explanation]' : '(no answers — assessment only)'}
3. Questions progress from easier to harder, covering different aspects
4. Difficulty: ${m.difficulty || 'Medium'} | Tone: clear, unambiguous

---CRITICAL: After the human-readable quiz above, append this EXACT structured block---

---QUIZ_DATA_START---
{
  "quiz_intro": "[2-3 sentence intro]",
  "question_type": "${(m.quiz_type || 'Multiple Choice').toLowerCase().replace(' / ', '_').replace(' ', '_')}",
  "questions": [
    {
      "text": "[question text]",
      "type": "${m.quiz_type === 'True / False' ? 'true_false' : m.quiz_type === 'Open Questions' ? 'open' : 'multiple_choice'}",
      "answers": [
        { "text": "[answer]", "correct": false },
        { "text": "[answer]", "correct": false },
        { "text": "[answer]", "correct": true },
        { "text": "[answer]", "correct": false }
      ],
      "explanation": "[why the correct answer is correct]"
    }
  ]
}
---QUIZ_DATA_END---

JSON rules: exactly ${m.num_questions || '10'} questions | True/False: 2 answers only, type=true_false | Open: no answers array, add model_answer field, type=open | Multiple Choice: exactly 4 answers, exactly 1 correct:true | CRITICAL: vary which position holds the correct answer across questions — distribute correct answers roughly evenly across all positions, never default to the first slot (a quiz where every correct answer is option A is unusable) | Valid JSON, escape inner quotes
${formattingRules}${answerShape}
${seoBlock}`;

        case 'learning_objective':
            return `**CONTENT BRIEF:**
- Topic / Module: ${m.topic || title}
- Bloom's Taxonomy Level: ${m.bloom_level || 'Mixed'}
- Number of Objectives: ${m.num_objectives || '5'}
- Primary Keyword: ${primaryKeyword || title}

**LEARNING OBJECTIVE REQUIREMENTS:**
1. Write a brief intro: "These learning objectives are written using Bloom's Taxonomy..."
2. Generate exactly ${m.num_objectives || '5'} learning objectives
3. Format each as: "By the end of this [module/course/session], learners will be able to..."
4. Use appropriate action verbs for the ${m.bloom_level || 'appropriate'} Bloom's level:
   - Remember: define, list, recall, recognise
   - Understand: explain, summarise, describe, interpret
   - Apply: use, demonstrate, solve, implement
   - Analyse: compare, differentiate, examine, break down
   - Evaluate: assess, judge, justify, critique
   - Create: design, develop, construct, produce
5. Each objective must be Specific, Measurable, Achievable, Relevant, and Time-bound (SMART)
6. Include a note on how each objective could be assessed
${formattingRules}${answerShape}
${seoBlock}`;

        case 'event_description':
            return `**CONTENT BRIEF:**
- Event: ${title}
- Date & Time: ${m.event_date || 'TBC'}
- Venue: ${m.event_location || 'TBC'}
- Event Type: ${m.event_type || 'Event'}
- Ticket Price: ${m.ticket_price || 'See website'}
- Organiser: ${m.organiser || ''}
- Audience: ${m.target_audience || 'General public'}
- Agenda: ${m.agenda || ''}
- Event URL: ${m.event_url || ''}

**EVENT DESCRIPTION REQUIREMENTS:**
1. Open with an attention-grabbing hook — why this event matters right now
2. Write a compelling 2-3 sentence overview of the event
3. ## What You'll Experience — 3-4 bullet points of key highlights or sessions
4. ## Who Should Attend — clear audience description, make them feel this is for them
5. ## Event Details — date, time, location, format (in-person/online/hybrid), cost
6. ## About the Organiser — 2-3 sentences if organiser info provided
7. Close with a clear, urgent CTA to register or find out more
8. Tone: energetic, professional, persuasive — make the reader excited to attend
9. If event_url is provided, reference it naturally in the CTA
${formattingRules}${answerShape}
${seoBlock}`;

        case 'workshop_guide':
            return `**CONTENT BRIEF:**
- Workshop: ${m.workshop_topic || title}
- Duration: ${m.duration || '2 hours'}
- Participants: ${m.num_participants || '10-15'}
- Format: ${m.format || 'In-person'}
- Primary Keyword: ${primaryKeyword || title}

**WORKSHOP FACILITATION GUIDE REQUIREMENTS:**
1. ## Workshop Overview — topic, objectives, and expected outcomes
2. ## Pre-Workshop Preparation — what the facilitator needs to prepare
3. ## Materials Required — flipchart, pens, handouts, tech setup etc.
4. ## Detailed Agenda — time-stamped breakdown for ${m.duration || '2 hours'}:
   - Opening / Icebreaker
   - Content sections
   - Activities / exercises
   - Breaks
   - Closing / Action planning
5. ## Facilitator Notes — tips for each section, what to watch for
6. ## Activities — detailed instructions for each exercise
7. ## Discussion Prompts — questions to spark conversation
8. ## Closing — how to summarise and agree next steps
9. Tone: practical and actionable — a facilitator should be able to run this cold
${formattingRules}${answerShape}
${seoBlock}`;

        case 'sop':
            return `**CONTENT BRIEF:**
- Process: ${m.process_name || title}
- Department: ${m.department || 'Not specified'}
- Roles Involved: ${m.roles || 'Not specified'}
- Key Steps: ${m.key_steps || 'Not specified'}
- Primary Keyword: ${primaryKeyword || title}

**STANDARD OPERATING PROCEDURE REQUIREMENTS:**
1. Document header: SOP Title | Department | Version | Date | Owner
2. ## 1. Purpose — what this SOP achieves (2-3 sentences)
3. ## 2. Scope — who must follow this procedure
4. ## 3. Definitions — any key terms or acronyms explained
5. ## 4. Roles & Responsibilities — table: Role | Responsibility
6. ## 5. Procedure — numbered steps, each with:
   - Clear action statement
   - Who performs it
   - Any decision points or conditional steps
7. ## 6. Quality Checks — how to verify the process was completed correctly
8. ## 7. Related Documents — placeholder list
9. ## 8. Review Schedule — "This SOP will be reviewed every [X months]"
10. Tone: precise, unambiguous, and sequential — no room for interpretation
${formattingRules}${answerShape}
${seoBlock}`;

        default:
            // Fallback to blog post
            return buildPrompt('blog_post', title, primaryKeyword, targetWordCount, meta);
    }
}

module.exports = { CONTENT_TYPES, TIER_RANK, canAccessContentType, buildPrompt, LENGTH_PROFILES, resolveTargetWords, maxTokensFor, acbLengthGuidance };