// routes/beta-feedback.js
// POST /api/beta-feedback
// Receives structured beta tester feedback, stores in PostgreSQL, emails via Resend

const express = require('express');
const router  = express.Router();
const { Resend } = require('resend');
const { Pool }   = require('pg');

const pool   = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/', async (req, res) => {
  const { tester_name, access_code, plan_tier, submitted_at, tasks, overall_rating, overall_comments } = req.body;

  // Detect LB vs ACB submission by access code prefix
  const isLB = access_code && (access_code.startsWith('LB') || access_code.startsWith('AGENCY_BETA'));

  if (!tester_name || !tasks) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // ── Store in PostgreSQL ────────────────────────────────────────────────
    await pool.query(`
      INSERT INTO beta_feedback
        (tester_name, access_code, plan_tier, submitted_at, tasks_json, overall_rating, overall_comments)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      tester_name,
      access_code || 'unknown',
      plan_tier   || 'unknown',
      submitted_at || new Date().toISOString(),
      JSON.stringify(tasks),
      overall_rating || null,
      overall_comments || null,
    ]);

    // ── Build email summary ────────────────────────────────────────────────
    const taskRows = tasks.map(t => {
      const statusIcon = t.completed ? '✅' : '⬜';
      const stars      = t.rating ? '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating) : 'Not rated';
      const tags       = t.tags?.length ? t.tags.join(', ') : '—';
      const feedback   = t.feedback_answers?.map(a => typeof a === 'string' ? a : (a?.answer || '')).filter(a => a.trim()).join('<br>') || '—';
      return `
        <tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:10px 12px;font-weight:600;color:#111">${statusIcon} ${t.title}</td>
          <td style="padding:10px 12px;color:#6b7280">${stars}</td>
          <td style="padding:10px 12px;color:#6b7280">${tags}</td>
          <td style="padding:10px 12px;color:#374151;font-size:13px">${feedback}</td>
        </tr>`;
    }).join('');

    const completedCount = tasks.filter(t => t.completed).length;
    const avgRating      = tasks.filter(t => t.rating).length
      ? (tasks.reduce((s, t) => s + (t.rating || 0), 0) / tasks.filter(t => t.rating).length).toFixed(1)
      : 'N/A';

    await resend.emails.send({
      from:    isLB ? (process.env.LB_FROM_EMAIL || 'LearnBridge <noreply@learn-bridge.com>') : (process.env.RESEND_FROM_EMAIL || 'AI Content Bridge <noreply@aicontentbridge.com>'),
      to:      isLB ? (process.env.LB_BETA_FEEDBACK_EMAIL || process.env.LB_SUPPORT_EMAIL || 'hello@learn-bridge.com') : (process.env.BETA_FEEDBACK_EMAIL || process.env.ADMIN_EMAIL || 'hello@aicontentbridge.com'),
      subject: `${isLB ? '🎓 LB ' : ''}🧪 Beta Feedback — ${tester_name} (${completedCount}/${tasks.length} tasks, ${avgRating}★)`,
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:700px;margin:0 auto;background:#f9fafb;padding:32px 24px">
          <div style="background:${isLB ? '#534AB7' : '#06101E'};border-radius:12px;padding:24px 28px;margin-bottom:24px">
            <h1 style="margin:0;color:#5CA5FF;font-size:22px;font-weight:400;font-style:italic">Beta Feedback Report</h1>
            <p style="margin:6px 0 0;color:rgba(200,214,240,0.6);font-size:14px">${isLB ? 'LearnBridge' : 'AI Content Bridge'}</p>
          </div>

          <div style="background:#fff;border-radius:10px;padding:20px 24px;margin-bottom:16px;border:1px solid #e5e7eb">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px">Tester</td><td style="font-weight:600;color:#111">${tester_name}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Access code</td><td style="color:#374151">${access_code || '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Plan tier</td><td style="color:#374151">${plan_tier || '—'}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Submitted</td><td style="color:#374151">${new Date(submitted_at).toLocaleString('en-GB')}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Tasks completed</td><td style="font-weight:600;color:${isLB ? '#7F77DD' : '#1B6EF3'}">${completedCount} / ${tasks.length}</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Avg rating</td><td style="font-weight:600;color:${isLB ? '#7F77DD' : '#1B6EF3'}">${avgRating} ★</td></tr>
            </table>
          </div>

          ${overall_comments ? `
          <div style="background:${isLB ? '#EEEDFE' : '#EFF6FF'};border:1px solid ${isLB ? '#AFA9EC' : '#BFDBFE'};border-radius:10px;padding:16px 20px;margin-bottom:16px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${isLB ? '#7F77DD' : '#1B6EF3'};margin-bottom:8px">Overall comments</div>
            <p style="margin:0;color:${isLB ? '#3C3489' : '#1e3a5f'};font-size:14px;line-height:1.6">${overall_comments}</p>
          </div>` : ''}

          <div style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="background:#f3f4f6">
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Task</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Rating</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Tags</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">Feedback</th>
                </tr>
              </thead>
              <tbody>${taskRows}</tbody>
            </table>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;text-align:center">
            ${isLB ? 'LearnBridge' : 'AI Content Bridge'} Beta Programme · stored in PostgreSQL beta_feedback table
          </p>
        </div>
      `
    });

    console.log(`[${isLB ? 'lb-' : ''}beta-feedback] Stored and emailed feedback from ${tester_name}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[beta-feedback] Error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback', detail: err.message });
  }
});

module.exports = router;
