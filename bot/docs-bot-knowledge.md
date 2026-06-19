# AI Content Bridge — support assistant knowledge base

Generated 2026-06-19 from the live documentation. This is the complete product
documentation. Answer from it, and link people to the URL of the relevant page.

## Page index

- Core concepts — https://docs.aicontentbridge.com/core-concepts
- Troubleshooting & FAQ — https://docs.aicontentbridge.com/troubleshooting
- Getting started — https://docs.aicontentbridge.com/getting-started
- Account & billing — https://docs.aicontentbridge.com/account-billing
- Content types overview — https://docs.aicontentbridge.com/content-types
- Blog Post / Article — https://docs.aicontentbridge.com/content-types/blog-post
- Tutorial / How-To — https://docs.aicontentbridge.com/content-types/tutorial
- FAQ Page — https://docs.aicontentbridge.com/content-types/faq-page
- Review / Comparison Article — https://docs.aicontentbridge.com/content-types/review-comparison
- Email Newsletter — https://docs.aicontentbridge.com/content-types/email-newsletter
- Video Script — https://docs.aicontentbridge.com/content-types/video-script
- Social Media Post — https://docs.aicontentbridge.com/content-types/social-media
- Event Description — https://docs.aicontentbridge.com/content-types/event-description
- WooCommerce Product — https://docs.aicontentbridge.com/content-types/woocommerce-product
- Service Page — https://docs.aicontentbridge.com/content-types/service-page
- Vehicle Listing — https://docs.aicontentbridge.com/content-types/vehicle-listing
- Landing Page — https://docs.aicontentbridge.com/content-types/landing-page
- About Us / Company Page — https://docs.aicontentbridge.com/content-types/about-us
- Press Release — https://docs.aicontentbridge.com/content-types/press-release
- Job Listing — https://docs.aicontentbridge.com/content-types/job-listing
- Policy & Procedure — https://docs.aicontentbridge.com/content-types/policy-procedure
- Onboarding Document — https://docs.aicontentbridge.com/content-types/onboarding-doc
- Course Overview / Syllabus — https://docs.aicontentbridge.com/content-types/course-overview
- Training Module / Lesson — https://docs.aicontentbridge.com/content-types/training-module
- Case Study (L&D) — https://docs.aicontentbridge.com/content-types/case-study
- Explainer / Concept Guide — https://docs.aicontentbridge.com/content-types/explainer-guide
- Quiz / Assessment — https://docs.aicontentbridge.com/content-types/quiz-assessment
- Workshop Facilitation Guide — https://docs.aicontentbridge.com/content-types/workshop-guide
- Standard Operating Procedure — https://docs.aicontentbridge.com/content-types/sop
- Integrations overview — https://docs.aicontentbridge.com/integrations
- Integrations: SEO plugins — https://docs.aicontentbridge.com/integrations/integrations-seo
- Integrations: WooCommerce — https://docs.aicontentbridge.com/integrations/integrations-woocommerce
- Integrations: Custom fields (ACF) — https://docs.aicontentbridge.com/integrations/integrations-acf
- Integrations: LMS — https://docs.aicontentbridge.com/integrations/integrations-lms
- Integrations: Email — https://docs.aicontentbridge.com/integrations/integrations-email
- Integrations: Events — https://docs.aicontentbridge.com/integrations/integrations-events
- For agencies — https://docs.aicontentbridge.com/for-agencies
- Developer docs — https://docs.aicontentbridge.com/developer-docs


========================================================================
PAGE: Core concepts
URL: https://docs.aicontentbridge.com/core-concepts
META: slug=core-concepts | section=Core concepts | updated=2026-06-19
========================================================================

# Core concepts

This page explains the ideas that everything else in AI Content Bridge builds on: how credits are charged, what each plan unlocks, how the SEO score and SERP grounding work, and how brand voice shapes every generation. If you only read one page before you start, read this one.

## Credits

Credits are charged by **content type**, not by word count. Each type has a fixed base cost of 1, 2 or 3 credits depending on its complexity, and an optional featured image adds 1 credit on the types that support it. A target word count is used to guide length, but it does **not** change what you pay.

| Cost | Content types |
|---|---|
| 1 credit | FAQ Page, WooCommerce Product, About Us, Vehicle Listing, Press Release, Job Listing, Email Newsletter, Social Media Post, Event Description |
| 2 credits | Blog Post, Tutorial, Service Page, Video Script, Policy & Procedure, Onboarding Document, Explainer Guide, Standard Operating Procedure |
| 3 credits | Landing Page, Review / Comparison, Course Overview, Training Module, Case Study, Quiz & Assessment, Workshop Guide |
| +1 credit | Featured image, on any type that offers it |

The most a single generation can cost is 4 credits — a 3-credit type with an image added. The live cost is always shown before you generate, so there are no surprises.

If a generation fails after the credits have been deducted, they're **refunded automatically** — you're only charged for content you actually receive.

Each plan includes a monthly credit allowance that resets every month. One-time credit **bundles** can be bought on top of any plan and don't expire. If you're on annual billing, your allowance is delivered as a monthly drip rather than a year's worth up front. See the pricing page for current allowances and prices.

## Tiers and access

There are four tiers, and your tier controls which content types and features you can use. Higher tiers include everything in the tiers below them.

- **Free** — the Blog Post type, an AI featured image, SEO meta, on a single site. The entry point.
- **Starter** — adds Tutorial, FAQ Page, WooCommerce Product, Service Page and About Us, plus the Content Diary.
- **Pro** — adds the rest of the marketing and operations types (Landing Page, Press Release, Job Listing, Review / Comparison, Email Newsletter, Video Script, Social Media Post, Policy & Procedure, Onboarding Document, Event Description), plus Writing Style Profiles, ACF field targeting and the email and events integrations.
- **Agency** — adds the full Learning & Development suite (Course Overview, Training Module, Case Study, Explainer Guide, Quiz & Assessment, Workshop Guide and Standard Operating Procedure), LMS publishing to LearnPress and LifterLMS, multi-site use and priority support.

For current prices and monthly credit allowances, see the pricing page.

## The SEO score

Every generation is given a deterministic SEO score from 0 to 100, calculated on the licence server with no external API call and no extra credit cost. It parses the SEO meta the model produces and grades the content against 13 weighted checks. Each check can **pass** (earns its full weight), **warn** (earns half) or **fail** (earns none); the score is the weighted percentage earned.

| Check | Weight | Passes when |
|---|---:|---|
| Keyword in SEO title | 12 | The focus keyword appears in the SEO title |
| Keyword in opening paragraph | 10 | The keyword appears early, in the first paragraph |
| Content length meets target | 10 | Word count is close to the target length |
| Keyword in meta description | 8 | The keyword appears in the meta description |
| Keyword in a subheading | 8 | The keyword appears in at least one H2/H3 |
| Keyword density in range | 8 | Density sits in a healthy band — not absent, thin or stuffed |
| SEO title length (30–60 chars) | 8 | Title is 30–60 characters |
| Meta description length (120–160) | 8 | Description is 120–160 characters |
| Has subheading structure | 8 | The content uses subheadings |
| Focus keyword is set | 6 | A focus keyword was provided |
| Contains at least one link | 6 | There's at least one link in the body |
| Readable (Flesch ≥ 50) | 6 | Flesch reading ease is 50 or above |
| Has featured image or video | 2 | A featured image or an embedded video is present |

The weights total 100. The grade banding is: **excellent** at 85 and above, **good** at 70–84, **ok** at 50–69, and **poor** below 50. The score appears as a compact chip on each Content Diary entry; clicking it opens the full report with the checks sorted worst-first and a plain-English fix for each.

A note on two of the checks: the title and description length bands are forgiving — a title up to 70 characters or a description from 80 to 175 warns rather than fails — and very short content is treated neutrally for readability rather than penalised.

## SERP grounding and the outline review

For keyword-led web content, AI Content Bridge reads the live top-ranking pages for your keyword (via a search API), extracts the topics competitors cover and the questions searchers ask, and uses that two ways. First, it **grounds the prompt** invisibly, so the article is written with an awareness of what already ranks. Second, it powers an editable **outline-review** step: before the full piece is generated you see a suggested structure — title, meta description, sections and an FAQ — plus a "content gap" highlighting the angle the ranking pages miss. You can edit the outline, and the approved version is what gets written.

The outline-review step applies only to keyword-led web types: Blog Post, Tutorial, FAQ Page, Service Page, About Us, Landing Page, Review / Comparison and Explainer Guide. Every other type — including the operational and L&D documents such as SOPs — generates straight through with no outline step. The SEO **score**, by contrast, is calculated on every type.

Both behaviours fail soft: if the search API key isn't configured or a lookup fails, grounding is silently skipped and the generation still completes — it just isn't search-grounded.

## Brand voice and Writing Style Profiles

A Brand Voice editor captures your tone, must-use keywords, banned phrases, audience and style notes, and injects them into every generation so output stays on-brand without re-prompting each time.

Writing Style Profiles go a step further: paste a writing sample and the AI extracts the voice, tone, sentence structure and signature moves, or pick a famous-writer template. Agencies can keep a separate profile per client and switch between them in one click — this is the feature most often cited as the reason to subscribe.

========================================================================
PAGE: Troubleshooting & FAQ
URL: https://docs.aicontentbridge.com/troubleshooting
META: slug=troubleshooting | section=Troubleshooting & FAQ | updated=2026-06-19
========================================================================

# Troubleshooting & FAQ

This page maps the things that can go wrong to what causes them and how to fix them. The wording in quotes is the actual message you'll see, so you can match it exactly.

First, the reassuring part: **a failed generation doesn't cost you credits.** Credits are deducted just before generation and refunded automatically if anything fails after that point. So if a generation errors out, you haven't paid for it.

## Licence and access errors

**"Invalid or inactive license key"** — the key doesn't match an active licence. Either it's been mistyped, or the licence is no longer active (cancelled, revoked or deleted). Check the key on the Licence screen of the customer portal and re-enter it exactly. If it should be active but isn't, check your billing status or raise a support ticket.

**"Insufficient credits"** — you don't have enough credits for this generation. Remember the cost is the content type's base cost plus 1 if you've added an image. A second, easy-to-miss cause: **credits expire**. Monthly allowances have an expiry, and expired credits no longer count toward a generation even if an old total still seems to show. Fix it by checking your live balance in the portal, buying a one-time bundle (bundles don't expire), waiting for your monthly reset, or lowering the cost — drop the image or pick a lighter type.

**"The [type] content type is not available on your current plan"** — a tier gate. That type is on a higher plan than yours. Upgrade to unlock it, or pick a type your plan includes. The same applies to a couple of features: ACF field targeting is Pro and above, and YouTube embedding is Starter and above — you'll see a matching notice in the plugin.

**"This license is registered to [domain]…"** — a licence locks to the **first domain** it's used on. Using it on a different domain is blocked, and the message names the domain it's tied to. To move it to a new site, contact support to transfer it.

## "Unauthorised" or a 401 when generating

This is a service-side authentication issue between the plugin and the generation server, not something wrong with your content or licence — it most often appears right after a security update on our side. Try reinstalling the plugin and re-saving your licence key first. If it persists, raise a support ticket; it's a configuration matter we resolve at the server end.

## A generation that hangs or times out

A full generation typically takes around 90 to 120 seconds, and the server allows up to roughly two minutes. A complex, very long piece can occasionally run close to that limit and look like it's stuck. Give it a moment, then check the Content Diary — the entry may well have completed. If it genuinely times out, your credits are refunded; try again, and consider a more modest target word count for very large pieces.

## "Generation rate limit exceeded"

To keep the service healthy there's a cap on how often you can generate from one connection in a short window, and similar limits on sign-in and registration. The message is **"Generation rate limit exceeded. Please wait before generating again."** Wait a short while and retry — nothing is wrong with your account.

## The article generated but didn't appear in WordPress

If generation succeeds but publishing back to your site fails, the server couldn't write to your site's REST API. The usual causes are the WordPress REST API being disabled, a security or firewall plugin blocking REST requests, permalinks not enabled, or the site being temporarily unreachable. Make sure pretty permalinks are on, the REST API is reachable, and any security plugin allows AI Content Bridge's requests. Credits are refunded when a publish fails.

## The image or video is missing, but the post published

Featured images and YouTube embeds are optional and **fail soft** — if the image model or the video lookup has a hiccup, the article still publishes, just without them. For video, it can also simply mean no strong match was found. Regenerate, or add the image or embed manually. Remember an image is only charged (+1 credit) when you opt in.

## The SEO score is lower than expected

The score grades your content against thirteen weighted checks (see Core concepts for the full list). The quickest wins are usually: set a focus keyword and make sure it appears in the SEO title, the opening paragraph and at least one subheading; keep the SEO title to 30–60 characters and the meta description to 120–160; include at least one link; and meet the target length. Open the score chip on the diary entry to see the report, which lists the weakest checks first with a fix for each.

## The outline-review step didn't appear

That's expected for most types. The editable outline-review step only runs for keyword-led web content — Blog Post, Tutorial, FAQ Page, Service Page, About Us, Landing Page, Review / Comparison and Explainer Guide — and only for new content. Operational and L&D types such as SOPs, and any regeneration, go straight to generation by design. (If the search service is briefly unavailable, generation also proceeds without grounding rather than failing.)

