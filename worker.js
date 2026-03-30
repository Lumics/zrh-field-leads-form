// Cloudflare Worker — ZRH Field Leads form proxy
// Deploy with: wrangler deploy
// Set secret: wrangler secret put BREVO_API_KEY
//
// This keeps the Brevo API key server-side, out of the public HTML.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

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

    // Forward to Brevo
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
        APPROVAL_STATUS_CATEGORY: 1,          // 1=Pending, 2=Approved, 3=Rejected (integer required)
        NEWSLETTER: newsletter !== false ? 'yes' : 'no',
      },
      // List 3 = ZRH Robotic Field Leads (always added)
      // If newsletter opted in, also add to list 3 (same list for now — separate newsletter list can be created later)
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
      // Notify Maurin via Telegram
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
        body: JSON.stringify({
          chat_id: '1597503772',
          text: msg,
          parse_mode: 'Markdown',
        }),
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
};
