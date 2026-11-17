import { getKlines } from "../_lib/binance.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const interval = url.searchParams.get("interval") || "1h";
    const limit = Math.max(10, Math.min(Number(url.searchParams.get("limit") || 500), 1000));
    return json({ symbol: "BTCUSDT", interval, klines: await getKlines(interval, limit) });
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
