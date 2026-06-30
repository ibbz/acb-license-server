/**
 * POST /api/extract-style
 *
 * Accepts a writing sample and uses Claude to extract a structured
 * style profile: voice, tone, sentence structure, signature moves, forbidden patterns.
 *
 * Secured by x-generate-secret header (same as /api/generate).
 * Requires an active license key.
 */

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

router.post('/', async (req, res) => {
    const { license_key, sample } = req.body;

    // ── Auth ────────────────────────────────────────────────────────────────
    const secret = process.env.GENERATE_SECRET;
    if (secret && req.headers['x-generate-secret'] !== secret) {
        return res.status(401).json({ success: false, error: 'Unauthorised.' });
    }

    // ── Validation ──────────────────────────────────────────────────────────
    if (!license_key) {
        return res.status(400).json({ success: false, error: 'License key is required.' });
    }
    if (!sample || sample.trim().length < 100) {
        return res.status(400).json({ success: false, error: 'Writing sample must be at least 100 characters.' });
    }

    // ── Verify license is active ────────────────────────────────────────────
    try {
        const licenseResult = await pool.query(
            `SELECT id, tier, status, email_verified FROM license_keys WHERE license_key = $1`,
            [license_key]
        );

        if (licenseResult.rows.length === 0 || licenseResult.rows[0].status !== 'active') {
            return res.status(403).json({ success: false, error: 'Invalid or inactive license key.' });
        }

        const license = licenseResult.rows[0];

        // Free tier must be email verified
        if (license.tier === 'free' && !license.email_verified) {
            return res.status(403).json({ success: false, error: 'Please verify your email before using Style Profiles.' });
        }

        // Style profiles are Pro/Agency only
        if (!['pro', 'agency'].includes(license.tier)) {
            return res.status(403).json({ success: false, error: 'Writing Style Profiles are available on Pro and Agency plans.' });
        }

    } catch (err) {
        console.error('[extract-style] DB error:', err.message);
        return res.status(500).json({ success: false, error: 'Server error. Please try again.' });
    }

    // ── Call Claude ─────────────────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'API not configured on server.' });
    }

    const systemPrompt = `You are an expert writing analyst specialising in voice, tone, and style extraction.
Your job is to analyse a writing sample and return a precise, actionable style profile that can be used to instruct an AI to write in the same style.
You must respond with ONLY a valid JSON object — no preamble, no markdown, no explanation. Just the raw JSON.`;

    const userPrompt = `Analyse this writing sample and extract a detailed style profile.

WRITING SAMPLE:
---
${sample.trim()}
---

Return a JSON object with exactly these fields:
{
  "tagline": "A single sentence (max 8 words) describing the style",
  "voice": "2-3 sentences describing the personality and feel of the writing — how it sounds, who it speaks to, what relationship it creates with the reader",
  "tone": "1-2 sentences describing the emotional register — formal/casual, warm/clinical, serious/humorous, etc.",
  "sentence_structure": "2-3 sentences describing sentence length, paragraph length, rhythm, use of lists, questions, etc.",
  "signature_moves": "2-3 sentences describing recurring techniques — how it opens, how it closes, favourite devices, patterns",
  "forbidden": "1-2 sentences describing what this writing never does — words, structures, or approaches that would feel wrong"
}

Be specific and actionable. A writer should be able to read this profile and immediately know how to replicate the style.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model:      'claude-sonnet-4-6',
                max_tokens: 1024,
                system:     systemPrompt,
                messages:   [{ role: 'user', content: userPrompt }],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[extract-style] Anthropic error:', err);
            return res.status(500).json({ success: false, error: 'Style extraction failed. Please try again.' });
        }

        const data   = await response.json();
        const text   = data?.content?.map(b => b.text || '').join('').trim();

        if (!text) {
            return res.status(500).json({ success: false, error: 'Empty response from AI. Please try again.' });
        }

        // Parse JSON — strip any accidental markdown fences
        const clean = text.replace(/```json|```/g, '').trim();
        let profile;
        try {
            profile = JSON.parse(clean);
        } catch (parseErr) {
            console.error('[extract-style] JSON parse error:', parseErr.message, '\nRaw:', clean);
            return res.status(500).json({ success: false, error: 'Could not parse style profile. Please try again.' });
        }

        // Validate required fields are present
        const required = ['tagline', 'voice', 'tone', 'sentence_structure', 'signature_moves', 'forbidden'];
        const missing  = required.filter(f => !profile[f]);
        if (missing.length > 0) {
            console.error('[extract-style] Missing fields:', missing);
            return res.status(500).json({ success: false, error: 'Incomplete style profile returned. Please try again.' });
        }

        console.log(`[extract-style] Profile extracted for license ...${license_key.slice(-6)}`);

        return res.json({
            success: true,
            profile,
        });

    } catch (err) {
        console.error('[extract-style] Error:', err.message);
        return res.status(500).json({ success: false, error: 'Style extraction failed. Please try again.' });
    }
});

module.exports = router;