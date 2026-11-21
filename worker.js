import { onRequestGet as market } from "./functions/api/market.js";
import { onRequestGet as etf } from "./functions/api/etf.js";
import { onRequestGet as klines } from "./functions/api/klines.js";
import { onRequestGet as ticker } from "./functions/api/ticker.js";
import { onRequestGet as forecastAccuracy } from "./functions/api/forecast-accuracy.js";
import { runForecastJob, bootstrapToday } from "./functions/_lib/forecast-job.js";
import { handleMcpRequest } from "./functions/_lib/mcp.js";
import { readEtfLastGood } from "./functions/_lib/lastgood.js";
import { fetchUpstreamDays } from "./functions/_lib/etf-source.js";

// Security headers (applied to all JSON responses)
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// CSP: inline theme script in index.html, hash computed 2026-11-19:
//   python3 -c "import pathlib,hashlib,base64; h=pathlib.Path('static/index.html').read_text();
//     s=h.split('<script>',1)[1].split('</script>',1)[0];
//     print(base64.b64encode(hashlib.sha256(s.encode()).digest()).decode())"
//   (the browser hashes the raw element text INCLUDING the leading newline after <script>;
//    the old sed pipeline dropped it and produced a hash the browser never matches)
// Re-run this when the inline script changes. JSON-LD blocks are non-scriptable and unrestricted.
const CSP_HASH = "sha256-vtJgGBTE5WiExEKYQ31ljw8T9R8bMg2oiYek9TwNVoc=";

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

  // cryptoetf probe: run the real pipeline (6h edge cache → no quota burn when cached)
  let cryptoetf = false;
  try {
    await fetchUpstreamDays();
    cryptoetf = true;
  } catch { /* upstream unreachable */ }

  const [binance] = await Promise.all([
    probe("https://api.mexc.com/api/v3/ticker/price?symbol=BTCUSDT"),
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
  // Daily forecast self-audit: snapshot at 09:00 UTC, verify the day before.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runForecastJob(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/mcp") return handleMcpRequest(request, env, ctx);
    if (path === "/healthz" && request.method === "GET") return healthz(request, env);

    if (request.method !== "GET" && path.startsWith("/api/")) {
      return json({ error: "method not allowed" }, 405);
    }

    if (path === "/api/market") {
      // Lazy bootstrap: if today's snapshot is missing, run the job in the background.
      ctx.waitUntil(bootstrapToday(env).catch(() => {}));
      return market({ request, env, ctx });
    }
    if (path === "/api/etf") return etf({ request, env, ctx });
    if (path === "/api/klines") return klines({ request, env, ctx });
    if (path === "/api/ticker") return ticker({ request, env, ctx });
    if (path === "/api/forecast-accuracy") return forecastAccuracy({ request, env, ctx });
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);

    // Static assets: re-emit with security + CSP headers (ASSETS binding does not set them)
    const asset = await env.ASSETS.fetch(request);
    if (!asset) return json({ error: "not found" }, 404);
    const headers = new Headers(asset.headers);
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Frame-Options", "DENY");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};
