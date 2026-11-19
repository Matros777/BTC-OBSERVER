import { getTicker } from "../_lib/binance.js";
import { etfSummary } from "../_lib/etf.js";
import { getEtfDataset } from "../_lib/etf-live.js";

const json = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });

export async function onRequestGet({ request, env }) {
  try {
    const [ticker, etf] = await Promise.all([
      getTicker(),
      getEtfDataset(env, request),
    ]);
    const price = Number(ticker.lastPrice || 0);
    const body = etfSummary(price, 10, etf.dataset);
    body.source = etf.source;
    body.upstreamUpdatedAt = etf.updatedAt;

    // Save last-good snapshot to KV (survives upstream outages)
    if (env && env.CACHE) {
      try {
        const payload = { ...body, fetchedAt: Date.now() };
        await env.CACHE.put("etf:lastgood", JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 days
      } catch { /* ignore KV errors */ }
    }

    return json(body);
  } catch (err) {
    // Fallback to last-good snapshot from KV
    if (env && env.CACHE) {
      try {
        const cached = await env.CACHE.get("etf:lastgood", "json");
        if (cached && cached.fetchedAt) {
          return json(
            { ...cached, stale: true, staleSince: new Date(cached.fetchedAt).toISOString() },
            200,
            { "Cache-Control": "no-store" }
          );
        }
      } catch { /* ignore */ }
    }
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
