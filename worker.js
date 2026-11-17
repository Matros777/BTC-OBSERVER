import { onRequestGet as market } from "./functions/api/market.js";
import { onRequestGet as etf } from "./functions/api/etf.js";
import { onRequestGet as klines } from "./functions/api/klines.js";
import { onRequestGet as ticker } from "./functions/api/ticker.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && path.startsWith("/api/")) {
      return json({ error: "method not allowed" }, 405);
    }

    if (path === "/api/market") return market({ request, env, ctx });
    if (path === "/api/etf") return etf({ request, env, ctx });
    if (path === "/api/klines") return klines({ request, env, ctx });
    if (path === "/api/ticker") return ticker({ request, env, ctx });
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);

    return env.ASSETS.fetch(request);
  },
};
