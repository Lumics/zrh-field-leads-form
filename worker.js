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

    const { email, firstName, lastName, company, role, linkedin, phone, why } = data;

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
        APPROVAL_STATUS: 'pending',
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
