// Upstream ETF flows for the Worker.
//
// Source: the public MCP endpoint of cryptoetf.today (no account, no API key,
// 60 requests/min per IP). farside itself is unusable from any datacenter IP:
// Cloudflare serves its challenge to Workers, GitHub runners and plain curl.
//
// The MCP reply is SSE ("data: {...}"), and the tool result is a JSON string
// with the last 30 days: { days: [{ date, totalUsdM, funds: [...] }] }.
// Values match farside (2026-11-16 total 7.9, IBIT 76.5, FBTC -11.3).

const MCP_URL = "https://mcp.cryptoetf.today/api/mcp";
const TOOL = "get_fund_flows";
const TTL = 6 * 3600; // flows are published once per business day
const CACHE_KEY = "https://btc-observer-cache.local/etf-upstream-v3";

const asNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Flows lag one business day. While the newest day is still missing, poll often
// to pick it up shortly after publication; otherwise keep the 6h cache.
function cacheTtl(days) {
  const newest = Object.keys(days).sort().pop();
  if (!newest) return 1800;
  const lagDays = (Date.now() - Date.parse(newest + "T00:00:00Z")) / 86400000;
  return lagDays > 1.6 ? 1800 : TTL;
}

function mapDays(inner) {
  const days = {};
  for (const day of (inner && inner.days) || []) {
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
  return days;
}

function parseSsePayload(text) {
  const lines = String(text).split("\n").filter((l) => l.startsWith("data:"));
  if (!lines.length) throw new Error("MCP reply without data events");
  return JSON.parse(lines[lines.length - 1].slice(5).trim());
}

/** Returns { updated, days } — throws when the upstream is unreachable. */
export async function fetchUpstreamDays() {
  const hasCache = typeof caches !== "undefined" && caches.default;
  const cacheKey = new Request(CACHE_KEY);
  if (hasCache) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit.json();
  }

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "btc-observer/1.0",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: TOOL, arguments: { asset: "btc" } },
    }),
  });
  if (!res.ok) throw new Error(`cryptoetf.today MCP HTTP ${res.status}`);

  const rpc = parseSsePayload(await res.text());
  if (rpc.error) throw new Error(`cryptoetf.today MCP error: ${rpc.error.message || "unknown"}`);
  const content = rpc.result && Array.isArray(rpc.result.content) ? rpc.result.content[0] : null;
  if (!content || typeof content.text !== "string") throw new Error("unexpected MCP tool result");

  const days = mapDays(JSON.parse(content.text));
  if (!Object.keys(days).length) throw new Error("cryptoetf.today returned no flow days");

  const payload = { updated: null, days };
  if (hasCache) {
    const ttl = cacheTtl(days);
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
      })
    );
  }
  return payload;
}