## An integration didn't fire

Integrations are detected automatically from the plugins active on your site. If the target plugin — WooCommerce, an SEO plugin, an LMS, MailPoet, Newsletter or The Events Calendar — isn't installed and active, AI Content Bridge falls back to a standard post. Confirm the plugin is active, and that you're on a tier that includes the integration (ACF targeting and the LMS suite are gated by plan).

## Getting support

If you're still stuck, raise a ticket from the **Support** screen of the customer portal. Your plan, registered domain and WordPress version are attached automatically. To get the fastest answer, include the content type you were using, the exact error message, and your WordPress version. Pro and Agency customers receive priority support.

========================================================================
PAGE: Getting started
URL: https://docs.aicontentbridge.com/getting-started
META: slug=getting-started | section=Getting started | updated=2026-06-19
========================================================================

# Getting started

This page takes you from a fresh install to your first published piece in a few minutes. AI Content Bridge generates complete, publish-ready content — article, SEO metadata and an optional image — without you needing any AI API keys of your own; the generation runs on the AI Content Bridge service and the finished content is sent back to your site.

## What you need

- A self-hosted WordPress site you can install plugins on.
- An AI Content Bridge licence key (from your purchase or free sign-up).
- Pretty permalinks enabled and the WordPress REST API reachable — these let the service publish back to your site. If you're on a default WordPress setup, this is already the case.

## Install and activate

1. Install the AI Content Bridge plugin on your site (upload the plugin or install it from your account, then activate it like any other plugin).
2. Open the AI Content Bridge settings in your WordPress admin.
3. Enter your **licence key** and save. The plugin validates the key with the service and, on first use, locks the licence to your site's domain (see Account & billing → Domain locking).

Once the key is accepted, you're ready to generate.

## Your first generation

1. Open AI Content Bridge and start a new piece.
2. Choose a **content type** — start with Blog Post / Article, which is available on every plan. (See the Content types overview for the full list.)
3. Fill in the form: a title, your primary keyword, and any fields specific to that type. Decide whether to include a featured image.
4. Generate. For keyword-led web types you'll first see an editable outline to review and approve; other types generate straight through. Generation usually takes around 90 seconds to two minutes.
5. The finished piece appears in your Content Diary with its SEO score. Review it, then publish to your site.

## The Content Diary

The Content Diary is your home view: every piece you generate is listed there with its content type, status and SEO score. From an entry you can open the full content, see the SEO report (with the weakest checks and how to fix them), and publish. It's also where you'll spot anything that needs attention, such as a low score or a piece that didn't publish.

## Where to go next

- New to how credits, plans and the SEO score work? Read Core concepts.
- Want to know what each content type does? See the Content types overview.
- Run other plugins like WooCommerce, an LMS or an SEO plugin? See Integrations.
- Something not working? See Troubleshooting & FAQ.

## Related

Core concepts · Content types overview · Account & billing · Troubleshooting & FAQ

========================================================================
PAGE: Account & billing
URL: https://docs.aicontentbridge.com/account-billing
META: slug=account-billing | section=Account & billing | updated=2026-06-19
========================================================================

# Account & billing

Your licence, credits, plan and billing are managed in the customer portal — separate from your WordPress site. This page covers signing in, what the portal shows, how credits and billing work, and how domain locking behaves.

## Signing in

The portal uses passwordless sign-in. Enter your email and you're sent a magic link; clicking it signs you in — there's no password to remember. Links are time-limited, and sign-in requests are rate-limited, so if you ask for several in quick succession you may be asked to wait before trying again.

## What the portal shows

Once signed in you can see your plan and tier, your current credit balance, the domain your licence is locked to, and your usage. It's also where you raise support tickets and manage your subscription.

## Credits

Your plan includes a monthly credit allowance that resets each month, and credits have an expiry — once expired they no longer count toward a generation. On top of your plan, you can buy one-time credit **bundles**, which do not expire and are used after your monthly allowance. If you're on annual billing, your allowance arrives as a monthly drip rather than a year's worth at once.

Credits are charged per content type (plus one for an optional image) and are refunded automatically if a generation fails. For the full model, see Core concepts → Credits.

## Managing your plan

Subscription changes — upgrading, downgrading, updating your payment method or cancelling — are handled through the billing portal linked from your account, which is powered by Stripe. Changes take effect according to your billing cycle.

For current plan prices and credit allowances, see the pricing page.

## Domain locking

A licence locks to the **first domain** it's used on. This protects your licence from being used elsewhere. If you try to use it on a different domain, generation is blocked and you'll see a message naming the domain the licence is registered to. To move a licence to a new site — for example after a rebuild or a domain change — contact support to transfer it.

## Getting support

Raise a ticket from the Support area of the portal. Your plan, registered domain and WordPress version are attached automatically, which helps resolve issues faster. Pro and Agency customers receive priority support.

## Related

Core concepts → Credits · Core concepts → Tiers and access · Troubleshooting & FAQ

========================================================================
PAGE: Content types overview
URL: https://docs.aicontentbridge.com/content-types
META: slug=content-types | section=Content types | updated=2026-06-19
========================================================================

# Content types overview

AI Content Bridge has 24 purpose-built content types, each with its own form and its own structured output. This page is the map — every type, what it costs, what it can include, and a one-line steer on when to reach for it. Types are grouped by the job they do, so pick the group that matches your task and scan from there. Each name links to its full reference page.

How to read the table:

- **Available on** — the lowest plan that includes the type. Higher plans include everything below them.
- **Credits** — the base cost. Add 1 credit if you include a featured image, on the types where an image is offered. The most any single generation can cost is 4 credits.
- **Image** — whether the featured-image option is offered for that type.
- **Outline review** — whether the editable, SERP-grounded outline step runs before generation. It applies only to keyword-led web content; everything else generates straight through. The SEO score, by contrast, is calculated on every type.

## Content Marketing

| Type | Available on | Credits | Image | Outline review | Use it when |
|---|---|---:|---|---|---|
| [Blog Post / Article](blog-post) | Free | 2 | Yes (+1) | Yes | You want a complete, search-aware article from a topic and keyword |
| [Tutorial / How-To](tutorial) | Starter | 2 | Yes (+1) | Yes | You're walking a reader through steps to achieve a result |
| [FAQ Page](faq-page) | Starter | 1 | Yes (+1) | Yes | You need a structured question-and-answer page |
| [Review / Comparison Article](review-comparison) | Pro | 3 | Yes (+1) | Yes | You're comparing products or options and want a verdict |
| [Email Newsletter](email-newsletter) | Pro | 1 | — | — | You're drafting a newsletter, optionally into MailPoet or TNP |
| [Video Script](video-script) | Pro | 2 | — | — | You need a spoken-word script rather than an article |
| [Social Media Post](social-media) | Pro | 1 | — | — | You want short, platform-ready social copy |
| [Event Description](event-description) | Pro | 1 | Yes (+1) | — | You're publishing an event, optionally to The Events Calendar |

## Sales & Commerce

| Type | Available on | Credits | Image | Outline review | Use it when |
|---|---|---:|---|---|---|
| [WooCommerce Product](woocommerce-product) | Starter | 1 | Yes (+1) | — | You need a product description with price and SKU fields |
| [Service Page](service-page) | Starter | 2 | Yes (+1) | Yes | You're describing a service you offer, optimised to rank |
| [Vehicle Listing](vehicle-listing) | Pro | 1 | — | — | You're listing a vehicle with its specifications |
| [Landing Page](landing-page) | Pro | 3 | Yes (+1) | Yes | You want a conversion-focused page for a campaign or offer |

## Business

| Type | Available on | Credits | Image | Outline review | Use it when |
|---|---|---:|---|---|---|
| [About Us / Company Page](about-us) | Starter | 1 | Yes (+1) | Yes | You're writing a company or about page |
| [Press Release](press-release) | Pro | 1 | — | — | You have an announcement to put out in release format |
| [Job Listing](job-listing) | Pro | 1 | — | — | You're advertising a role with responsibilities and requirements |
| [Policy & Procedure](policy-procedure) | Pro | 2 | — | — | You need a formal policy document |
| [Onboarding Document](onboarding-doc) | Pro | 2 | Yes (+1) | — | You're documenting how a new starter gets up to speed |

## Learning & Development

| Type | Available on | Credits | Image | Outline review | Use it when |
|---|---|---:|---|---|---|
| [Course Overview / Syllabus](course-overview) | Agency | 3 | Yes (+1) | — | You're outlining a course's structure and objectives |
| [Training Module / Lesson](training-module) | Agency | 3 | Yes (+1) | — | You're writing a lesson, optionally published to an LMS |
| [Case Study (L&D)](case-study) | Agency | 3 | Yes (+1) | — | You need a teaching case study with discussion points |
| [Explainer / Concept Guide](explainer-guide) | Agency | 2 | Yes (+1) | Yes | You're explaining a concept clearly and thoroughly |
| [Quiz / Assessment](quiz-assessment) | Agency | 3 | — | — | You need questions with structured, gradable answers |
| [Workshop Facilitation Guide](workshop-guide) | Agency | 3 | — | — | You're running a workshop and need a facilitator's guide |
| [Standard Operating Procedure](sop) | Agency | 2 | — | — | You're documenting a repeatable process step by step |

The same SEO score runs on every type in this table, and credits are refunded automatically if a generation fails. For how credits, tiers and the SEO layer work, see Core concepts.

========================================================================
PAGE: Blog Post / Article
URL: https://docs.aicontentbridge.com/content-types/blog-post
META: slug=blog-post | group=Content Marketing | tier=free | credits=2 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Blog Post / Article

> An SEO-optimised long-form article — hook, structured headings, an FAQ section and a natural call to action.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Free |
| **Credit cost** | 2 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Blog Post type produces a complete, search-aware article from a title and keyword: a strong opening hook, the keyword placed early, clear H2/H3 structure targeting related terms, an FAQ section, and a natural closing call to action. It's the default type and the one available on every plan, including Free.

## When to use it — and when not to

Use it for standard articles and blog content. For a step-by-step "how to" use Tutorial / How-To; for a questions page use FAQ Page; for a products write-up use Review / Comparison Article; for a service you sell use Service Page.

## The form, field by field

- **Title** — the article title.
- **Primary keyword** — placed within the first 100 words and used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 1,500 words by default); it does not change the credit cost.

This type has no extra fields — title, keyword and length are all it needs.

## Credits and access

On the Free plan and above, 2 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A full article in clean Markdown: a hook that addresses the reader's need, the keyword in the opening, H2/H3 subheadings targeting secondary terms, supporting statistics or examples for credibility, lists where they aid readability, a schema-ready FAQ section of four to six questions, and a natural (not salesy) call to action. It aims for a Flesch reading ease of 60 or higher and avoids filler phrases. It publishes as a draft post, with SEO meta and an optional featured image.

## SEO behaviour

Both behaviours apply. The SEO score is calculated and shown on the Content Diary entry. And because a blog post is keyword-led web content, the editable SERP outline-review step runs first: you'll see a suggested structure plus a content-gap callout, can edit it, and the approved outline is what gets written. If the search service is briefly unavailable, generation proceeds without grounding rather than failing.

## Worked example

**Inputs**

- Title: `How to choose a CRM for a small team`
- Primary keyword: `small business CRM`
- Target word count: `1500`

**Example output (abridged)**

> *Hook addressing the reader's problem, with "small business CRM" in the first lines…*
>
> ## What a CRM actually does for a small team
> *(…H2/H3 sections, examples, a list or two…)*
>
> ## Frequently asked questions
> **Do I need a CRM if I only have a handful of customers?**
> *(…four to six Q&As, then a natural CTA.)*

## Tips and common pitfalls

- A specific, searchable primary keyword produces a sharper article than a broad one.
- Use the outline-review step to claim the content gap before generating.
- Set a realistic target length for the topic; padding hurts the readability score.

## Related

Tutorial / How-To, FAQ Page, Review / Comparison Article · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Tutorial / How-To
URL: https://docs.aicontentbridge.com/content-types/tutorial
META: slug=tutorial | group=Content Marketing | tier=starter | credits=2 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Tutorial / How-To

> A step-by-step guide — prerequisites, numbered steps, troubleshooting and next steps.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Starter |
| **Credit cost** | 2 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Tutorial type writes a clear, ordered how-to: what the reader will achieve, what they need first, numbered steps each with its own heading, callouts for tips and warnings, a troubleshooting section, and next steps. It's for task-based content where the reader is trying to *do* something.

## When to use it — and when not to

Use it for "how to do X" content. To explain a concept rather than a task use Explainer / Concept Guide; for a general article use Blog Post; for an internal repeatable process use Standard Operating Procedure.

## The form, field by field

- **Title** — the tutorial title; also used as the topic.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 1,200 words by default); it does not change the credit cost.
- **Difficulty Level** — beginner, intermediate or advanced; sets the assumed starting knowledge.
- **Estimated Time** — how long the task takes, shown to the reader. *Example:* `30 minutes`.

## Credits and access

