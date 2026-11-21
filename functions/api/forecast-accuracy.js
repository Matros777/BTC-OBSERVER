import { scoreboardData } from "../_lib/forecast-store.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: "D1 binding (DB) is not configured" }, 503);
  try {
    const data = await scoreboardData(env.DB);
    return json({ ok: true, ...data });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
