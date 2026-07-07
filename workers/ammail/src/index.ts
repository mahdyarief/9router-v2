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
    if (path.startsWith("/api")) {
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
    // GET /api/health
    if (path === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", version: "1.0" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api - info
    if (path === "/api") {
      const domains = await env.DB.prepare("SELECT DISTINCT domain FROM emails").all();
      return new Response(JSON.stringify({ 
        domains: domains.results.map((d: any) => d.domain),
        version: "1.0"
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/inboxes - create inbox
    if (path === "/api/inboxes" && request.method === "POST") {
      const body = await request.json();
      const { alias, domain } = body;
      const email = `${alias}@${domain}`;
      
      await env.DB.prepare(
        "INSERT OR IGNORE INTO inboxes (email, alias, domain, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(email, alias, domain, Date.now())
        .run();

      // Return nested structure for backend compatibility
      return new Response(JSON.stringify({ 
        inbox: { email, alias, domain, address: email },
        ok: true 
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/inboxes - list inboxes
    if (path === "/api/inboxes" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM inboxes ORDER BY created_at DESC"
      ).all();
      // Map email to address for frontend compatibility
      const inboxes = results.map((r: any) => ({ ...r, address: r.email }));
      return new Response(JSON.stringify({ inboxes }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // DELETE /api/inboxes/:alias
    if (path.startsWith("/api/inboxes/") && request.method === "DELETE") {
      const alias = path.substring(13);
      await env.DB.prepare("DELETE FROM inboxes WHERE alias = ?").bind(alias).run();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/inboxes/:alias/messages
    if (path.includes("/messages") && request.method === "GET") {
      const parts = path.split("/");
      const alias = parts[2];
      const { results } = await env.DB.prepare(
        "SELECT * FROM emails WHERE to_email LIKE ? ORDER BY received_at DESC LIMIT 50"
      )
        .bind(`%@${alias}%`)
        .all();
      return new Response(JSON.stringify({ messages: results }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/messages/:messageId
    if (path.startsWith("/api/messages/") && request.method === "GET") {
      const id = path.substring(14);
      const { results } = await env.DB.prepare(
        "SELECT * FROM emails WHERE id = ?"
      )
        .bind(id)
        .all();
      
      if (results.length === 0) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(results[0]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // GET /api/webhook
    if (path === "/api/webhook" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM webhooks LIMIT 1"
      ).all();
      return new Response(JSON.stringify({ webhook: results[0] || null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // PUT /api/webhook
    if (path === "/api/webhook" && request.method === "PUT") {
      const body = await request.json();
      const { url, secret } = body;
      
      await env.DB.prepare(
        "INSERT OR REPLACE INTO webhooks (id, url, secret, created_at) VALUES (1, ?, ?, ?)"
      )
        .bind(url, secret, Date.now())
        .run();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/webhook/test
    if (path === "/api/webhook/test" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true, message: "Webhook test successful" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // DELETE /api/webhook
    if (path === "/api/webhook" && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM webhooks").run();
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
  const patterns = [
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
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

// Send Telegram notification
async function sendTelegramNotification(
  env: Env,
  to: string,
  from: string,
  subject: string,
  otp: string | null
): Promise<void> {
  const chatId = "-1001234567890";
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