On the Starter plan and above, 2 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A tutorial in clean Markdown: an opening on what the reader will achieve, a prerequisites list, clearly numbered steps (each an H3), tips and warnings where useful, a troubleshooting section covering common mistakes, and next steps or related tutorials. Code blocks are used if any commands or code are involved. It publishes as a draft post, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and because a tutorial is keyword-led web content, the editable SERP outline-review step runs first with a content-gap callout. If the search service is unavailable, generation proceeds ungrounded rather than failing.

## Worked example

**Inputs**

- Title: `How to set up two-factor authentication in WordPress`
- Difficulty Level: `Beginner`
- Estimated Time: `15 minutes`

**Example output (abridged)**

> By the end of this tutorial you'll have two-factor authentication protecting your WordPress login.
>
> **Prerequisites:** an admin account, a phone with an authenticator app.
>
> ### Step 1 — Install a 2FA plugin
> *(…numbered steps, a Pro tip or two, then a Troubleshooting section.)*

## Tips and common pitfalls

- Set the Difficulty Level honestly — it controls how much prior knowledge the steps assume.
- A realistic Estimated Time sets reader expectations and reduces drop-off.
- Use the outline-review step to make sure you cover the steps the ranking guides miss.

## Related

Blog Post / Article, Explainer / Concept Guide, Standard Operating Procedure · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: FAQ Page
URL: https://docs.aicontentbridge.com/content-types/faq-page
META: slug=faq-page | group=Content Marketing | tier=starter | credits=1 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# FAQ Page

> A schema-ready FAQ page — an intro, a set number of questions as headings, and concise, thorough answers.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Starter |
| **Credit cost** | 1 credit (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The FAQ Page type produces a structured questions-and-answers page that's formatted to be eligible for FAQ rich results: a short intro, your chosen number of questions as H2 headings, and answers that are thorough but concise. It's for pages whose whole job is to answer the common questions about a topic, product or service.

## When to use it — and when not to

Use it when the content is genuinely a set of questions and answers. For a full article that happens to end with a few FAQs, use Blog Post (which includes an FAQ section). For step-by-step instructions use Tutorial / How-To.

## The form, field by field

- **Title** — the page title / topic the FAQ covers.
- **Primary keyword** — used for the SEO meta and woven into at least three questions.
- **Target word count** — guides length only; it does not change the credit cost.
- **Number of Questions** — exactly how many questions to generate (8 by default).

## Credits and access

On the Starter plan and above, 1 credit plus 1 for an optional image — one of the cheapest types. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A clean FAQ in Markdown: a two-to-three-sentence intro, then exactly the number of questions you asked for. Each question is an H2 heading with a two-to-five-sentence answer, ordered from most basic to most advanced, with the primary keyword woven naturally into several questions. The structure is FAQPage schema-ready (questions as headings, answers as paragraphs) and it ends with a brief "Still have questions?" call to action. It publishes as a draft post or page, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and the editable SERP outline-review step runs first because an FAQ is keyword-led web content. The People-Also-Ask questions surfaced during grounding are especially useful for an FAQ. If the search service is unavailable, generation proceeds ungrounded.

## Worked example

**Inputs**

- Title: `Electric car charging at home`
- Primary keyword: `home EV charging`
- Number of Questions: `8`

**Example output (abridged)**

> Everything you need to know about charging an electric car at home…
>
> ## Do I need a special charger to charge an EV at home?
> *(…concise answer…)*
>
> ## How much does home EV charging cost?
> *(…eight questions in total, ending with a "Still have questions?" CTA.)*

## Tips and common pitfalls

- Set Number of Questions to the real number you need — the type generates exactly that many.
- Lean on the outline-review step's People-Also-Ask list to make sure you answer what people actually search.
- Keep the topic focused; a sprawling topic produces shallow answers.

## Related

Blog Post / Article, Tutorial / How-To · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Review / Comparison Article
URL: https://docs.aicontentbridge.com/content-types/review-comparison
META: slug=review-comparison | group=Content Marketing | tier=pro | credits=3 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Review / Comparison Article

> "X vs Y" or "Best X for Y" — a balanced review with a comparison table, per-option sections and a clear verdict.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Pro |
| **Credit cost** | 3 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Review / Comparison type writes a high-traffic, decision-focused article — a head-to-head comparison or a "best X for Y" roundup — with a summary table, a section per option, a head-to-head by criteria, and an honest verdict. It's ideal for buying-intent and affiliate content.

## When to use it — and when not to

Use it when the reader is choosing between options or deciding whether one product is worth it. For a general explainer use Blog Post; for a single service you sell use Service Page; for a product in your shop use WooCommerce Product.

## The form, field by field

- **Title** — the article title; used if Products / Services is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 1,500 words by default); it does not change the credit cost.
- **Review Type** — the format, e.g. a head-to-head comparison or a best-of roundup.
- **Products / Services** — what's being compared. *Example:* `Mailchimp vs ConvertKit, or Top 5 CRMs`.
- **Overall Verdict (optional)** — your conclusion, if you already have one. *Example:* `ConvertKit wins for creators`. Leave it blank to let the analysis decide.

## Credits and access

