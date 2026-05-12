// Cloudflare Worker — ZRH Field Leads form proxy
// Deploy with: wrangler deploy

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const WORKER_BASE     = 'https://zrh-field-leads-form.maurin.workers.dev';
const MAURIN_EMAIL    = 'maurin@dai.cx';
const MARCO_EMAIL     = 'mtranzatto@gravisrobotics.com';
const TELEGRAM_CHAT   = '1597503772';

const WELCOME_TEMPLATE_ID    = 1;
const REJECTION_TEMPLATE_ID  = 3;
const RSVP_TEMPLATE_ID       = 7;

// Approval status codes stored in Brevo
const STATUS_PENDING   = 1;
const STATUS_APPROVED  = 2;
const STATUS_REJECTED  = 3;
const STATUS_REVIEW    = 4;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/submit')      return handleSubmit(request, env);
    if (url.pathname === '/admin/vote')  return handleVote(request, env, url);
    if (url.pathname === '/rsvp')        return handleRsvp(request, env, url);

    return new Response('Not found', { status: 404 });
  }
};

// ---------------------------------------------------------------------------
// /submit — new sign-up
// ---------------------------------------------------------------------------
async function handleSubmit(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  let data;
  try { data = await request.json(); }
  catch {
    return jsonResponse({ message: 'Invalid JSON' }, 400, CORS_HEADERS);
  }

  const { email, firstName, lastName, company, role, linkedin, phone, why, newsletter } = data;
  if (!email || !firstName || !lastName || !company || !role || !linkedin || !why) {
    return jsonResponse({ message: 'Missing required fields' }, 400, CORS_HEADERS);
  }

  // Generate per-applicant vote token
  const voteToken = crypto.randomUUID();

  // Create/update contact in Brevo
  const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      attributes: {
        FIRSTNAME: firstName, LASTNAME: lastName,
        COMPANY: company, ROLE: role,
        LINKEDIN_URL: linkedin, PHONE: phone || '',
        WHY_JOIN: why,
        APPROVAL_STATUS_CATEGORY: STATUS_PENDING,
        NEWSLETTER: newsletter !== false ? 'yes' : 'no',
        VOTE_TOKEN: voteToken,
        VOTE_MAURIN: '', VOTE_MARCO: '',
      },
      listIds: [3],
      updateEnabled: true,
    }),
  });

  if (!brevoRes.ok && brevoRes.status !== 201 && brevoRes.status !== 204) {
    const err = await brevoRes.json().catch(() => ({}));
    return jsonResponse({ message: err.message || 'Brevo error' }, 500, CORS_HEADERS);
  }

  const applicantName = `${firstName} ${lastName}`;

  // Send approval email to both Maurin and Marco
  await Promise.all([
    sendApprovalNotification(env, 'maurin', MAURIN_EMAIL, applicantName, email, company, role, linkedin, why, voteToken),
    sendApprovalNotification(env, 'marco',  MARCO_EMAIL,  applicantName, email, company, role, linkedin, why, voteToken),
  ]);

  // Telegram ping
  const msg = `🤖 *New application — ZRH Field Robotics Leads*\n\n` +
    `*${applicantName}*\n🏢 ${company} — ${role}\n📧 ${email}\n` +
    (phone ? `📱 ${phone}\n` : '') +
    `🔗 ${linkedin}\n\n💬 _${why.substring(0, 200)}${why.length > 200 ? '...' : ''}_\n\n` +
    `Approval emails sent to Maurin and Marco.`;
  await telegram(env, msg);

  return jsonResponse({ success: true }, 200, CORS_HEADERS);
}

