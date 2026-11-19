import { onRequestGet as market } from "./functions/api/market.js";
import { onRequestGet as etf } from "./functions/api/etf.js";
import { onRequestGet as klines } from "./functions/api/klines.js";
import { onRequestGet as ticker } from "./functions/api/ticker.js";
import { handleMcpRequest } from "./functions/_lib/mcp.js";
import { readEtfLastGood } from "./functions/_lib/lastgood.js";

// Security headers (applied to all JSON responses)
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// CSP: inline theme script in index.html, hash computed 2026-11-19:
//   sed -n '/<script>/,/<\/script>/p' static/index.html | sed '1d;$d' | openssl dgst -sha256 -binary | openssl base64
// Re-run this when the inline script changes. JSON-LD blocks are non-scriptable and unrestricted.
const CSP_HASH = "sha256-qXQVcdoONNpVsRmJaJ77sR9hVKEBdwAec0xkyXw+7sw=";

const CSP =
  `default-src 'self'; ` +
  `script-src 'self' '${CSP_HASH}'; ` +
  `style-src 'self' 'unsafe-inline'; ` + // dynamic chart styles
  `img-src 'self' data: blob:; ` +
  `connect-src 'self'; ` +
  `frame-ancestors 'none'; base-uri 'self'; form-action 'none'`;

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
  try {
    const lg = await readEtfLastGood();
    if (lg && lg.fetchedAt) etfLastGoodAgeSec = Math.floor((Date.now() - lg.fetchedAt) / 1000);
  } catch { /* ignore */ }

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
