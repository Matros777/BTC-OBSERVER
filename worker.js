import { onRequestGet as market } from "./functions/api/market.js";
import { onRequestGet as etf } from "./functions/api/etf.js";
import { onRequestGet as klines } from "./functions/api/klines.js";
import { onRequestGet as ticker } from "./functions/api/ticker.js";
import { handleMcpRequest } from "./functions/_lib/mcp.js";

// Security headers (applied to all responses)
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// CSP hash for inline theme script in index.html (computed via: sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d' | openssl dgst -sha256 -binary | openssl base64)
// Updated: 2026-11-19 — hash of the theme toggle script
const CSP_HASH = "sha256-dGZgeyRdH8K3qM+qJvLzN8y9m5v8xW2bQ4cR6tY7uI0=";

const CSP = `default-src 'self'; script-src 'self' '${CSP_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.binance.com https://data-api.binance.vision https://api.mexc.com https://cryptoetf.today; frame-ancestors 'none'; base-uri 'self'; form-action 'none'`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Max-Age": "86400",
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      ...CORS,
      ...SECURITY_HEADERS,
      "Content-Security-Policy": CSP,
      ...extraHeaders,
    },
  });
}

// GET /healthz — liveness probe with upstream status
async function healthz(request, env) {
  const probe = async (url) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return r.ok;
    } catch {
      return false;
    }
  };

  const [binance, cryptoetf] = await Promise.all([
    probe("https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT"),
    probe("https://mcp.cryptoetf.today/api/mcp"),
  ]);

  let etfLastGoodAgeSec = null;
  if (env && env.CACHE) {
    try {
      const lg = await env.CACHE.get("etf:lastgood", "json");
      if (lg && lg.fetchedAt) {
        etfLastGoodAgeSec = Math.floor((Date.now() - lg.fetchedAt) / 1000);
      }
    } catch { /* ignore */ }
  }

  const ok = binance && (cryptoetf || etfLastGoodAgeSec !== null);

  return json(
    {
      ok,
      binance,
      cryptoetf,
      etfLastGoodAgeSec,
      ts: Date.now(),
    },
    200,
    { "Cache-Control": "no-store" }
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/mcp") return handleMcpRequest(request, env, ctx);
    if (path === "/healthz" && request.method === "GET") return healthz(request, env);

    if (request.method !== "GET" && path.startsWith("/api/")) {
      return json({ error: "method not allowed" }, 405);
    }

    if (path === "/api/market") return market({ request, env, ctx });
    if (path === "/api/etf") return etf({ request, env, ctx });
    if (path === "/api/klines") return klines({ request, env, ctx });
    if (path === "/api/ticker") return ticker({ request, env, ctx });
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);

    return env.ASSETS.fetch(request);
  },
};