function approvalEmailHtml(voterName, applicantName, applicantEmail, company, role, linkedin, why, approveUrl, rejectUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;">
<div style="width:100%;background:#f5f5f7;padding:24px 0;">
  <div style="width:600px;max-width:100%;margin:0 auto;">
    <div style="background:#fff;border-radius:16px;border-top:4px solid #0071e3;padding:36px 32px 32px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#0071e3;">ZRH Field Robotics Leads</div>
      <div style="font-size:26px;font-weight:700;color:#1d1d1f;margin-top:8px;">New application to review</div>
      <div style="font-size:15px;color:#6e6e73;margin-top:6px;">Hi ${voterName}, someone wants to join the group.</div>
    </div>
    <div style="background:#fff;border-radius:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">
        <tr><td style="color:#6e6e73;padding:4px 0;width:100px;">Name</td><td style="color:#1d1d1f;font-weight:600;">${applicantName}</td></tr>
        <tr><td style="color:#6e6e73;padding:4px 0;">Company</td><td style="color:#1d1d1f;">${company}</td></tr>
        <tr><td style="color:#6e6e73;padding:4px 0;">Role</td><td style="color:#1d1d1f;">${role}</td></tr>
        <tr><td style="color:#6e6e73;padding:4px 0;">Email</td><td style="color:#1d1d1f;">${applicantEmail}</td></tr>
        <tr><td style="color:#6e6e73;padding:4px 0;">LinkedIn</td><td><a href="${linkedin}" style="color:#0071e3;">${linkedin}</a></td></tr>
        <tr><td style="color:#6e6e73;padding:4px 0;vertical-align:top;">Why</td><td style="color:#1d1d1f;font-style:italic;">${why}</td></tr>
      </table>
    </div>
    <div style="background:#fff;border-radius:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:28px 32px;text-align:center;">
      <p style="margin:0 0 24px;font-size:15px;color:#1d1d1f;">What's your call?</p>
      <a href="${approveUrl}" style="display:inline-block;background:#34c759;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:10px;margin-right:12px;">Approve</a>
      <a href="${rejectUrl}" style="display:inline-block;background:#ff3b30;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:10px;">Reject</a>
    </div>
    <div style="text-align:center;font-size:12px;color:#8e8e93;padding:16px;">
      ZRH Field Robotics Leads
    </div>
  </div>
</div>
</body></html>`;
}

async function sendApprovalNotification(env, voter, voterEmail, applicantName, applicantEmail, company, role, linkedin, why, token) {
  const base = `${WORKER_BASE}/admin/vote?email=${encodeURIComponent(applicantEmail)}&voter=${voter}&token=${token}`;
  const approveUrl = `${base}&decision=approve`;
  const rejectUrl  = `${base}&decision=reject`;
  const voterName  = voter === 'maurin' ? 'Maurin' : 'Marco';
  const html = approvalEmailHtml(voterName, applicantName, applicantEmail, company, role, linkedin, why, approveUrl, rejectUrl);

  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'ZRH Field Robotics Leads', email: MAURIN_EMAIL },
      to: [{ email: voterEmail, name: voterName }],
      subject: `New application: ${applicantName} (${company})`,
      htmlContent: html,
    }),
  });
}

// ---------------------------------------------------------------------------
// /admin/vote — Maurin or Marco casts their vote
// ---------------------------------------------------------------------------
async function handleVote(request, env, url) {
  const email    = url.searchParams.get('email');
  const voter    = url.searchParams.get('voter');    // 'maurin' | 'marco'
  const decision = url.searchParams.get('decision'); // 'approve' | 'reject'
  const token    = url.searchParams.get('token');

  if (!email || !voter || !decision || !token) {
    return htmlPage('Missing parameters', 'Invalid link — some parameters are missing.', '#ff3b30');
  }
  if (!['maurin', 'marco'].includes(voter))       return htmlPage('Invalid voter', 'Unknown voter.', '#ff3b30');
  if (!['approve', 'reject'].includes(decision))  return htmlPage('Invalid decision', 'Unknown decision.', '#ff3b30');

  // Fetch contact from Brevo
  const contactRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    headers: { 'api-key': env.BREVO_API_KEY },
  });
  if (!contactRes.ok) return htmlPage('Not found', 'Could not find this applicant.', '#ff3b30');

  const contact = await contactRes.json();
  const attrs   = contact.attributes || {};

  // Validate token
  if (attrs.VOTE_TOKEN !== token) {
    return htmlPage('Invalid link', 'This link is no longer valid.', '#ff3b30');
  }

  // Check if already voted
  const existingVote = voter === 'maurin' ? attrs.VOTE_MAURIN : attrs.VOTE_MARCO;
  if (existingVote) {
    return htmlPage('Already voted', `You already voted to ${existingVote} this applicant.`, '#8e8e93');
  }

  // Record vote
  const voteAttr = voter === 'maurin' ? 'VOTE_MAURIN' : 'VOTE_MARCO';
  await brevoUpdateContact(env, email, { [voteAttr]: decision });

  // Check if both have voted
  const voteMaurin = voter === 'maurin' ? decision : attrs.VOTE_MAURIN;
  const voteMarco  = voter === 'marco'  ? decision : attrs.VOTE_MARCO;
  const applicantName = `${attrs.FIRSTNAME || ''} ${attrs.LASTNAME || ''}`.trim() || email;

  if (voteMaurin && voteMarco) {
    await resolveOutcome(env, email, applicantName, attrs, voteMaurin, voteMarco);
  } else {
    const voterLabel = voter === 'maurin' ? 'Maurin' : 'Marco';
    const otherLabel = voter === 'maurin' ? 'Marco' : 'Maurin';
    await telegram(env, `🗳️ *Vote recorded*\n\n${voterLabel} voted to *${decision}* ${applicantName}.\nWaiting for ${otherLabel}'s vote.`);
  }

  const label = decision === 'approve' ? 'Approved' : 'Rejected';
  const color = decision === 'approve' ? '#34c759' : '#ff3b30';
  return htmlPage(label, `Your vote to ${decision} <strong>${applicantName}</strong> has been recorded. Waiting for the other vote if needed.`, color);
}

