import { getTicker } from "../_lib/binance.js";
import { etfSummary } from "../_lib/etf.js";
import { getEtfDataset } from "../_lib/etf-live.js";
import { saveEtfLastGood, readEtfLastGood } from "../_lib/lastgood.js";

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

    // Save last-good snapshot to the edge cache (survives upstream outages, 30d TTL)
    try {
      await saveEtfLastGood(body);
    } catch { /* best-effort */ }

    return json(body);
  } catch (err) {
    // Fallback to the last-good snapshot from the edge cache
    try {
      const cached = await readEtfLastGood();
      if (cached && cached.fetchedAt) {
        return json(
          { ...cached, stale: true, staleSince: new Date(cached.fetchedAt).toISOString() },
          200,
          { "Cache-Control": "no-store" }
        );
      }
    } catch { /* ignore */ }
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