On the Pro plan and above, 3 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A balanced comparison in clean Markdown: an opening on why the comparison matters, a summary comparison table near the top, a section for each option (overview, strengths, weaknesses, who it's best for), a head-to-head by key criteria, an "Our Verdict" recommendation, an FAQ on common buying questions, and an affiliate-disclosure placeholder. The tone acknowledges flaws, because readers trust reviewers who do. It publishes as a draft post, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and the editable SERP outline-review step runs first, which is particularly valuable for competitive comparison keywords. If the search service is unavailable, generation proceeds ungrounded.

## Worked example

**Inputs**

- Products / Services: `Mailchimp vs ConvertKit`
- Review Type: `Head-to-head comparison`
- Overall Verdict: *(left blank)*
- Target word count: `1500`

**Example output (abridged)**

> | | Mailchimp | ConvertKit |
> |---|---|---|
> | Best for | All-rounder | Creators |
> | *(…)* | | |
>
> ## Mailchimp
> *(overview, strengths, weaknesses, best for)*
>
> ## Our verdict
> *(…a clear, reasoned recommendation, then an FAQ.)*

## Tips and common pitfalls

- Name the exact products in Products / Services — vague input produces a vague comparison.
- Leave the verdict blank if you want the article to reason to a conclusion; fill it in to steer the recommendation.
- Keep the affiliate disclosure if you use affiliate links — it's a placeholder for you to complete.

## Related

Blog Post / Article, Service Page, WooCommerce Product · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Email Newsletter
URL: https://docs.aicontentbridge.com/content-types/email-newsletter
META: slug=email-newsletter | group=Content Marketing | tier=pro | credits=1 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Email Newsletter

> A ready-to-send newsletter — subject line, preview text, an engaging body and a single clear call to action.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Pro |
| **Credit cost** | 1 credit |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post, or a draft campaign in MailPoet / Newsletter (TNP) |

## What it's for

The Email Newsletter type writes a complete email: a subject line, preview text, a conversational body broken up with subheadings, and one clear call to action. It's for regular subscriber emails and announcements, and it can drop straight into your email plugin as a draft.

## When to use it — and when not to

Use it for an email to your list. For a public web article use Blog Post; for short channel posts use Social Media Post; for a spoken script use Video Script.

## The form, field by field

- **Title** — used as the topic if Main Topic is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Audience** — who's receiving it; sets the tone. *Example:* `Existing customers, newsletter subscribers`.
- **Main Topic / Angle** — what the email is about. *Example:* `Announcing our summer sale, sharing industry news…`.
- **Call to Action** — the single action you want readers to take. *Example:* `Shop now, Read more, Book a call`.

## Credits and access

On the Pro plan and above, a flat 1 credit — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A complete email: a subject line (kept short for inbox display), preview text, then the body — a personal hook, the main content, one or two subheadings, short email-friendly paragraphs, a single call-to-action placeholder, and a warm sign-off. It publishes as a draft post, or — when MailPoet or the Newsletter (TNP) plugin is detected — as a draft campaign in that tool, ready for you to review and send. See Integrations → Email.

## SEO behaviour

The SEO score is calculated and shown on every generation (it grades the meta and content the same way). The SERP outline-review step does not apply to newsletters; they generate straight through.

## Worked example

**Inputs**

- Audience: `Existing customers`
- Main Topic / Angle: `Announcing our summer sale`
- Call to Action: `Shop the sale`

**Example output (abridged)**

> SUBJECT LINE: Your early access to the summer sale
> PREVIEW TEXT: 48 hours before everyone else — come on in
> --- EMAIL BODY ---
> Hi there — a quick one, because you're a regular…
> *(…short paragraphs, a subheading, then a single [CTA: Shop the sale] and a warm sign-off.)*

## Tips and common pitfalls

- A specific Audience produces a more natural tone than "everyone".
- Give one Call to Action; a single clear action outperforms several competing ones.
- If you're publishing into MailPoet or TNP, make sure the plugin is active first — see Integrations → Email.

## Related

Social Media Post, Blog Post / Article · Integrations → Email · Content types overview

========================================================================
PAGE: Video Script
URL: https://docs.aicontentbridge.com/content-types/video-script
META: slug=video-script | group=Content Marketing | tier=pro | credits=2 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Video Script

> A production-ready script — hook, timestamped sections, b-roll and on-screen-text notes, and an end-screen call to action.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Pro |
| **Credit cost** | 2 credits |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Video Script type writes a spoken-word script paced for a platform and length: an attention-grabbing hook, a timestamped structure, b-roll and on-screen-text suggestions, and an outro with a subscribe/follow call to action. It's written in natural spoken English, ready to record.

## When to use it — and when not to

Use it when you need something to *say* on camera. For a written article use Blog Post or Tutorial; for short channel captions use Social Media Post.

## The form, field by field

- **Title** — the video topic.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — has limited effect; the target duration drives pacing.
- **Platform** — where it's going (e.g. YouTube); the structure and length adapt to it.
- **Target Duration** — how long the video should run; sections are timed to fit.
- **Style** — the tone and energy (e.g. educational, entertaining); the script matches it.

## Credits and access

On the Pro plan and above, a flat 2 credits — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A shoot-ready script in clean Markdown: a `[HOOK]` opening, an `[INTRO]` setting up the video, the main content in clearly labelled timestamped sections, `[B-ROLL SUGGESTION: …]` and `[ON SCREEN TEXT: …]` notes for visual variety, and an `[OUTRO]` with a recap, a subscribe/follow call to action and a next-video suggestion. It's written in natural spoken English — contractions, short sentences — and paced for your chosen platform and duration. It publishes as a draft post.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply to scripts; they generate straight through.

## Worked example

**Inputs**

- Title: `Three quick WordPress speed fixes`
- Platform: `YouTube`
- Target Duration: `5 minutes`
- Style: `Educational`

**Example output (abridged)**

> [HOOK - 0:00-0:15] Your site takes four seconds to load. Here's how to halve that before lunch.
> [INTRO - 0:15-0:30] In this video, three fixes anyone can do…
> [B-ROLL SUGGESTION: screen recording of a speed test]
> *(…timestamped sections, on-screen-text notes, then an outro with a subscribe CTA.)*

## Tips and common pitfalls

- Set the Target Duration accurately — the whole script is paced to fit it.
- Match the Style to the channel; an educational script reads very differently from an entertaining one.
- The b-roll and on-screen-text notes are suggestions for your edit, not spoken lines.

## Related

Social Media Post, Blog Post / Article, Tutorial / How-To · Content types overview

========================================================================
PAGE: Social Media Post
URL: https://docs.aicontentbridge.com/content-types/social-media
META: slug=social-media | group=Content Marketing | tier=pro | credits=1 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Social Media Post

> Platform-optimised posts — the right tone, length and hashtags for each network, with as many variations as you need.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Pro |
| **Credit cost** | 1 credit |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Social Media Post type writes ready-to-post copy tailored to each platform you choose — matching the tone, length and hashtag conventions of LinkedIn, Facebook, Instagram, X (Twitter) or TikTok — and can produce several variations per platform so you've options to pick from.

## When to use it — and when not to

Use it for short social copy. For a longer email use Email Newsletter; for an on-camera script use Video Script; for a web article use Blog Post.

## The form, field by field

- **Title** — the topic of the post.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — has little effect; each platform has its own length conventions.
- **Platforms** — choose one or more of LinkedIn, Facebook, Instagram, X (Twitter) and TikTok. Each gets copy written to its own conventions.
- **Variations per Platform** — how many alternative versions to write for each platform.
- **Post Goal** — what the post is for (e.g. brand awareness, engagement, clicks); shapes the angle and call to action.

## Credits and access

On the Pro plan and above, a flat 1 credit regardless of how many platforms or variations you select — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

Per platform, the number of variations you asked for, each clearly labelled (for example "## LinkedIn — Variation 1"). Each is written to that platform's conventions: LinkedIn gets a professional, longer-form post with a few hashtags; Facebook a short conversational hook; Instagram a visual-first caption with more hashtags; X a punchy sub-280-character post; TikTok a fast, casual hook. It publishes as a draft post you can copy from.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply to social posts; they generate straight through.

## Worked example

**Inputs**

- Title: `We just hit 10,000 customers`
- Platforms: `LinkedIn, X (Twitter)`
- Variations per Platform: `2`
- Post Goal: `Brand awareness`

**Example output (abridged)**

> ## LinkedIn — Variation 1
> Ten thousand businesses now trust us with their content. Here's what we learned getting here… *(3–5 hashtags)*
>
> ## X (Twitter) — Variation 1
> 10,000 customers. Thank you. Here's the one thing that got us here 👇 *(1–2 hashtags)*
> *(…second variations for each platform.)*

## Tips and common pitfalls

- Pick only the platforms you'll actually post to — each adds tailored copy, and the cost stays at one credit either way.
- Use Variations to give yourself choices, then pick the strongest.
- Set the Post Goal deliberately; an awareness post and a clicks post read very differently.

## Related

Email Newsletter, Video Script · Content types overview

========================================================================
PAGE: Event Description
URL: https://docs.aicontentbridge.com/content-types/event-description
META: slug=event-description | group=Content Marketing | tier=pro | credits=1 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# Event Description

> A compelling event page — hook, highlights, who should attend, full details and a clear registration call to action.

## At a glance

| | |
|---|---|
| **Group** | Content Marketing |
| **Available on** | Pro |
| **Credit cost** | 1 credit (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post, or an event in The Events Calendar |

## What it's for

The Event Description type writes a persuasive event page: an attention-grabbing hook, an overview, the highlights, who should attend, the practical details (date, venue, format, cost) and an urgent call to action to register. When The Events Calendar is installed, it can publish as a proper calendar event with its dates, venue, cost and URL.

## When to use it — and when not to

Use it to promote an event. For a recurring internal procedure use Standard Operating Procedure; for a service you offer use Service Page; for a general announcement use Press Release.

## The form, field by field

- **Title** — the event name.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Event Date & Time** — when it runs. *Example:* `Saturday 14th June 2026, 10am–4pm BST`.
- **Venue / Location** — where it's held. *Example:* `The Barbican, London EC2Y 8DS`.
- **Event Type** — the kind of event; also informs the format described.
- **Ticket Price** — cost or price range. *Example:* `Free, £49, £99–£299`.
- **Event / Tickets URL** — the registration link, referenced in the call to action. *Example:* `https://eventbrite.com/…`.
- **Organiser** — who's running it. *Example:* `London WordPress Meetup`.
- **Agenda / Highlights** — the key sessions or draws. *Example:* `Keynote speakers, panel sessions, networking lunch…`.
- **Target Audience** — who it's for. *Example:* `WordPress developers, small business owners`.

## Credits and access

On the Pro plan and above, 1 credit plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A persuasive event page in clean Markdown: a hook on why the event matters now, a short overview, a "What You'll Experience" highlights list, a "Who Should Attend" section, an "Event Details" block (date, time, location, format, cost), an "About the Organiser" section when you've supplied organiser details, and an urgent closing call to action that references your tickets URL. When The Events Calendar is detected, it publishes as a calendar event with its date, venue, cost and URL set; otherwise it publishes as a standard post. See Integrations → Events.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply to event descriptions; they generate straight through.

## Worked example

**Inputs**

- Title: `London WordPress Meetup — Summer Special`
- Event Date & Time: `Saturday 14th June 2026, 10am–4pm BST`
- Venue / Location: `The Barbican, London`
- Ticket Price: `Free`
- Organiser: `London WordPress Meetup`

**Example output (abridged)**

> The biggest London WordPress Meetup of the year is back — and it's free.
>
> ## What you'll experience
> - Keynote on the future of block themes
> - *(…)*
>
> ## Event details
> Saturday 14th June 2026, 10am–4pm BST · The Barbican, London · Free
> *(…About the Organiser, then an urgent register-now CTA.)*

## Tips and common pitfalls

- Fill in the date, venue and URL fields — they populate the calendar event when The Events Calendar is active.
- A specific Agenda produces stronger highlights than a vague one.
- Make sure The Events Calendar is active before generating if you want a calendar entry rather than a plain post — see Integrations → Events.

## Related

Service Page, Press Release · Integrations → Events · Content types overview

========================================================================
PAGE: WooCommerce Product
URL: https://docs.aicontentbridge.com/content-types/woocommerce-product
META: slug=woocommerce-product | group=Sales & Commerce | tier=starter | credits=1 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# WooCommerce Product

> A persuasive product description — benefit-led copy, a key-features list and specs — that can publish straight into a WooCommerce product.

## At a glance

| | |
|---|---|
| **Group** | Sales & Commerce |
| **Available on** | Starter |
| **Credit cost** | 1 credit (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WooCommerce product, or a standard post |

## What it's for

The WooCommerce Product type writes selling copy for a product: a benefit-led description, a key-features list and a specifications section, pitched at your target customer. When WooCommerce is active it publishes as a product with the price and SKU populated, rather than a plain post.

## When to use it — and when not to

Use it for shop products. For a service you deliver use Service Page; for a vehicle use Vehicle Listing; for a comparison of several products use Review / Comparison Article.

## The form, field by field

- **Title** — the product title; used if Product Name is left blank.
- **Primary keyword** — used for the SEO meta and woven in two or three times.
- **Target word count** — guides length (around 500 words by default); it does not change the credit cost.
- **Product Name** — the product. *Example:* `Leather Laptop Bag`.
- **Key Features / Specs** — the features and specifications to work from. *Example:* `Full grain leather, fits 15" laptop, 3 compartments…`.
- **Price (optional)** — the price; populates the WooCommerce price field. *Example:* `£49.99`.
- **Target Customer** — who it's for; the copy speaks to their needs. *Example:* `Professionals aged 25-45`.

## Credits and access

On the Starter plan and above, 1 credit plus 1 for an optional image — one of the cheapest types. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A persuasive description in clean Markdown: a one-line benefit hook, two to three benefit-led paragraphs, a Key Features bullet list, a Specifications section where relevant, a direct nod to the customer's main need, and a confident, non-pushy close. The keyword appears naturally a couple of times. When WooCommerce is detected it publishes as a product (price and SKU set); otherwise as a standard post. See Integrations → WooCommerce.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply to product descriptions; they generate straight through.

## Worked example

**Inputs**

- Product Name: `Leather Laptop Bag`
- Key Features / Specs: `Full-grain leather, fits 15" laptop, three compartments, lifetime guarantee`
- Price: `£149`
- Target Customer: `Professionals aged 25–45`

**Example output (abridged)**

> Carry your work in something built to outlast it.
>
> *(…two to three benefit-led paragraphs…)*
>
> **Key features**
> - Full-grain leather that ages beautifully
> - Padded sleeve fits laptops up to 15"
> *(…then a short Specifications section and a confident close.)*

## Tips and common pitfalls

- Put real specs in Key Features — the copy is only as concrete as what you give it.
- Set the Price field if you want it carried into the WooCommerce product.
- Make sure WooCommerce is active before generating if you want a product rather than a post — see Integrations → WooCommerce.

## Related

Service Page, Vehicle Listing, Review / Comparison Article · Integrations → WooCommerce · Content types overview

========================================================================
PAGE: Service Page
URL: https://docs.aicontentbridge.com/content-types/service-page
META: slug=service-page | group=Sales & Commerce | tier=starter | credits=2 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Service Page

> A conversion-focused page for a service you offer — what it is, who it's for, how it works, and a clear call to action.

## At a glance

| | |
|---|---|
| **Group** | Sales & Commerce |
| **Available on** | Starter |
| **Credit cost** | 2 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress page or post (draft) |

## What it's for

The Service Page type writes a complete page for a service you sell: a hero statement, what the service is and who it's for, each key benefit, a "how it works" process, a trust-building section, and a strong call to action. It's optimised to rank as well as to convert.

## When to use it — and when not to

Use it for a service you deliver. For a physical product use WooCommerce Product; for a time-limited campaign offer use Landing Page; for a comparison use Review / Comparison Article.

## The form, field by field

- **Title** — the page title; used if Service Name is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 1,000 words by default); it does not change the credit cost.
- **Service Name** — the service. *Example:* `Social Media Management`.
- **Target Audience** — who it's for. *Example:* `Small businesses in the UK`.
- **Key Benefits** — the main benefits to lead with. *Example:* `Saves time, increases engagement, grows followers…`.

## Credits and access

On the Starter plan and above, 2 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A conversion-focused page in clean Markdown: a hero statement, an explanation of what the service is and who it's for, an H2 section per major benefit, a "How It Works" process of three to five steps, a "Who Is This For?" section, a "Why Choose Us?" trust section, and a strong closing call to action (book a call, get a quote, contact us). It publishes as a draft page or post, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and because a service page is keyword-led web content, the editable SERP outline-review step runs first with a content-gap callout. If the search service is unavailable, generation proceeds ungrounded.

## Worked example

**Inputs**

- Service Name: `Social media management`
- Target Audience: `Small businesses in the UK`
- Key Benefits: `Saves time, grows engagement, consistent posting`

**Example output (abridged)**

> Social media that runs itself — so you can run your business.
>
> ## More engagement, less effort
> *(…an H2 per benefit…)*
>
> ## How it works
> 1. We learn your brand and audience.
> *(…three to five steps, then Who Is This For, Why Choose Us, and a CTA.)*

## Tips and common pitfalls

- Lead with the benefits your customers actually care about — they drive the benefit sections.
- A specific Target Audience produces sharper "who it's for" copy.
- Use the outline-review step to cover the angles competitor service pages miss.

## Related

WooCommerce Product, Landing Page, About Us / Company Page · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Vehicle Listing
URL: https://docs.aicontentbridge.com/content-types/vehicle-listing
META: slug=vehicle-listing | group=Sales & Commerce | tier=pro | credits=1 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Vehicle Listing

> A compelling vehicle description — specs, an honest condition note and clear selling points.

## At a glance

| | |
|---|---|
| **Group** | Sales & Commerce |
| **Available on** | Pro |
| **Credit cost** | 1 credit |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Vehicle Listing type writes a listing that sells a vehicle honestly: a headline, a punchy overview, a details/specs block, key features, a candid condition-and-history section, strong reasons to buy, and a clear call to action to view. It's built for dealers and private sellers.

## When to use it — and when not to

Use it for a vehicle for sale. For a general product use WooCommerce Product; for a service use Service Page.

## The form, field by field

- **Title** — the listing title; the vehicle is also assembled from the fields below.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Make** — *Example:* `Ford`.
- **Model** — *Example:* `Transit Custom`.
- **Year** — *Example:* `2022`.
- **Mileage** — *Example:* `24,000 miles`.
- **Condition** — the overall condition; the description is honest to it.
- **Key Features** — the highlights to list. *Example:* `Full service history, one owner, air con, cruise control…`.
- **Asking Price** — *Example:* `£18,995`.

## Credits and access

On the Pro plan and above, a flat 1 credit — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A listing in clean Markdown: a compelling headline, a two-to-three-sentence overview, a Vehicle Details specs block, a Key Features & Highlights list, an honest Condition & History section, a "Why Buy This Vehicle?" section with three strong points, and a clear call to action to call, message or visit. The tone is enthusiastic but honest — it won't exaggerate condition or hide known issues. It publishes as a draft post or page.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; vehicle listings generate straight through.

## Worked example

**Inputs**

- Make / Model / Year: `Ford Transit Custom, 2022`
- Mileage: `24,000 miles`
- Condition: `Excellent`
- Key Features: `Full service history, one owner, air con, cruise control`
- Asking Price: `£18,995`

**Example output (abridged)**

> 2022 Ford Transit Custom — one owner, full history, ready to work.
>
> ## Vehicle details
> - Year: 2022 · Mileage: 24,000 · Price: £18,995
>
> ## Condition & history
> *(…an honest, specific note, then "Why buy this vehicle?" and a CTA.)*

## Tips and common pitfalls

- Fill in every spec field — the details block and headline are assembled from them.
- Be accurate about Condition; the copy is written to match it and won't oversell.
- List concrete Key Features rather than generic claims.

## Related

WooCommerce Product, Service Page · Content types overview

========================================================================
PAGE: Landing Page
URL: https://docs.aicontentbridge.com/content-types/landing-page
META: slug=landing-page | group=Sales & Commerce | tier=pro | credits=3 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Landing Page

> Conversion copy for a single offer — hero, benefits, social-proof placeholders, objection handling and strong calls to action.

## At a glance

| | |
|---|---|
| **Group** | Sales & Commerce |
| **Available on** | Pro |
| **Credit cost** | 3 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress page or post (draft) |

## What it's for

The Landing Page type writes focused conversion copy for one offer: a strong headline and hero, benefit sections, a simple "how it works", an ideal-customer picture, direct answers to common objections, social-proof placeholders, and calls to action above and below the fold. Every line is written to earn its place.

## When to use it — and when not to

Use it for a campaign or a specific offer with a single goal. For an ongoing service use Service Page; for a shop product use WooCommerce Product.

## The form, field by field

- **Title** — the page title; used if The Offer is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 1,000 words by default); it does not change the credit cost.
- **The Offer** — what you're offering. *Example:* `Free 14-day trial of our project management tool`.
- **Target Audience** — who it's for. *Example:* `Freelancers and small agency owners`.
- **Main Benefit** — the single biggest benefit. *Example:* `Save 5 hours a week on admin`.
- **Common Objections** — the hesitations to address. *Example:* `Too expensive, too complicated, already use spreadsheets`.

## Credits and access

On the Pro plan and above, 3 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A conversion page in clean Markdown: a powerful headline and subheading stating the core benefit, a hero paragraph, a Key Benefits section of three to five benefits (each a bold headline plus a sentence or two), a three-step "How It Works", a "Who Is This For?" picture of the ideal customer, a "Common Questions" section answering your listed objections directly, social-proof placeholders for testimonials, and strong, specific calls to action above and below the fold. It publishes as a draft page or post, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and because a landing page is keyword-led web content, the editable SERP outline-review step runs first. If the search service is unavailable, generation proceeds ungrounded.

## Worked example

**Inputs**

- The Offer: `Free 14-day trial of our project management tool`
- Target Audience: `Freelancers and small agency owners`
- Main Benefit: `Save 5 hours a week on admin`
- Common Objections: `Too expensive, too complicated`

**Example output (abridged)**

> Get five hours back every week. Start free.
>
> ## Built for the way you actually work
> *(…three to five benefit blocks…)*
>
> ## Common questions
> **Is it complicated to set up?** *(…objection answered directly…)*
> *(…social-proof placeholders, then a strong CTA.)*

## Tips and common pitfalls

- List the real objections — the "Common Questions" section is built to answer exactly these.
- One offer, one goal: landing pages convert best when they don't try to do two jobs.
- Replace the testimonial placeholders with genuine social proof before publishing.

## Related

Service Page, WooCommerce Product · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: About Us / Company Page
URL: https://docs.aicontentbridge.com/content-types/about-us
META: slug=about-us | group=Business | tier=starter | credits=1 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# About Us / Company Page

> An origin story, mission and values — a warm, human page that builds trust.

## At a glance

| | |
|---|---|
| **Group** | Business |
| **Available on** | Starter |
| **Credit cost** | 1 credit (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress page or post (draft) |

## What it's for

The About Us type writes a company page that builds trust: an engaging hook, the origin story, the mission and values woven through the narrative, what makes the company different, and an invitation to connect. It's warm and human rather than corporate boilerplate.

## When to use it — and when not to

Use it for a company or about page. For a service you sell use Service Page; for a recruitment page use Job Listing; for a formal announcement use Press Release.

## The form, field by field

- **Title** — the page title; used if Company Name is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 800 words by default); it does not change the credit cost.
- **Company Name** — *Example:* `Acme Digital Ltd`.
- **Founded** — when and where. *Example:* `2018, London`.
- **Mission / Values** — what the company stands for. *Example:* `We believe every small business deserves…`.

## Credits and access

On the Starter plan and above, 1 credit plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A trust-building page in clean Markdown: an engaging hook (deliberately not "We are a company that…"), the origin story of why the company was founded and what problem it solves, the mission, vision and values told as narrative, a "Meet the Team" placeholder, what makes the company different, and a closing invitation to visit, contact or follow. It's written warmly and in the third person unless you say otherwise. It publishes as a draft page or post, with SEO meta and an optional image.

## SEO behaviour

Both apply: the SEO score is calculated on every generation, and the editable SERP outline-review step runs first because an about page is treated as keyword-led web content. If the search service is unavailable, generation proceeds ungrounded.

## Worked example

**Inputs**

- Company Name: `Acme Digital Ltd`
- Founded: `2018, London`
- Mission / Values: `Make great design affordable for small businesses`

**Example output (abridged)**

> It started with a frustration: good design always seemed to be priced for big budgets.
>
> *(…the origin story, mission and values as narrative…)*
>
> ## Meet the team
> *(placeholder)*
> *(…what makes us different, then an invitation to get in touch.)*

## Tips and common pitfalls

- A real Mission / Values input produces a far more authentic page than a generic one.
- The "Meet the Team" section is a placeholder for you to complete with real people.
- Keep the founding details accurate; they anchor the story.

## Related

Service Page, Job Listing, Press Release · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Press Release
URL: https://docs.aicontentbridge.com/content-types/press-release
META: slug=press-release | group=Business | tier=pro | credits=1 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Press Release

> A formal press release — release line, dateline, a five-Ws lead, a quote and a company boilerplate.

## At a glance

| | |
|---|---|
| **Group** | Business |
| **Available on** | Pro |
| **Credit cost** | 1 credit |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post (draft) |

## What it's for

The Press Release type writes an announcement in proper release format: the "for immediate release" line, a dateline, a lead paragraph that answers the five Ws, supporting detail, a quote, an "About" boilerplate and a media-contact placeholder. It's for launches, partnerships, awards and other newsworthy announcements.

## When to use it — and when not to

Use it for formal, newsworthy announcements. For a warmer company story use About Us; for an event use Event Description; for a subscriber email use Email Newsletter.

## The form, field by field

- **Title** — the headline.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **The Announcement** — what you're announcing. *Example:* `Launch of new product, partnership, award win…`.
- **Quote Attribution** — who the quote is from. *Example:* `Jane Smith, CEO of Acme Ltd`.
- **Location / Dateline** — the dateline city. *Example:* `London, UK`.

## Credits and access

On the Pro plan and above, a flat 1 credit — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A press release in clean Markdown: a "FOR IMMEDIATE RELEASE" line, a dateline, the headline, a lead paragraph answering who/what/when/where/why, a second paragraph with key detail, a quote attributed to the person you named, an "About [Company]" boilerplate, the standard end marker, and a media-enquiries contact placeholder. The tone is formal, factual and newsworthy. It publishes as a draft post.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; press releases generate straight through.

## Worked example

**Inputs**

- Title: `Acme Ltd launches AI-powered analytics suite`
- The Announcement: `Launch of new product`
- Quote Attribution: `Jane Smith, CEO of Acme Ltd`
- Location / Dateline: `London, UK`

**Example output (abridged)**

> FOR IMMEDIATE RELEASE
> London, UK — [Date]
>
> **Acme Ltd launches AI-powered analytics suite**
> Acme Ltd today announced the launch of… *(who, what, when, where, why)*
>
> "This changes how our customers see their data," said Jane Smith, CEO of Acme Ltd.
> *(…About Acme boilerplate, end marker, media contact placeholder.)*

## Tips and common pitfalls

- Give a clear Announcement — the lead paragraph is built around it.
- Name a real Quote Attribution; the quote is written in that person's voice.
- Complete the media-contact placeholder before distributing.

## Related

About Us / Company Page, Event Description, Email Newsletter · Content types overview

========================================================================
PAGE: Job Listing
URL: https://docs.aicontentbridge.com/content-types/job-listing
META: slug=job-listing | group=Business | tier=pro | credits=1 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Job Listing

> A welcoming job advert — role overview, responsibilities, requirements, what you offer and an apply call to action.

## At a glance

| | |
|---|---|
| **Group** | Business |
| **Available on** | Pro |
| **Credit cost** | 1 credit |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Job Listing type writes a job advert that attracts rather than intimidates: a warm overview, what the role actually involves day to day, the responsibilities, what you're looking for, what you offer, a short "about us", and clear application instructions.

## When to use it — and when not to

Use it to advertise a role. For a company story use About Us; for an internal onboarding guide use Onboarding Document.

## The form, field by field

- **Title** — the listing title; used if Job Title is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Job Title** — *Example:* `Senior React Developer`.
- **Location** — *Example:* `Remote, London, Hybrid`.
- **Salary Range** — *Example:* `£45,000 - £55,000`.
- **Key Responsibilities** — what they'll do. *Example:* `Build React components, lead code reviews…`.
- **Requirements** — must-haves and nice-to-haves. *Example:* `3+ years React, TypeScript, strong communication…`.

## Credits and access

On the Pro plan and above, a flat 1 credit — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A job advert in clean Markdown: an engaging two-to-three-sentence overview of the role and culture, an "About the Role" section on day-to-day work, a "Key Responsibilities" list of six to eight points, a "What We're Looking For" list of must-haves and nice-to-haves, a "What We Offer" section (salary, benefits, culture, perks), a short "About Us", and an application-instructions placeholder. The tone is welcoming and human. It publishes as a draft post or page.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; job listings generate straight through.

## Worked example

**Inputs**

- Job Title: `Senior React Developer`
- Location: `Remote (UK)`
- Salary Range: `£55,000 – £70,000`
- Key Responsibilities: `Build and maintain React components, lead code reviews, mentor juniors`
- Requirements: `4+ years React, TypeScript, strong communication`

**Example output (abridged)**

> We're looking for a Senior React Developer to help shape the products thousands of people use every day…
>
> ## Key responsibilities
> - Build and maintain our React component library
> *(…six to eight points…)*
>
> ## What we offer
> *(…salary, benefits, culture, then an apply CTA placeholder.)*

## Tips and common pitfalls

- Separate must-haves from nice-to-haves in Requirements; over-long must-have lists deter good applicants.
- Include the Salary Range if you can — listings with salaries attract more applicants.
- Complete the application instructions before publishing.

## Related

About Us / Company Page, Onboarding Document · Content types overview

========================================================================
PAGE: Policy & Procedure
URL: https://docs.aicontentbridge.com/content-types/policy-procedure
META: slug=policy-procedure | group=Business | tier=pro | credits=2 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Policy & Procedure

> A formal corporate policy — purpose, scope, the policy statement, responsibilities, the procedure and a review date.

## At a glance

| | |
|---|---|
| **Group** | Business |
| **Available on** | Pro |
| **Credit cost** | 2 credits |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Policy & Procedure type writes a formal policy document in a consistent structure: purpose, scope, the organisation's policy statement, responsibilities, the procedure to follow, compliance and consequences, and a review date. It's for HR and operations teams who need policies written to a standard.

## When to use it — and when not to

Use it for a formal policy. For a step-by-step operational process use Standard Operating Procedure (L&D); for new-starter guidance use Onboarding Document.

## The form, field by field

- **Title** — the policy title; used if Policy Type is left blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Policy Type** — the policy being written. *Example:* `Remote Working Policy, Expense Policy`.
- **Audience** — who it applies to. *Example:* `All employees, Management, HR`.
- **Key Points to Cover** — the specifics it must address. *Example:* `Eligibility, approval process, equipment…`.

## Credits and access

On the Pro plan and above, a flat 2 credits — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A formal policy in clean Markdown with a fixed structure: 1. Purpose, 2. Scope, 3. Policy Statement, 4. Responsibilities (a table when several roles are involved), 5. Procedure (numbered steps), 6. Compliance & Consequences, and 7. Review Date, plus a version placeholder ("Version 1.0 | [Date] | Approved by: [Name]"). The tone is formal and unambiguous. It publishes as a draft post or page.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; policies generate straight through.

## Worked example

**Inputs**

- Policy Type: `Remote Working Policy`
- Audience: `All employees`
- Key Points to Cover: `Eligibility, approval process, equipment, expectations`

**Example output (abridged)**

> ## 1. Purpose
> This policy sets out the organisation's approach to remote working and the conditions under which it is permitted…
>
> ## 4. Responsibilities
>
> | Role | Responsibility |
> |---|---|
> | Employee | Maintains a safe, productive home setup |
> | Manager | Approves and reviews arrangements |
> *(…Procedure, Compliance, Review Date and a version line.)*

## Tips and common pitfalls

- List the Key Points you must cover — the policy is built around them.
- The version and review-date lines are deliberate placeholders for proper document control.
- For an operational "how to do this task" document rather than a policy, use Standard Operating Procedure.

## Related

Standard Operating Procedure, Onboarding Document · Content types overview

========================================================================
PAGE: Onboarding Document
URL: https://docs.aicontentbridge.com/content-types/onboarding-doc
META: slug=onboarding-doc | group=Business | tier=pro | credits=2 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# Onboarding Document

> A warm welcome pack for a new starter — first week, key contacts, tools, culture and 30/60/90-day goals.

## At a glance

| | |
|---|---|
| **Group** | Business |
| **Available on** | Pro |
| **Credit cost** | 2 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Onboarding Document type writes a reassuring welcome pack for a new starter: a genuine welcome, what to expect in the first week, key contacts, the tools they'll use, the company culture, the policies to know, and 30/60/90-day goals. It's for HR and managers who want consistent, human onboarding.

## When to use it — and when not to

Use it to welcome and orient a new starter. For a formal policy use Policy & Procedure; for a repeatable operational process use Standard Operating Procedure; to advertise the role in the first place use Job Listing.

## The form, field by field

- **Title** — the document title; used if details below are blank.
- **Primary keyword** — used for the SEO meta and focus keyword.
- **Target word count** — guides length (around 800 words by default); it does not change the credit cost.
- **Role / Department** — who the document is for. *Example:* `Marketing Executive, Sales Team`.
- **Company Name** — *Example:* `Acme Ltd`.
- **Key Information** — the specifics to include. *Example:* `Tools used, key contacts, first week schedule…`.

## Credits and access

On the Pro plan and above, 2 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A welcome pack in clean Markdown: a warm welcome, a "Your First Week" day-by-day overview, a "Key Contacts" placeholder table (Name / Role / Email / Best way to reach), a "Tools & Systems" list, a "Company Culture" section of values and ways of working, a "Key Policies to Know" list with link placeholders, a "Your 30/60/90 Day Goals" outline, and an encouraging, open-door close. The tone is warm and reassuring. It publishes as a draft post or page, with SEO meta and an optional image.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; onboarding documents generate straight through.

## Worked example

**Inputs**

- Role / Department: `Marketing Executive`
- Company Name: `Acme Ltd`
- Key Information: `Tools: Slack, HubSpot, Figma. First-week buddy assigned. Standup at 9:30.`

**Example output (abridged)**

> Welcome to Acme — we're really glad you're here.
>
> ## Your first week
> **Day 1:** Meet your buddy, set up your accounts, join the 9:30 standup…
>
> ## Key contacts
> *(placeholder table)*
> *(…Tools & Systems, Company Culture, 30/60/90-day goals, then an open-door close.)*

## Tips and common pitfalls

- Put the real tools, contacts and schedule in Key Information — they populate the relevant sections.
- The contacts table is a placeholder; fill in the real names before sharing.
- Keep it genuinely warm; the first days set the tone for the whole role.

## Related

Policy & Procedure, Standard Operating Procedure, Job Listing · Content types overview

========================================================================
PAGE: Course Overview / Syllabus
URL: https://docs.aicontentbridge.com/content-types/course-overview
META: slug=course-overview | group=Learning & Development | tier=agency | credits=3 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# Course Overview / Syllabus

> Course objectives, module breakdown, outcomes and who it's for — a complete syllabus from a short brief.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 3 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Course Overview type produces a full syllabus — a summary, learning outcomes, the ideal learner, prerequisites, a module-by-module structure, time commitment and what's included. It's for course designers, trainers and agencies who need a clear, motivating overview to plan a course or to present it to prospective learners.

## When to use it — and when not to

Use it to scope or market a course before you write the lessons themselves. If you want the actual teaching content for one lesson, use Training Module; if you need the questions to test learners, use Quiz / Assessment; if you're running a live session, use Workshop Facilitation Guide.

## The form, field by field

- **Title** — the course name as it should appear; used if the Course Name field is left blank.
- **Primary keyword** — drives the SEO meta and focus keyword; usually the course subject.
- **Target word count** — guides length only; it does not change the credit cost.
- **Course Name** — the course being outlined. *Example:* `Introduction to Digital Marketing`.
- **Target Audience** — who the course is for. *Example:* `Marketing assistants, career changers`.
- **Duration** — how long the course runs. *Example:* `6 weeks, 3 hours per week`.
- **Number of Modules** — how many modules to break the course into; the structure section produces a titled module for each.

## Credits and access

The Course Overview type is on the Agency plan and costs 3 credits, plus 1 if you add a featured image. Credits are refunded automatically if a generation fails. See Core concepts → Credits for the full model.

## What you get

A complete syllabus in clean Markdown: a Course Overview summary, a What You'll Learn list of five to eight outcomes, Who This Course Is For, Prerequisites, a Course Structure listing each module with a one-line description, Time Commitment, What's Included (videos, quizzes, assignments, certificate as applicable) and a placeholder Meet Your Instructor bio. It publishes as a standard post or page, with SEO meta written to a detected SEO plugin and an optional featured image.

## SEO behaviour

The deterministic SEO score is calculated and shown on the Content Diary entry, as on every type. The live SERP outline-review step does not apply to course overviews — it's reserved for keyword-led web content — so generation runs straight through.

## Worked example

**Inputs**

- Course Name: `Introduction to Digital Marketing`
- Target Audience: `Marketing assistants and career changers`
- Duration: `6 weeks, 3 hours per week`
- Number of Modules: `6`

**Example output (abridged)**

> ## Course Overview
> A practical, six-week introduction to digital marketing for people moving into their first marketing role…
>
> ## What You'll Learn
> - Plan a basic multi-channel campaign
> - Write copy that converts
> - *(…three to six more outcomes)*
>
> ## Course Structure
> 1. **Foundations of Digital Marketing** — the channels and how they fit together.
> 2. **Content & Copywriting** — writing for the web and for search.
> *(…modules 3–6 continue.)*

## Tips and common pitfalls

- Set Number of Modules to match the course you actually intend to build — the structure section produces exactly that many titled modules.
- A specific Target Audience produces a sharper "Who this is for" section than a generic one.
- The instructor bio is a deliberate placeholder for you to complete.

## Related

Training Module, Quiz / Assessment, Workshop Facilitation Guide · Integrations → LMS · Content types overview

========================================================================
PAGE: Training Module / Lesson
URL: https://docs.aicontentbridge.com/content-types/training-module
META: slug=training-module | group=Learning & Development | tier=agency | credits=3 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# Training Module / Lesson

> A full lesson — introduction, content sections, summary and knowledge-check questions — ready to publish or import into an LMS.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 3 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post, or an LMS lesson (LearnPress / LifterLMS) |

## What it's for

The Training Module type writes a complete, self-contained lesson: an introduction that sets context, clear learning objectives, three to five teaching sections with examples and practical application, key takeaways, and a set of knowledge-check questions. It's the workhorse for building course content at scale.

## When to use it — and when not to

Use it for the actual teaching content of a lesson. For the course's high-level plan use Course Overview; for a standalone test use Quiz / Assessment; to explain a single concept in depth rather than teach a structured lesson, use Explainer / Concept Guide.

## The form, field by field

- **Title** — the lesson title; used if Module Title is left blank.
- **Primary keyword** — drives the SEO meta and focus keyword.
- **Target word count** — guides length (the module aims at roughly 1,200 words by default); it does not change the credit cost.
- **Module Title** — the lesson name. *Example:* `Understanding Customer Personas`.
- **Learning Objectives** — what learners should be able to do afterwards. *Example:* `By the end learners will be able to…`.
- **Audience Level** — the learner level (e.g. beginner, intermediate, advanced); the tone and jargon adjust to match.
- **Knowledge Check Questions** — how many questions to include at the end.

## Credits and access

On the Agency plan, 3 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A lesson in clean Markdown: a Module Introduction, a Learning Objectives list, three to five teaching sections (each H2, with explanation, example and application), a Key Takeaways summary, a Knowledge Check with the requested number of questions, and a placeholder Further Reading list. It publishes as a standard post, or — on Agency — as a lesson inside LearnPress or LifterLMS when one is detected. SEO meta is written to a detected SEO plugin; an optional featured image can be attached.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply to training modules; they generate straight through.

## Worked example

**Inputs**

- Module Title: `Understanding Customer Personas`
- Learning Objectives: `By the end, learners can define a persona and build one from research`
- Audience Level: `Intermediate`
- Knowledge Check Questions: `5`

**Example output (abridged)**

> ## Module Introduction
> Customer personas turn scattered research into a shared picture of who you're designing for…
>
> ## Learning Objectives
> By the end of this module you will be able to:
> - Define what a customer persona is and isn't
> - *(…)*
>
> ## Knowledge Check
> 1. What distinguishes a persona from a market segment?
> *(…four more questions.)*

## Tips and common pitfalls

- Write Learning Objectives as observable actions ("be able to…") — the lesson and the knowledge check are built around them.
- Set the Audience Level honestly; it's what controls how much jargon the module uses.
- If you're publishing to an LMS, make sure the LMS plugin is active first — see Integrations → LMS.

## Related

Course Overview, Quiz / Assessment, Explainer / Concept Guide · Integrations → LMS · Content types overview

========================================================================
PAGE: Case Study (L&D)
URL: https://docs.aicontentbridge.com/content-types/case-study
META: slug=case-study | group=Learning & Development | tier=agency | credits=3 | image_capable=true | serp_outline=false | updated=2026-06-19
========================================================================

# Case Study (L&D)

> Scenario-based learning — situation, challenge, decision point and discussion questions — for use in training.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 3 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Case Study type turns a scenario into a structured teaching case: the background, the situation, the decision point, what happened, discussion questions, learning points and facilitator notes. It's built for trainers who teach through realistic situations rather than abstract theory.

## When to use it — and when not to

Use it when you want learners to reason through a realistic situation and discuss it. For a marketing or sales success story aimed at prospects, that's a different artifact — this type is for teaching. For structured lesson content use Training Module; for a live session plan use Workshop Facilitation Guide.

## The form, field by field

- **Title** — the case study title; used if Scenario Context is left blank.
- **Primary keyword** — drives the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Scenario Context** — the situation the case is built around. *Example:* `A manager dealing with a conflict between two team members…`.
- **Learning Focus** — the skills or themes the case should draw out. *Example:* `Conflict resolution, leadership, communication`.
- **Discussion Questions** — how many reflection questions to generate.

## Credits and access

On the Agency plan, 3 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A teaching case in clean Markdown: Background, The Situation, The Decision Point, What Happened (which can be left open-ended for discussion), Discussion Questions in the number you asked for, Learning Points, and Facilitator Notes on how to run it in a session. The tone is realistic and deliberately not too on-the-nose, so learners have something to debate. It publishes as a standard post or page, with SEO meta and an optional image.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; case studies generate straight through.

## Worked example

**Inputs**

- Scenario Context: `A new team leader inherits two senior staff who openly disagree on priorities`
- Learning Focus: `Conflict resolution, leadership`
- Discussion Questions: `5`

**Example output (abridged)**

> ## Background
> Priya has just been promoted to lead a team of six, two of whom have been in the department longer than she has…
>
> ## The Decision Point
> With a deadline approaching and the two seniors pulling in opposite directions, Priya must decide how to intervene…
>
> ## Discussion Questions
> 1. What are Priya's options, and what are the risks of each?
> *(…four more questions, then Learning Points and Facilitator Notes.)*

## Tips and common pitfalls

- The richer the Scenario Context, the more realistic and discussable the case — a sentence or two of specifics beats a vague brief.
- Use Learning Focus to steer the lesson; the discussion questions and learning points are built around it.
- Leaving "What Happened" open-ended often makes for a better discussion than a tidy resolution.

## Related

Training Module, Workshop Facilitation Guide, Explainer / Concept Guide · Content types overview

========================================================================
PAGE: Explainer / Concept Guide
URL: https://docs.aicontentbridge.com/content-types/explainer-guide
META: slug=explainer-guide | group=Learning & Development | tier=agency | credits=2 | image_capable=true | serp_outline=true | updated=2026-06-19
========================================================================

# Explainer / Concept Guide

> Break down a complex topic for a specific audience level — plain definition, analogy, how it works and common misconceptions.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 2 credits (+1 if you add an image) |
| **Featured image** | Supported (+1 credit) |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | Yes — editable outline step before generation |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Explainer / Concept Guide type makes a complex topic genuinely understandable for a chosen audience level: why it matters, a plain-English definition, how it works, real-world examples, and the misconceptions people usually hold. It's the type to reach for when clarity is the whole job.

## When to use it — and when not to

Use it to explain a single concept thoroughly. For a structured, assessable lesson use Training Module; for a scenario to discuss use Case Study; for a light public how-to on a task (rather than a concept) use Tutorial / How-To.

This is the one Learning & Development type that is treated as keyword-led web content, so it gets the SERP outline-review step (see SEO behaviour below).

## The form, field by field

- **Title** — the guide title; used if the Concept field is left blank.
- **Primary keyword** — drives the SEO meta and focus keyword; for an explainer this is usually the concept itself.
- **Target word count** — guides length (around 1,000 words by default); it does not change the credit cost.
- **Concept to Explain** — the thing being explained. *Example:* `Machine Learning, GDPR, Cash Flow`.
- **Audience Level** — who it's for (e.g. beginner, intermediate, advanced); the depth and language adjust to match.
- **Use Analogies?** — choose whether to lead with an everyday analogy or a precise technical definition. The structure changes accordingly: "The Simple Analogy" section when analogies are on, "Technical Definition" when off.

## Credits and access

On the Agency plan, 2 credits plus 1 for an optional image. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A clear guide in clean Markdown: an opening on why the concept matters, a "What Is …?" plain-English definition, then either a Simple Analogy or a Technical Definition depending on your choice, How It Works, two to three Real-World Examples, Common Misconceptions, Why It Matters for your audience, and a short Summary. It publishes as a standard post or page, with SEO meta and an optional image.

## SEO behaviour

Two things apply here. The SEO score is calculated on every generation, as usual. And because the explainer is treated as keyword-led web content, the editable SERP outline-review step runs before generation: you'll see a suggested structure and a content-gap callout, can edit it, and the approved outline is what gets written. If the search service is briefly unavailable, generation proceeds without grounding rather than failing.

## Worked example

**Inputs**

- Concept to Explain: `Machine learning`
- Audience Level: `Beginner`
- Use Analogies?: `Yes — use everyday analogies`

**Example output (abridged)**

> *Why understanding machine learning matters…*
>
> ## What Is Machine Learning?
> Machine learning is a way of getting computers to improve at a task by learning from examples, rather than being told every rule…
>
> ## The Simple Analogy
> Think of teaching a child to recognise dogs: you don't list every breed, you show examples until they get it…
>
> *(…How It Works, Real-World Examples, Common Misconceptions, Why It Matters, Summary.)*

## Tips and common pitfalls

- Match the Audience Level to your real reader — it's the single biggest lever on how the concept is pitched.
- Turn analogies on for non-technical audiences; turn them off when you want a precise, technical treatment.
- Use the outline-review step to claim the content gap the ranking pages miss before you generate.

## Related

Training Module, Tutorial / How-To, Case Study · Core concepts → SERP grounding · Content types overview

========================================================================
PAGE: Quiz / Assessment
URL: https://docs.aicontentbridge.com/content-types/quiz-assessment
META: slug=quiz-assessment | group=Learning & Development | tier=agency | credits=3 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Quiz / Assessment

> Multiple-choice, true/false or open questions with an answer key — produced both human-readable and as structured data ready for an LMS.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 3 credits |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post, or an LMS quiz (LearnPress / LifterLMS) |

## What it's for

The Quiz / Assessment type generates a set of questions on a topic — multiple-choice, true/false or open — with optional answers and explanations, and pairs the readable quiz with a structured data block so it can be imported straight into a learning management system. It's for trainers who need usable assessments, not just a list of questions.

## When to use it — and when not to

Use it to test understanding of a topic. For the teaching content itself use Training Module; for a discussion-based exercise use Case Study; for a course's overall plan use Course Overview.

## The form, field by field

- **Title** — the quiz topic; this is what the questions are written about.
- **Primary keyword** — drives the SEO meta and focus keyword.
- **Target word count** — has little effect here; question count drives length.
- **Question Type** — Multiple Choice, True / False or Open Questions. This sets both the readable format and the structured data type.
- **Number of Questions** — how many questions to generate; they progress from easier to harder.
- **Difficulty** — the overall level (e.g. easy, medium, hard).
- **Include Answer Key?** — Yes adds the correct answer and a one-line explanation to each question; No produces an assessment-only paper with no answers shown.

## Credits and access

On the Agency plan, a flat 3 credits — there's no image option for this type, so the cost doesn't vary. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

Two things in one generation. First, a human-readable quiz: a short intro, then your requested number of questions in a clean format — for multiple choice, options A–D with the correct answer and a one-line explanation when the answer key is on. Second, a structured data block (parsed automatically) that lets the quiz be created inside LearnPress or LifterLMS as a real quiz with typed questions and marked-correct answers, rather than just text. It publishes as a standard post, or as an LMS quiz when an LMS is detected on the Agency plan.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; quizzes generate straight through.

## Worked example

**Inputs**

- Title: `Customer persona fundamentals`
- Question Type: `Multiple Choice`
- Number of Questions: `10`
- Difficulty: `Medium`
- Include Answer Key?: `Yes`

**Example output (abridged)**

> A short quiz to check your understanding of customer personas.
>
> **Q1.** What best distinguishes a persona from a market segment?
> A) … B) … C) … D) …
> *Correct: B — a persona is a representative individual, a segment is a group.*
>
> *(…questions 2–10, then a structured data block used for LMS import.)*