async function resolveOutcome(env, email, applicantName, attrs, voteMaurin, voteMarco) {
  if (voteMaurin === 'approve' && voteMarco === 'approve') {
    await brevoUpdateContact(env, email, { APPROVAL_STATUS_CATEGORY: STATUS_APPROVED });
    await telegram(env, `✅ *Approved* — ${applicantName}\n\nBoth Maurin and Marco approved. Sending welcome email.`);
    await sendTemplate(env, WELCOME_TEMPLATE_ID, email, applicantName);
    await brevoUpdateContact(env, email, { WELCOME_SENT: 'yes' });
    await sendTemplate(env, RSVP_TEMPLATE_ID, email, applicantName);

  } else if (voteMaurin === 'reject' && voteMarco === 'reject') {
    await brevoUpdateContact(env, email, { APPROVAL_STATUS_CATEGORY: STATUS_REJECTED });
    await telegram(env, `❌ *Rejected* — ${applicantName}\n\nBoth Maurin and Marco rejected. Sending rejection email.`);
    await sendTemplate(env, REJECTION_TEMPLATE_ID, email, applicantName);
    await brevoUpdateContact(env, email, { REJECTION_EMAIL_SENT: 'yes' });

  } else {
    await brevoUpdateContact(env, email, { APPROVAL_STATUS_CATEGORY: STATUS_REVIEW });
    await telegram(env, `⚠️ *Split vote* — ${applicantName}\n\nMaurin: ${voteMaurin} / Marco: ${voteMarco}.\nNeeds manual review.`);
    await sendReviewNotification(env, applicantName, email, voteMaurin, voteMarco);
  }
}

