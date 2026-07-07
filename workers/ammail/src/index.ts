export interface Env {
  DB: D1Database;
  API_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle email receiving (Cloudflare Email Routing)
    if (request.method === "POST" && path === "/email") {
      return handleEmail(request, env);
    }

    // API endpoints
    if (path.startsWith("/api/")) {
      return handleAPI(request, env, path);
    }

    return new Response("Ammail Worker v1.0", { status: 200 });
  },
};

// Handle incoming email
async function handleEmail(request: Request, env: Env): Promise<Response> {
  try {
    const email = await request.json();
    const { from, to, subject, text, html } = email;

    // Extract OTP from email
    const otp = extractOTP(text || html || "");
    const domain = to.split("@")[1];

    // Store in database
    await env.DB.prepare(
      "INSERT INTO emails (to_email, from_email, subject, body, otp, domain, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(to, from, subject, text || html, otp, domain, Date.now())
      .run();

    // Send Telegram notification if configured
    if (env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramNotification(env, to, from, subject, otp);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Handle API requests
async function handleAPI(request: Request, env: Env, path: string): Promise<Response> {
  // Auth check
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== env.API_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // GET /api/otp/:email
    if (path.startsWith("/api/otp/")) {
      const email = decodeURIComponent(path.substring(9));
      const otp = await getLatestOTP(env, email);
      return new Response(JSON.stringify({ otp }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/emails
    if (path === "/api/emails") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM emails ORDER BY received_at DESC LIMIT 100"
      ).all();
      return new Response(JSON.stringify({ emails: results }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // DELETE /api/emails/:id
    if (path.startsWith("/api/emails/") && request.method === "DELETE") {
      const id = path.substring(12);
      await env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Extract OTP code from email body
function extractOTP(body: string): string | null {
  // Common OTP patterns
  const patterns = [
    /\b(\d{6})\b/, // 6 digits
    /\b(\d{4})\b/, // 4 digits
    /code[:\s]+(\d{6})/i,
    /otp[:\s]+(\d{6})/i,
    /verification[:\s]+(\d{6})/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Get latest OTP for email
async function getLatestOTP(env: Env, email: string): Promise<string | null> {
  const { results } = await env.DB.prepare(
    "SELECT otp FROM emails WHERE to_email = ? AND otp IS NOT NULL ORDER BY received_at DESC LIMIT 1"
  )
    .bind(email)
    .all();

  return results.length > 0 ? results[0].otp : null;
}

// Send Telegram notification
async function sendTelegramNotification(
  env: Env,
  to: string,
  from: string,
  subject: string,
  otp: string | null
): Promise<void> {
  const chatId = "-1001234567890"; // Replace with your chat ID
  const message = `📧 New Email\n\nTo: ${to}\nFrom: ${from}\nSubject: ${subject}${
    otp ? `\n\n🔑 OTP: ${otp}` : ""
  }`;

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });
}
