import { getTicker } from "../_lib/binance.js";
import { etfSummary } from "../_lib/etf.js";
import { getEtfDataset } from "../_lib/etf-live.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
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
    return json(body);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