async function sendReviewNotification(env, applicantName, applicantEmail, voteMaurin, voteMarco) {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;">
<div style="width:100%;background:#f5f5f7;padding:24px 0;">
  <div style="width:600px;max-width:100%;margin:0 auto;">
    <div style="background:#fff;border-radius:16px;border-top:4px solid #ff9500;padding:36px 32px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#ff9500;">ZRH Field Robotics Leads</div>
      <div style="font-size:26px;font-weight:700;color:#1d1d1f;margin-top:8px;">Split vote — needs discussion</div>
    </div>
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;">You two disagreed on <strong>${applicantName}</strong> (${applicantEmail}).</p>
      <p style="margin:0 0 16px;font-size:15px;color:#1d1d1f;">Maurin voted to <strong>${voteMaurin}</strong>, Marco voted to <strong>${voteMarco}</strong>.</p>
      <p style="margin:0;font-size:15px;color:#6e6e73;">Have a quick chat and update the approval status manually in Brevo.</p>
    </div>
  </div>
</div>
</body></html>`;

  await Promise.all([
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'ZRH Field Robotics Leads', email: MAURIN_EMAIL },
        to: [{ email: MAURIN_EMAIL, name: 'Maurin' }],
        subject: `Split vote on ${applicantName} — needs discussion`,
        htmlContent: html,
      }),
    }),
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'ZRH Field Robotics Leads', email: MAURIN_EMAIL },
        to: [{ email: MARCO_EMAIL, name: 'Marco' }],
        subject: `Split vote on ${applicantName} — needs discussion`,
        htmlContent: html,
      }),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// /rsvp — one-click event confirmation
// ---------------------------------------------------------------------------
async function handleRsvp(request, env, url) {
  const email = url.searchParams.get('email');
  if (!email) return new Response('Missing email', { status: 400 });

  const contactRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    headers: { 'api-key': env.BREVO_API_KEY },
  });
  let firstName = '', lastName = '';
  if (contactRes.ok) {
    const c = await contactRes.json();
    firstName = c.attributes?.FIRSTNAME || '';
    lastName  = c.attributes?.LASTNAME  || '';
  }

  await brevoUpdateContact(env, email, { RSVP_JUNE11: 'yes' });

  const name = [firstName, lastName].filter(Boolean).join(' ') || email;
  await telegram(env, `✅ *RSVP — June 11th*\n\n*${name}* (${email}) is coming!`);

  const greeting = firstName ? `See you there, ${firstName}!` : 'See you there!';
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0a;color:#f2f2f2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px}.card{background:#141414;border:1px solid #242424;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:24px}h1{font-size:26px;font-weight:600;margin-bottom:12px}p{font-size:15px;line-height:1.7;color:#777}.detail{margin-top:28px;background:#111;border:1px solid #222;border-radius:12px;padding:16px 20px;text-align:left}.row{display:flex;gap:10px;font-size:14px;color:#bbb;margin-bottom:8px}.row:last-child{margin-bottom:0}.row strong{color:#f2f2f2;min-width:60px}</style>
</head>
<body>
  <div class="card">
    <div class="icon">🤖</div>
    <h1>${greeting}</h1>
    <p>You're confirmed for June 11th. Marco and Maurin are looking forward to it.</p>
    <div class="detail">
      <div class="row"><strong>When</strong> Thursday, 11 June · 18:30</div>
      <div class="row"><strong>Where</strong> TBD — location coming soon</div>
    </div>
  </div>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', ...CORS_HEADERS } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function sendTemplate(env, templateId, email, name) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, to: [{ email, name }] }),
  });
}

async function brevoUpdateContact(env, email, attributes) {
  return fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes }),
  });
}

async function telegram(env, text) {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'Markdown' }),
  });
}

function htmlPage(title, body, color = '#0071e3') {
  return new Response(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0a;color:#f2f2f2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px}.card{background:#141414;border:1px solid #242424;border-radius:16px;border-top:4px solid ${color};padding:48px 40px;max-width:440px;width:100%;text-align:center}h1{font-size:24px;font-weight:600;margin-bottom:12px}p{font-size:15px;line-height:1.7;color:#777}</style>
</head>
<body>
  <div class="card"><h1>${title}</h1><p>${body}</p></div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