## Tips and common pitfalls

- Pick the Question Type deliberately — it determines the structured data, which is what an LMS import relies on.
- Turn the answer key off when you want a blind assessment paper, on when you want a self-study quiz.
- Multiple-choice import is the most thoroughly tested path; true/false and open types are newer, so spot-check them after import.
- To publish into an LMS, make sure the LMS plugin is active first — see Integrations → LMS.

## Related

Training Module, Course Overview · Integrations → LMS · Content types overview

========================================================================
PAGE: Workshop Facilitation Guide
URL: https://docs.aicontentbridge.com/content-types/workshop-guide
META: slug=workshop-guide | group=Learning & Development | tier=agency | credits=3 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Workshop Facilitation Guide

> A run-it-cold facilitator's guide — agenda with timings, preparation, materials, activities, facilitator notes and discussion prompts.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 3 credits |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Workshop Facilitation Guide type produces everything a facilitator needs to run a session: an overview and objectives, what to prepare, the materials required, a time-stamped agenda built to your session length, detailed activity instructions, facilitator notes, discussion prompts and a closing. The aim is that someone could pick it up and run the workshop cold.

## When to use it — and when not to

Use it to plan and run a live, interactive session. For self-paced lesson content use Training Module; for a scenario to discuss within a session use Case Study; for the questions to assess afterwards use Quiz / Assessment.

