import { getTicker } from "../_lib/binance.js";

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
    return json(await getTicker());
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
