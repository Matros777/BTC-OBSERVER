import { getTicker } from "../_lib/binance.js";
import { etfSummary } from "../_lib/etf.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });

export async function onRequestGet() {
  try {
    const ticker = await getTicker();
    const price = Number(ticker.lastPrice || 0);
    return json(etfSummary(price));
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