## The form, field by field

- **Title** — the guide title; used if Workshop Topic is left blank.
- **Primary keyword** — drives the SEO meta and focus keyword.
- **Target word count** — guides length only; it does not change the credit cost.
- **Workshop Topic** — what the session is about. *Example:* `Team Communication, Change Management`.
- **Workshop Duration** — how long the session runs; the agenda is time-stamped to fit it.
- **Number of Participants** — the group size, which shapes the activities. *Example:* `10-15`.
- **Format** — how it's delivered (e.g. in-person, online); the preparation and activities adjust accordingly.

## Credits and access

On the Agency plan, a flat 3 credits — there's no image option for this type. Credits are refunded automatically if a generation fails. See Core concepts → Credits.

## What you get

A complete facilitator's guide in clean Markdown: a Workshop Overview, Pre-Workshop Preparation, Materials Required, a Detailed Agenda time-stamped to your duration (opening/icebreaker, content, activities, breaks, close), Facilitator Notes for each section, detailed Activities instructions, Discussion Prompts, and a Closing that covers summarising and agreeing next steps. It publishes as a standard post or page, with SEO meta written to a detected SEO plugin.

## SEO behaviour

The SEO score is calculated and shown on every generation. The SERP outline-review step does not apply; workshop guides generate straight through.

