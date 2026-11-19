// BTC Observer — MCP (Model Context Protocol) server, streamable HTTP.
// Exposes dashboard data as tools so an agent can pull everything in one call.
//
// Protocol: JSON-RPC 2.0 over POST /mcp (MCP 2025-06-18, "streamable HTTP").
// Stateless: no sessions, no SSE stream — POST-only clients are fully supported.
//
// Optional auth: set the MCP_API_KEY secret on the worker; then every request
// must carry `Authorization: Bearer <key>` or `X-API-Key: <key>`.

import { onRequestGet as marketHandler } from "../api/market.js";
import { onRequestGet as etfHandler } from "../api/etf.js";
import { onRequestGet as klinesHandler } from "../api/klines.js";
import { onRequestGet as tickerHandler } from "../api/ticker.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "btc-observer", title: "BTC Observer", version: "1.0.0" };

const ALLOWED_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

const TOOLS = [
  {
    name: "btc_report",
    description:
      "Full BTC market snapshot in a single call: price, 24h ticker, all technical indicators, " +
      "21 weighted signals, composite signal, EMA cross state, 24h Monte Carlo forecast, " +
      "key levels (fibonacci, pivots, swing highs/lows, support/resistance), BTC ETF flows 2W " +
      "(net, daily breakdown, IBIT/FBTC, pressure, score) and the long-term daily signal. " +
      "Data: Binance-compatible public API + cryptoetf.today.",
    inputSchema: {
      type: "object",
      properties: {
        include_chart: {
          type: "boolean",
          description: "Include the last 240 hourly candles with indicator series (large payload). Default false.",
        },
        include_daily: {
          type: "boolean",
          description: "Include per-day ETF flow rows (default true).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "btc_price",
    description: "Current BTC/USDT price and 24h ticker: change, high/low, base and quote volume, trade count.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "btc_etf",
    description:
      "Spot BTC ETF net flows over the last 10 trading days (cryptoetf.today): net total, inflows/outflows, " +
      "green/red days, IBIT and FBTC breakdown, pressure, WoW, score and verdict.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "btc_klines",
    description: "Raw BTC/USDT OHLCV klines (open/high/low/close/volume) with millisecond timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        interval: {
          type: "string",
          enum: ALLOWED_INTERVALS,
          description: "Candle interval. Default 1h.",
        },
        limit: {
          type: "integer",
          minimum: 10,
          maximum: 1000,
          description: "Number of candles, 10-1000. Default 100.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "btc_forecast",
    description:
      "24h Monte Carlo GBM forecast: median target, P10/P90 range, probability of going up, confidence — " +
      "plus the composite signal and EMA cross as context.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function baseHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    ...CORS,
  };
}

function mcpResp(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: baseHeaders() });
}

function authOk(request, env) {
  const key = env && env.MCP_API_KEY;
  if (!key) return true;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  return bearer === key || request.headers.get("X-API-Key") === key;
}

// Run an existing GET handler with a synthetic request (same origin, optional query)
// and return its parsed JSON body.
async function run(handler, request, env, ctx, query = "") {
  const u = new URL(request.url);
  const target = `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
  const res = await handler({ request: new Request(target, { method: "GET" }), env, ctx });
  const data = await res.json();
  if (!res.ok || (data && data.error)) throw new Error((data && data.error) || `upstream HTTP ${res.status}`);
  return data;
}

function okTool(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function dispatch(name, args, request, env, ctx) {
  try {
    switch (name) {
      case "btc_report": {
        const data = await run(marketHandler, request, env, ctx);
        if (!args.include_chart) delete data.chart;
        if (args.include_daily === false && data.etf) delete data.etf.daily;
        return okTool(data);
      }
      case "btc_price":
        return okTool(await run(tickerHandler, request, env, ctx));
      case "btc_etf":
        return okTool(await run(etfHandler, request, env, ctx));
      case "btc_klines": {
        const interval = ALLOWED_INTERVALS.includes(args.interval) ? args.interval : "1h";
        const limit = Math.min(Math.max(Math.round(Number(args.limit) || 100), 10), 1000);
        return okTool(await run(klinesHandler, request, env, ctx, `interval=${interval}&limit=${limit}`));
      }
      case "btc_forecast": {
        const data = await run(marketHandler, request, env, ctx);
        return okTool({
          symbol: data.symbol,
          price: data.price,
          composite: data.composite,
          emaCross: data.emaCross,
          prediction: data.prediction,
        });
      }
      default:
        return {
          content: [{ type: "text", text: `unknown tool: ${String(name)}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: String((err && err.message) || err) }) }],
      isError: true,
    };
  }
}

export async function handleMcpRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/mcp") return mcpResp({ error: "not found" }, 404);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // GET: no SSE stream is offered by this server → 405 per the MCP spec.
  if (request.method === "GET") {
    return new Response("method not allowed", { status: 405, headers: { ...baseHeaders(), Allow: "POST, OPTIONS" } });
  }

  if (request.method !== "POST") {
    return mcpResp({ error: "method not allowed" }, 405);
  }

  if (!authOk(request, env)) {
    return mcpResp({ error: "unauthorized" }, 401);
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return mcpResp({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
  }

  if (Array.isArray(msg)) {
    return mcpResp({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch requests not supported" } }, 400);
  }

  const id = msg && msg.id;
  const method = msg && msg.method;
  const params = (msg && msg.params) || {};

  if (typeof method !== "string") {
    return mcpResp({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "invalid request" } });
  }

  // Notifications (e.g. notifications/initialized) get an empty 202.
  if (method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: baseHeaders() });
  }

  switch (method) {
    case "initialize":
      return mcpResp({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "BTC market data (Binance-compatible public API) + spot BTC ETF flows (cryptoetf.today). " +
            "Use btc_report for the full one-call market snapshot; it is not financial advice.",
        },
      });
    case "tools/list":
      return mcpResp({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    case "tools/call":
      return mcpResp({ jsonrpc: "2.0", id, result: await dispatch(params.name, params.arguments || {}, request, env, ctx) });
    default:
      return mcpResp({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  }
}
