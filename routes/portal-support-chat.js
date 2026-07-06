// routes/portal-support-chat.js
// POST /api/portal/support/chat — answers product questions from the docs knowledge base.
//
// Setup:
//   1. Drop the generated knowledge base at:  license-server/bot/docs-bot-knowledge.md
//   2. In server.js, add this line near the other portal mounts:
//        app.use('/api/portal/support', require('./routes/portal-support-chat'));
//   3. ANTHROPIC_API_KEY must be set (you already use it for generation).
//
// Regenerate the knowledge base whenever the docs change:  node scripts/build-bot-kb.mjs

const express   = require('express');
const router    = express.Router();
const rateLimit = require('express-rate-limit');
const fs        = require('fs');
const path      = require('path');
const { Pool }  = require('pg');
const { requireAuth } = require('./portal-auth');
const costLog   = require('../lib/cost-log');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TEXT_MODEL = 'claude-sonnet-4-6'; // must have a matching entry in lib/pricing.js

// ── Load the knowledge base once at boot (cached in memory) ───────────────────
const KB_PATH = process.env.BOT_KB_PATH || path.join(__dirname, '..', 'bot', 'docs-bot-knowledge.md');
let KNOWLEDGE_BASE = '';
try {
  KNOWLEDGE_BASE = fs.readFileSync(KB_PATH, 'utf8');
  console.log(`[support-chat] Loaded knowledge base (${KNOWLEDGE_BASE.length.toLocaleString()} chars)`);
} catch (err) {
  console.warn(`[support-chat] Knowledge base not found at ${KB_PATH} — the assistant will return an error until it's added.`);
}

// ── The assistant's instructions (the knowledge base is appended below them) ──
const INSTRUCTIONS = `You are the AI Content Bridge support assistant — a friendly, knowledgeable helper in the AI Content Bridge customer portal. You help people use the AI Content Bridge WordPress plugin, which generates publish-ready content (articles, SEO metadata, images, embeds) without the user needing their own AI API keys.

How to answer:
- Answer using only the product documentation in the knowledge base below. It is the complete, current documentation for the product.
- When your answer comes from a page, link the user to it using that page's URL from the knowledge base (for example, "Full steps here: https://docs.aicontentbridge.com/troubleshooting"). Prefer the single most relevant page.
- Be concise, warm and professional, and use British spelling. Lead with the answer; add steps when steps genuinely help.
- If a user quotes an error message, match it to the exact entry on the Troubleshooting page and give that cause and fix.
- Quote the real facts (credit costs, tiers, what a content type does, how an integration is detected) from the documentation. Don't estimate them. If a user's claim conflicts with the documentation, trust the documentation and correct it gently.

When to defer:
- You know the public documentation, not the user's account. If a question needs their account data, reports a possible bug, or asks for something not in the documentation (roadmap, custom work, exact prices), don't guess. Say what the documentation covers, then point them to raise a ticket from the Support area of the portal, noting that Pro and Agency customers receive priority support. Don't promise specific outcomes, timelines or policies.

Boundaries:
- You only have the public documentation. Never reveal or speculate about API keys, secrets, server internals, or security details beyond what the documentation states.
- Don't help anyone bypass licensing, domain locking, or credit limits.
- Stay on the topic of using AI Content Bridge. Politely redirect unrelated requests.`;

// ── Light rate limit, in the spirit of the other AI endpoints ─────────────────
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending messages too quickly. Please wait a moment and try again.' },
});

// ── POST /chat ────────────────────────────────────────────────────────────────
router.post('/chat', chatLimiter, requireAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Assistant is not configured.' });
  if (!KNOWLEDGE_BASE) return res.status(503).json({ error: 'The assistant is temporarily unavailable.' });

  // Accept the running conversation. Sanitise roles and trim length/size.
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  let messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
    .slice(-16);

  // Anthropic requires the conversation to begin with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return res.status(400).json({ error: 'No message provided.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: 1024,
        // System is split so the large, unchanging knowledge base is cached.
        // (Prompt caching is generally available; if your account ever errors on
        // cache_control, add header 'anthropic-beta': 'prompt-caching-2024-07-31'.)
        system: [
          { type: 'text', text: INSTRUCTIONS },
          { type: 'text', text: KNOWLEDGE_BASE, cache_control: { type: 'ephemeral' } },
        ],
        messages,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error(`[support-chat] Anthropic error ${r.status}: ${detail.slice(0, 300)}`);
      return res.status(502).json({ error: 'The assistant had trouble responding. Please try again.' });
    }

    const data = await r.json();

    // Cost instrumentation. This is the ONE ACB route where prompt caching is
    // live (the KB block above) — the first request in a 5-min window pays the
    // 1.25x cache WRITE on the whole knowledge base, subsequent ones pay the
    // 0.10x cache READ. Both show up in data.usage and are priced by
    // lib/pricing.js. Attribution comes from the portal JWT (req.user).
    // Fire-and-forget: never delays or fails the reply.
    costLog.resolveLicenseId(pool, req.user?.license_key).then(licenseKeyId =>
      costLog.insertCostRow(pool, {
        licenseKeyId,
        domain:      'portal',
        postTitle:   'Support assistant reply',
        contentType: 'support_chat',
        model:       TEXT_MODEL,
        usage:       data?.usage || null,
        stop_reason: data?.stop_reason || null,
        image:       null,
        serpCalls:   0,
        costEvent:   'support_chat',
        succeeded:   true,
      })
    ).catch(() => {});

    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    return res.json({ reply: reply || "Sorry, I couldn't produce an answer to that one." });
  } catch (err) {
    console.error('[support-chat] Request failed:', err.message);
    return res.status(500).json({ error: 'Something went wrong reaching the assistant.' });
  }
});

module.exports = router;
