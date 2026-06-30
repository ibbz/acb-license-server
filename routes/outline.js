/**
 * POST /api/outline
 *
 * SEO outline-review step. Given a keyword + title, fetches live SERP grounding
 * and asks Claude for a structured, editable outline (headings, points, FAQ,
 * and the content gap competitors miss). The plugin renders this for the user
 * to tweak, then sends the approved outline to /api/generate.
 *
 * Cheap: one SERP call + one small Claude call. No credits deducted here —
 * the credit is taken at generation. Secured by the shared generate secret,
 * same as /api/generate.
 *
 * Env: ANTHROPIC_API_KEY, SERP_API_KEY (optional — grounding degrades to
 * best-practice structure if absent), SERP_DEFAULT_GL (optional, default 'us').
 */

const express = require('express');
const router  = express.Router();
const serp    = require('../lib/serp');

// Strip ```json fences and parse, tolerating any preamble/trailing prose.
function parseJsonLoose(text) {
    let t = String(text || '').trim().replace(/```json\s*|\s*```/g, '');
    const start = t.indexOf('{');
    const end   = t.lastIndexOf('}');
    if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
    return JSON.parse(t);
}

async function callClaude(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured on server');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            temperature: 0.5,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    const text = data?.content?.map(b => b.text || '').join('');
    if (!text) throw new Error('Empty response from Anthropic API');
    return text;
}

router.post('/', async (req, res) => {
    // Same shared-secret gate as /api/generate
    const secret = process.env.GENERATE_SECRET;
    if (secret && req.headers['x-generate-secret'] !== secret) {
        return res.status(401).json({ success: false, error: 'Unauthorised' });
    }

    const { keyword, title, serp_gl, serp_hl } = req.body || {};
    const kw = (keyword || title || '').trim();
    if (!kw) {
        return res.status(400).json({ success: false, error: 'keyword or title is required' });
    }

    try {
        // 1. live SERP grounding (null if SERP_API_KEY unset or anything fails)
        let ground = null;
        if (serp.enabled()) {
            ground = await serp.getSerpGrounding(kw, {
                gl: serp_gl || process.env.SERP_DEFAULT_GL || 'us',
                hl: serp_hl || 'en',
            });
        }

        // 2. structured outline from Claude
        const prompt  = serp.buildOutlinePrompt(kw, title, ground);
        const rawText = await callClaude(prompt);

        let outline;
        try {
            outline = parseJsonLoose(rawText);
        } catch (e) {
            console.warn('[outline] JSON parse failed:', e.message);
            return res.status(502).json({ success: false, error: 'Could not parse outline. Please retry.' });
        }

        return res.json({
            success: true,
            grounded: !!ground,
            outline,
            // lightweight extras the UI can show as keyword ideas (free byproduct)
            people_also_ask:  ground ? ground.peopleAlsoAsk  : [],
            related_searches: ground ? ground.relatedSearches : [],
            competitors:      ground ? ground.competitors.map(c => ({ title: c.title, url: c.url })) : [],
        });
    } catch (err) {
        console.error('[outline] failed:', err.message);
        return res.status(500).json({ success: false, error: 'Outline generation failed' });
    }
});

module.exports = router;
