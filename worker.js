// Cloudflare Worker — ZRH Field Leads form proxy
// Deploy with: wrangler deploy
// Set secret: wrangler secret put BREVO_API_KEY

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/rsvp') {
      return handleRsvp(request, env, url);
    }

    if (url.pathname === '/submit') {
      return handleSubmit(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleRsvp(request, env, url) {
  const email = url.searchParams.get('email');
  if (!email) {
    return new Response('Missing email', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  // Look up contact name in Brevo
  let firstName = '';
  let lastName = '';
  const contactRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    headers: { 'api-key': env.BREVO_API_KEY }
  });
  if (contactRes.ok) {
    const contact = await contactRes.json();
    firstName = contact.attributes?.FIRSTNAME || '';
    lastName  = contact.attributes?.LASTNAME  || '';
  }

  // Notify via Telegram
  const name = [firstName, lastName].filter(Boolean).join(' ') || email;
  const msg = `✅ *RSVP — June 11th Meetup*\n\n*${name}* (${email}) is coming!`;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: '1597503772', text: msg, parse_mode: 'Markdown' }),
  });

  const greeting = firstName ? `See you there, ${firstName}!` : 'See you there!';
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You're in — ZRH Field Robotics Leads</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0a0a;color:#f2f2f2;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;-webkit-font-smoothing:antialiased}
  .card{background:#141414;border:1px solid #242424;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center}
  .icon{font-size:48px;margin-bottom:24px}
  h1{font-size:26px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px}
  p{font-size:15px;line-height:1.7;color:#777}
  .detail{margin-top:28px;background:#111;border:1px solid #222;border-radius:12px;padding:16px 20px;text-align:left}
  .detail-row{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#bbb;margin-bottom:8px}
  .detail-row:last-child{margin-bottom:0}
  .detail-row strong{color:#f2f2f2;min-width:60px}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🤖</div>
    <h1>${greeting}</h1>
    <p>We've got you down for the June 11th meetup. Marco and Maurin are looking forward to it.</p>
    <div class="detail">
      <div class="detail-row"><strong>When</strong> Thursday, 11 June · 18:30</div>
      <div class="detail-row"><strong>Where</strong> TBD — we'll be in touch with the location</div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', ...CORS_HEADERS }
  });
}

async function handleSubmit(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  const { email, firstName, lastName, company, role, linkedin, phone, why, newsletter } = data;

  if (!email || !firstName || !lastName || !company || !role || !linkedin || !why) {
    return new Response(JSON.stringify({ message: 'Missing required fields' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  const brevoPayload = {
    email,
    attributes: {
      FIRSTNAME: firstName,
      LASTNAME: lastName,
      COMPANY: company,
      ROLE: role,
      LINKEDIN_URL: linkedin,
      PHONE: phone || '',
      WHY_JOIN: why,
      APPROVAL_STATUS_CATEGORY: 1,
      NEWSLETTER: newsletter !== false ? 'yes' : 'no',
    },
    listIds: [3],
    updateEnabled: true,
  };

  const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(brevoPayload),
  });

  if (brevoRes.ok || brevoRes.status === 204 || brevoRes.status === 201) {
    const msg = `🤖 *New application — Zurich Field Robotics Leads*\n\n` +
      `*${firstName} ${lastName}*\n` +
      `🏢 ${company} — ${role}\n` +
      `📧 ${email}\n` +
      (phone ? `📱 ${phone}\n` : ``) +
      `🔗 ${linkedin}\n\n` +
      `💬 _${why.substring(0, 200)}${why.length > 200 ? '...' : ''}_\n\n` +
      `Newsletter: ${newsletter !== false ? 'yes' : 'no'}\n\n` +
      `→ Approve in Brevo: https://app.brevo.com/contact/list`;

    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '1597503772', text: msg, parse_mode: 'Markdown' }),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  } else {
    const err = await brevoRes.json();
    return new Response(JSON.stringify({ message: err.message || 'Brevo error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}