## Worked example

**Inputs**

- Workshop Topic: `Team communication`
- Workshop Duration: `2 hours`
- Number of Participants: `10-15`
- Format: `In-person`

**Example output (abridged)**

> ## Detailed Agenda (2 hours)
> - **0:00–0:15 — Opening & icebreaker.** Quick paired introductions on a recent communication win.
> - **0:15–0:50 — Content: how messages break down.** *(facilitator notes follow)*
> - **0:50–1:05 — Break.**
> *(…activities, discussion prompts and closing continue.)*

## Tips and common pitfalls

- Set the Duration accurately — the entire agenda, including breaks, is timed to fit it.
- Give a realistic participant count; activities are scaled to the group size.
- Choose the right Format up front; preparation and materials differ between in-person and online sessions.

## Related

Training Module, Case Study, Course Overview · Content types overview

========================================================================
PAGE: Standard Operating Procedure
URL: https://docs.aicontentbridge.com/content-types/sop
META: slug=sop | group=Learning & Development | tier=agency | credits=2 | image_capable=false | serp_outline=false | updated=2026-06-19
========================================================================

# Standard Operating Procedure

> Step-by-step process documentation with roles, responsibilities and compliance notes — generated as a structured, audit-ready SOP from a short brief.

## At a glance

| | |
|---|---|
| **Group** | Learning & Development |
| **Available on** | Agency |
| **Credit cost** | 2 credits |
| **Featured image** | Not offered for this type |
| **SEO score** | Calculated on every generation |
| **SERP outline review** | No — generates straight through |
| **Publishes as** | A WordPress post or page (draft) |

## What it's for

The Standard Operating Procedure type turns a rough description of a process into a complete, consistently structured SOP — purpose, scope, roles, numbered steps, quality checks and a review schedule — written in precise, unambiguous language. It's built for operations, HR and training teams who need to document repeatable processes at a consistent standard, and for agencies producing operational documentation for clients.

## When to use it — and when not to

Use it whenever you need a formal, repeatable process written down so anyone can follow it the same way every time: complaint handling, onboarding a new starter, a returns workflow, a month-end checklist. If you instead want to *teach* a concept rather than document a process, use Explainer / Concept Guide; if you're writing a course lesson, use Training Module; and if you only need a light, public-facing how-to, Tutorial / How-To is the better fit.

## The form, field by field

- **Title** — the document name; becomes the SOP title in the header.
- **Primary keyword** — drives the SEO meta and the focus keyword. For an SOP this is usually the process name itself.
- **Target word count** — guides length only; it does **not** change the credit cost.
- **Process Name** — the process being documented. *Example:* `Customer Complaint Handling`.
- **Department / Team** — who owns the process. *Example:* `Customer Service, Finance`.
- **Roles Involved** — the roles that appear in the procedure, comma-separated. *Example:* `Team Leader, Agent, Manager`.
- **Key Steps / Process Notes** — the raw steps or notes the SOP should be built from; rough and numbered is fine. *Example:* `1. Receive complaint, 2. Log in CRM...`.

## Credits and access

The Standard Operating Procedure type is on the **Agency** plan and costs a flat **2 credits** per generation. There's no featured-image add-on for this type, so the cost doesn't vary. If a generation fails after credits have been deducted, they're refunded automatically. See Core concepts → Credits for the full model.

## What you get

A complete SOP in clean Markdown, ready to publish, with a fixed structure:

1. A document header — *SOP Title | Department | Version | Date | Owner*
2. **1. Purpose** — what the SOP achieves, in two or three sentences
3. **2. Scope** — who must follow the procedure
4. **3. Definitions** — any key terms or acronyms explained
5. **4. Roles & Responsibilities** — a Role | Responsibility table
6. **5. Procedure** — numbered steps, each with a clear action, who performs it, and any decision points
7. **6. Quality Checks** — how to verify the process was completed correctly
8. **7. Related Documents** — a placeholder list to link your own references
9. **8. Review Schedule** — a "review every [X months]" line

It publishes as a standard WordPress post or page in draft. SEO meta (title, description, focus keyword, Open Graph) is written to whichever SEO plugin is detected — Yoast, Rank Math or SEOPress. No featured image is generated for this type.

## SEO behaviour

Two things to know. First, the deterministic SEO score (0–100 plus its fix checklist) is calculated on every SOP generation and shown as a chip on the Content Diary entry, the same as any other type. Second, the live SERP outline-review step does **not** apply to SOPs — that step is reserved for keyword-led web content such as blog posts and service pages — so an SOP generates straight through with no outline to approve.

## Worked example

**Inputs**

- Title: `Customer Complaint Handling`
- Primary keyword: `customer complaint handling`
- Process Name: `Customer Complaint Handling`
- Department / Team: `Customer Service`
- Roles Involved: `Agent, Team Leader, Manager`
- Key Steps / Process Notes: `1. Receive complaint 2. Log in CRM 3. Acknowledge within 24h 4. Investigate 5. Resolve or escalate 6. Follow up and close`

**Example output (abridged)**

> **Customer Complaint Handling** | Customer Service | v1.0 | [Date] | [Owner]
>
> ## 1. Purpose
> This SOP defines how customer complaints are received, recorded and resolved, so that every complaint is handled consistently, fairly and within agreed timeframes.
>
> ## 4. Roles & Responsibilities
>
> | Role | Responsibility |
> |---|---|
> | Agent | Receives and logs the complaint; acknowledges within 24 hours |
> | Team Leader | Investigates and resolves, or escalates where needed |
> | Manager | Reviews escalations and approves final resolution |
>
> ## 5. Procedure
> 1. **Receive the complaint** — *Agent.* Capture the complaint through any channel and confirm the customer's details.
> 2. **Log in the CRM** — *Agent.* Create a complaint record with a unique reference and category.
> 3. **Acknowledge within 24 hours** — *Agent.* Send the customer written acknowledgement with the reference number. *(Decision point: if the complaint involves a safety issue, escalate to the Manager immediately.)*
>
> *(…sections 2, 3, 6, 7 and 8 continue in the same structure.)*

## Tips and common pitfalls

- Put the real sequence in **Key Steps**, even roughly numbered — the quality of the procedure section tracks directly with how clearly you describe the steps.
- List **Roles Involved** exactly as you want them to appear; the Roles & Responsibilities table and the per-step "who performs it" are built from this field.
- The header leaves *Version*, *Date* and *Owner* as placeholders to fill in on review — that's deliberate, so the document carries proper version control.
- Set a realistic **Target word count** for the complexity of the process; a five-step task doesn't need two thousand words.

## Related

Explainer / Concept Guide, Training Module, Onboarding Document · Integrations → SEO plugins · Content types overview

========================================================================
PAGE: Integrations overview
URL: https://docs.aicontentbridge.com/integrations
META: slug=integrations | section=Integrations | updated=2026-06-19
========================================================================

# Integrations

AI Content Bridge works with the plugins you already run. There's nothing to connect or configure: it **detects** the relevant plugin on your site and adapts what it publishes accordingly. If a plugin isn't present, it falls back gracefully to a standard WordPress post — you never get an error just because an integration isn't installed.

How detection works, in one sentence: when you generate, the plugin checks which supported tools are active on your site and routes the output to them. Two consequences follow. First, to use an integration, the relevant plugin must be **installed and active before you generate**. Second, some integrations are also gated by plan, on top of needing the plugin.

| Integration | Works with | What it does | Plan |
|---|---|---|---|
| [SEO plugins](integrations-seo) | Yoast, Rank Math, SEOPress | Writes the generated SEO title, description, focus keyword and social tags into the plugin's own fields | All plans |
| [WooCommerce](integrations-woocommerce) | WooCommerce | Publishes the WooCommerce Product type as a real product with price and SKU | Starter+ |
| [Custom fields (ACF)](integrations-acf) | Advanced Custom Fields | Writes generated content into a specific ACF field rather than the post body | Pro+ |
| [LMS](integrations-lms) | LearnPress, LifterLMS | Publishes Training Modules as lessons and Quizzes as LMS quizzes | Agency |
| [Email](integrations-email) | MailPoet, Newsletter (TNP) | Drops an Email Newsletter into the tool as a draft campaign | Pro+ |
| [Events](integrations-events) | The Events Calendar | Publishes an Event Description as a calendar event with dates, venue and cost | Pro+ |

