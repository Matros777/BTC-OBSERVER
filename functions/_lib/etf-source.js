// Upstream ETF flows for the Worker: cryptoetf.today (free key, 60 req/min,
// 30 days of history, fund-level breakdown). This is the only source reachable
// from Cloudflare — farside sits behind a challenge for every datacenter IP,
// including Workers and GitHub runners.
//
// The key lives in the ETF_API_KEY secret. Without it the dashboard silently
// falls back to the embedded seed + static/etf-live.json.

const API = "https://api.cryptoetf.today/api/v1/flows/btc/funds";
const TTL = 6 * 3600; // flows are published once per business day
const CACHE_KEY = "https://btc-observer-cache.local/etf-upstream-v1";

const asNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function mapPayload(payload) {
  const days = {};
  for (const day of (payload && payload.days) || []) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(day.date || ""))) continue;
    const total = asNum(day.totalUsdM);
    if (total === null) continue;
    const funds = Array.isArray(day.funds) ? day.funds : [];
    const pick = (ticker) => {
      const hit = funds.find((f) => String(f && f.ticker).toUpperCase() === ticker);
      return hit ? asNum(hit.netFlowUsdM) : null;
    };
    days[day.date] = { total, ibit: pick("IBIT"), fbtc: pick("FBTC"), src: "cryptoetf.today" };
  }
  return { updated: (payload && payload.updatedAt) || null, days };
}

/** Returns { updated, days } or null when the key is not configured. */
export async function fetchUpstreamDays(env) {
  const key = env && env.ETF_API_KEY;
  if (!key) return null;

  const hasCache = typeof caches !== "undefined" && caches.default;
  const cacheKey = new Request(CACHE_KEY);
  if (hasCache) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit.json();
  }

  const res = await fetch(API, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "User-Agent": "btc-observer/1.0",
    },
    cf: { cacheTtl: TTL, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`cryptoetf.today HTTP ${res.status}`);

  const mapped = mapPayload(await res.json());
  if (!Object.keys(mapped.days).length) throw new Error("cryptoetf.today returned no flow days");

  if (hasCache) {
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(mapped), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${TTL}`,
        },
      })
    );
  }
  return mapped;
}
