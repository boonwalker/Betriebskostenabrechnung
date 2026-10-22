/**
 * ImmoFriend-Proxy für die Belegerkennung (Cloudflare Worker).
 *
 * Die öffentliche App kennt keinen API-Schlüssel. Sie schickt ihre Anfrage mit einem Einladungscode hierher;
 * der Worker prüft Code, Herkunft und Anfrage, setzt den geheimen Anthropic-Schlüssel ein und reicht die
 * Antwort (auch als Stream) unverändert zurück.
 *
 * Geheimnisse (wrangler secret put …):
 *   ANTHROPIC_API_KEY  – dein Schlüssel aus console.anthropic.com
 *   INVITE_CODES       – erlaubte Codes, durch Komma getrennt (z. B. ein Code je Freund, einzeln widerrufbar)
 * Variablen (wrangler.toml):
 *   ALLOWED_ORIGINS    – Adressen, von denen die App aufgerufen werden darf, durch Komma getrennt
 *   DAILY_LIMIT        – höchstens so viele Auslesungen je Code und Tag (nur mit KV-Bindung USAGE)
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ALLOWED_MODELS = ["claude-opus-5-5"];
const MAX_TOKENS = 64000;
const MAX_BODY_BYTES = 30 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = originOk
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") ?? "content-type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : {};

    if (request.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });

    const fail = (status, type, message) =>
      new Response(JSON.stringify({ type: "error", error: { type, message } }), {
        status,
        // Kein automatischer Neuversuch durch das SDK – an diesen Fehlern ändert Warten nichts
        headers: { ...cors, "content-type": "application/json", "x-should-retry": "false" },
      });

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/messages") return fail(404, "not_found_error", "Unbekannte Adresse.");
    if (!originOk) return fail(403, "permission_error", "Aufruf nur aus der ImmoFriend-App erlaubt.");

    const code = (request.headers.get("x-immofriend-code") ?? "").trim();
    const codes = (env.INVITE_CODES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!code || !codes.includes(code)) return fail(401, "authentication_error", "Der Einladungscode ist ungültig. Bitte in den Einstellungen prüfen.");

    const size = Number(request.headers.get("content-length") ?? 0);
    if (size > MAX_BODY_BYTES) return fail(413, "request_too_large", "Die Dateien sind zu groß (höchstens 30 MB auf einmal).");

    let body;
    try {
      body = await request.json();
    } catch {
      return fail(400, "invalid_request_error", "Ungültige Anfrage.");
    }
    // Nur die Belegerkennung der App: festes Modell, begrenzte Länge, keine Werkzeuge
    if (!ALLOWED_MODELS.includes(body.model)) return fail(400, "invalid_request_error", "Dieses Modell ist über den Einladungscode nicht freigegeben.");
    if (!(body.max_tokens > 0 && body.max_tokens <= MAX_TOKENS)) return fail(400, "invalid_request_error", "max_tokens außerhalb des erlaubten Bereichs.");
    for (const field of ["tools", "tool_choice", "mcp_servers", "container", "speed"]) {
      if (body[field] !== undefined) return fail(400, "invalid_request_error", `„${field}“ ist über den Einladungscode nicht erlaubt.`);
    }

    // Tageslimit je Code (KV ist nur ungefähr konsistent – als Bremse reicht das)
    if (env.USAGE) {
      const limit = Number(env.DAILY_LIMIT ?? 30);
      const key = `${new Date().toISOString().slice(0, 10)}:${code}`;
      const used = Number((await env.USAGE.get(key)) ?? 0);
      if (used >= limit) return fail(429, "rate_limit_error", `Tageslimit von ${limit} Auslesungen erreicht – morgen geht es weiter.`);
      await env.USAGE.put(key, String(used + 1), { expirationTtl: 3 * 86400 });
    }

    const headers = {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": request.headers.get("anthropic-version") ?? "2023-06-01",
    };
    const beta = request.headers.get("anthropic-beta");
    if (beta) headers["anthropic-beta"] = beta;

    const upstream = await fetch(ANTHROPIC_URL + url.search, { method: "POST", headers, body: JSON.stringify(body) });
    const out = new Headers(cors);
    for (const h of ["content-type", "request-id", "retry-after", "x-should-retry"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    // Ein Fehler beim Schlüssel des Betreibers ist nicht der Fehler deiner Freunde
    if (upstream.status === 401 || upstream.status === 403) return fail(502, "api_error", "Die Belegerkennung ist gerade nicht verfügbar. Bitte dem Betreiber Bescheid geben.");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