If something you expected to publish to an integration landed as a plain post instead, the usual cause is that the target plugin wasn't active, or your plan doesn't include that integration. See Troubleshooting → An integration didn't fire.

========================================================================
PAGE: Integrations: SEO plugins
URL: https://docs.aicontentbridge.com/integrations/integrations-seo
META: slug=integrations-seo | section=Integrations | updated=2026-06-19
========================================================================

# SEO plugins

Every generation produces SEO metadata — a meta title, a meta description, a focus keyword and Open Graph social tags. When a supported SEO plugin is active, AI Content Bridge writes that metadata straight into the plugin's own fields, so your post arrives fully optimised without you copying anything across. This works on every plan and for every content type.

## Supported plugins and what gets written

**Yoast SEO** — detected when Yoast is active. The generated values are written to Yoast's SEO title, meta description and focus keyword fields, along with its Open Graph title and description.

**Rank Math** — detected when Rank Math is active. The values are written to Rank Math's title, description and focus-keyword fields, plus its Open Graph title and description.

**SEOPress** — detected when SEOPress is active. The values are written to SEOPress's title and description fields, its target-keyword field, and its Facebook/Open Graph title and description.

If none of these is installed, the SEO metadata is still generated and saved with the post — you simply won't see it mapped into a dedicated plugin's UI. The deterministic SEO score (see Core concepts → The SEO score) is calculated regardless of which SEO plugin, if any, you use.

## Notes and tips

- The metadata is written when the post is created. If you regenerate or heavily edit the body afterwards, review the meta still fits.
- You only need one SEO plugin; if more than one is active, the metadata is written to the supported plugin(s) detected.
- The SEO score grades the metadata that was produced, so a strong score travels with the post into whichever plugin you use.

## Related

Core concepts → The SEO score · Core concepts → SERP grounding · Integrations overview

========================================================================
PAGE: Integrations: WooCommerce
URL: https://docs.aicontentbridge.com/integrations/integrations-woocommerce
META: slug=integrations-woocommerce | section=Integrations | updated=2026-06-19
========================================================================

# WooCommerce

When WooCommerce is active, the WooCommerce Product content type publishes as a real product rather than a plain post — so the description lands where your shop expects it, with the commerce fields populated.

## What it does

Detected when WooCommerce is active on your site. The WooCommerce Product type then creates a product and writes:

- the generated description into the product description,
- the **price** you entered into the product's regular-price field,
- a **SKU** into the product's SKU field.

The product is created as a draft for you to review, set categories and images, and publish.

If WooCommerce isn't active, the WooCommerce Product type still works — it simply falls back to a standard post containing the description, so nothing is lost.

## Notes and tips

- Activate WooCommerce before generating if you want a product rather than a post.
- Enter the price in the product form's Price field if you want it carried across; leave it blank to set it later in WooCommerce.
- Other content types always publish as posts or pages — only the WooCommerce Product type creates a product.

## Related

Content types → WooCommerce Product · Integrations overview · Troubleshooting → An integration didn't fire

========================================================================
PAGE: Integrations: Custom fields (ACF)
URL: https://docs.aicontentbridge.com/integrations/integrations-acf
META: slug=integrations-acf | section=Integrations | updated=2026-06-19
========================================================================

# Custom fields (ACF)

Advanced Custom Fields support lets you send generated content into a specific custom field rather than the post body. It's for theme-driven and page-builder setups where your layout reads content from named fields instead of the main editor. ACF field targeting is available on **Pro and above**.

## What it does

Detected when Advanced Custom Fields is active on your site. With ACF present, you can choose a target field, and the generated content is written into that field on the post you're updating — rather than into the post body. This keeps content flowing into whatever structure your theme or templates expect.

If ACF isn't active, or you don't choose a field, content publishes into the post body as normal.

## Notes and tips

- This is an advanced option; most users publish to the post body and never need it.
- Make sure ACF is active and the target field exists on the post type you're writing to.
- For the technical detail — how a field is targeted and written — see the Developer docs.

## Related

Developer docs · Integrations overview · Core concepts → Tiers and access

========================================================================
PAGE: Integrations: LMS
URL: https://docs.aicontentbridge.com/integrations/integrations-lms
META: slug=integrations-lms | section=Integrations | updated=2026-06-19
========================================================================

# LMS (LearnPress & LifterLMS)

On the Agency plan, AI Content Bridge can publish learning content directly into your learning management system rather than as plain posts — so a generated lesson or quiz arrives as a real LMS object you can slot into a course.

## What it does

Detected when LearnPress or LifterLMS is active on your site. Two content types take advantage of it:

- **Training Module** can publish as a **lesson** in the detected LMS.
- **Quiz / Assessment** can publish as a **quiz**, using the structured question data the generator produces so questions and correct answers come through as real quiz items rather than text.

With LifterLMS, lessons are associated with their parent course and quiz questions are created as the LMS's own question objects. LearnPress lessons and quizzes are created in its structure in the same spirit. In both cases the items are created for you to review and attach within the course.

If no supported LMS is active, Training Modules and Quizzes publish as standard posts, so the content is still produced.

## Notes and tips

- Activate your LMS before generating if you want a lesson or quiz rather than a post.
- For quizzes, choose the question type deliberately — it determines the structured data the LMS import relies on; multiple-choice is the most thoroughly tested path.
- After import, open the lesson or quiz in your LMS to set its place in the course and any settings the LMS needs.

## Related

Content types → Training Module · Content types → Quiz / Assessment · Integrations overview

========================================================================
PAGE: Integrations: Email
URL: https://docs.aicontentbridge.com/integrations/integrations-email
META: slug=integrations-email | section=Integrations | updated=2026-06-19
========================================================================

# Email (MailPoet & Newsletter/TNP)

On the Pro plan and above, an Email Newsletter can drop straight into your email plugin as a draft campaign — so the subject line, preview text and body land where you send from, ready to review.

## What it does

Detected when MailPoet or the Newsletter (TNP) plugin is active on your site. When you generate an Email Newsletter, it's created as a **draft** in the detected tool: the subject line, preview text and body are populated, and you can target a list. Nothing is sent automatically — you review and send from within the email plugin as usual.

If neither email plugin is active, the Email Newsletter type publishes as a standard post containing the email content, so it's never lost.

## Notes and tips

- Activate MailPoet or Newsletter before generating if you want a draft campaign rather than a post.
- The draft is created unsent by design; final review and sending stay in your hands.
- A single, clear call to action in the form produces a stronger email than several competing ones.

## Related

Content types → Email Newsletter · Integrations overview · Troubleshooting → An integration didn't fire

========================================================================
PAGE: Integrations: Events
URL: https://docs.aicontentbridge.com/integrations/integrations-events
META: slug=integrations-events | section=Integrations | updated=2026-06-19
========================================================================

# Events (The Events Calendar)

On the Pro plan and above, an Event Description can publish as a proper calendar event rather than a plain post — so the dates, venue and cost populate The Events Calendar's own fields and the event shows up in your calendar views.

## What it does

Detected when The Events Calendar is active on your site. When you generate an Event Description, it's created as a calendar event with these fields set from your form:

- start and end **date and time**,
- the **venue / location**,
- the **ticket price / cost**,
- the **event / tickets URL**.

The generated copy becomes the event description. The event is created as a draft for you to review and publish.

If The Events Calendar isn't active, the Event Description type publishes as a standard post containing the event details, so nothing is lost.

## Notes and tips

- Activate The Events Calendar before generating if you want a calendar event rather than a post.
- Fill in the date, venue, price and URL fields — these are what populate the event's structured fields.
- Enter the date and time clearly; a well-formed date helps it map cleanly into the calendar.

## Related

Content types → Event Description · Integrations overview · Troubleshooting → An integration didn't fire

========================================================================
PAGE: For agencies
URL: https://docs.aicontentbridge.com/for-agencies
META: slug=for-agencies | section=For agencies | updated=2026-06-19
========================================================================

# For agencies

The Agency plan is built for people producing content across many clients rather than for one site. This page covers the features that matter when that's your job: per-client voice, the full content range, publishing into clients' systems, and how licensing works across multiple sites.

## Per-client brand voice with Writing Style Profiles

The feature most agencies subscribe for is Writing Style Profiles. You can create a separate profile per client — capturing their tone, sentence style and signature moves, either from a writing sample or a template — and switch between them in a click. Every generation then comes out in that client's voice without re-prompting, so a dozen clients can each sound like themselves. See Core concepts → Brand voice and Writing Style Profiles.

## The full content range

Agency unlocks every content type, including the complete Learning & Development suite (Course Overview, Training Module, Case Study, Explainer Guide, Quiz / Assessment, Workshop Guide and SOP) on top of all the marketing, commerce and business types. That means one tool covers a marketing client, an e-commerce client and a training client alike. The Content types overview shows the full set.

## Publishing into clients' systems

Because content publishes through the integrations, you can deliver into whatever a client runs: SEO metadata into their Yoast, Rank Math or SEOPress; products into their WooCommerce; lessons and quizzes into their LearnPress or LifterLMS; newsletters into their MailPoet or Newsletter; events into their Events Calendar. Each is detected automatically on the client's site. See Integrations.

## Working across multiple client sites

Licences are locked to a domain — a licence registers to the first site it's used on, which keeps it from being used elsewhere. If you manage several client sites, that has practical implications for how many licences and registrations you need, and moving a licence between sites is done by contacting support. If you're setting up across multiple client sites, talk to support about the right arrangement for your agency before you roll out.

## A sensible workflow

A pattern that works well: set up a Writing Style Profile per client first; group each client's work so you can switch profile, generate, review the SEO score, and publish into their stack; and lean on the outline-review step for the client's keyword-led pages so each piece is grounded in what already ranks in their niche.

## Related

Core concepts → Brand voice and Writing Style Profiles · Content types overview · Integrations · Account & billing

========================================================================
PAGE: Developer docs
URL: https://docs.aicontentbridge.com/developer-docs
META: slug=developer-docs | section=Developer docs | updated=2026-06-19
========================================================================

# Developer docs

This page is for developers and technically-minded site owners who want to understand how AI Content Bridge works under the hood: the data flow, the external services it relies on, the security model, how it publishes, and how to target custom fields.

## How it fits together

AI Content Bridge has two halves: the WordPress plugin on your site, and the AI Content Bridge service (a hosted Node/Express application). The plugin never holds AI provider keys and never calls AI providers directly. Instead:

1. You submit a generation from the plugin. The plugin sends your licence key, your site domain and your form inputs to the AI Content Bridge service.
2. The service validates the licence and domain, checks and deducts credits, then orchestrates generation — calling the AI providers as needed.
3. The finished content (and any image) is sent back to your site and created as a post, product, lesson, event or campaign via your site's REST API.
4. If anything fails after credits were deducted, they're refunded automatically.

This keeps provider keys server-side and means your site only needs to talk to one endpoint.

## External services

Generation relies on these third-party services, all called by the AI Content Bridge service on your behalf:

| Service | Used for | When | Data sent |
|---|---|---|---|
| AI Content Bridge service | Licence validation, credit management, orchestration | Every generation and licence check | Licence key, site domain, your content inputs |
| Anthropic (Claude) | Generating the article text and SEO metadata | Every generation | The prompt built from your title, keyword and brief fields |
| OpenAI | Generating the featured image | Only when you include an image | An image prompt derived from your title and chosen style |
| Serper.dev | Fetching search-results data for SEO grounding | Only for keyword-led web types with grounding enabled | Your primary keyword |
| YouTube Data API | Finding videos to embed | Only when you include video embeds | A search query derived from your topic |

See the wordpress.org readme for the user-facing version of this disclosure with links to each provider's terms.

## Security model

- **No user API keys.** Provider keys live on the service, never in your WordPress install or browser.
- **Licence and domain validation.** Each request is validated against an active licence, and the licence is locked to its registered domain.
- **Server-to-server authentication.** The generation endpoint and the publish-back to your site are authenticated, so content can only be written by the service for a valid request.
- **Atomic credits.** Credits are deducted before generation and refunded on failure, so a failed run can't silently cost credits.

## Publishing and the REST API

Content is created on your site through the WordPress REST API. For this to work, the REST API must be reachable and pretty permalinks enabled. Security or firewall plugins that block REST requests or external POSTs are the most common reason a generation succeeds but doesn't appear — allow the AI Content Bridge requests if you run one. See Troubleshooting → The article generated but didn't appear in WordPress.

## Targeting custom fields (ACF)

When Advanced Custom Fields is active (Pro and above), generated content can be written into a named ACF field on a target post rather than the post body — useful when your theme or page builder renders content from fields. You select the target field at generation time. If no field is targeted, content goes to the post body. See Integrations → Custom fields (ACF).

## Related

Integrations · Core concepts · Troubleshooting & FAQ
