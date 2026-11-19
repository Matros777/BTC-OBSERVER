// Local smoke test for the /mcp endpoint without deploying.
// env.ASSETS is stubbed: etf-live.json is pulled from the deployed site,
// klines/ticker hit the public market APIs directly.
//
//   node scripts/mcp_test.mjs

import { handleMcpRequest } from "../functions/_lib/mcp.js";

const LIVE = "https://btc-observer.ivanbenks7-e96.workers.dev";

const env = {
  ASSETS: {
    async fetch(url) {
      const res = await fetch(`${LIVE}${new URL(url).pathname}`);
      return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
    },
  },
};

async function rpc(body, headers = {}) {
  const req = new Request(`${LIVE}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const res = await handleMcpRequest(req, env, {});
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const results = [];
const step = (label, cond, extra = "") => results.push([label, cond ? "OK" : "FAIL", extra]);

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-test", version: "0" } },
});
step("initialize", init.status === 200 && init.json?.result?.serverInfo?.name === "btc-observer",
  `proto=${init.json?.result?.protocolVersion}`);

await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const names = (list.json?.result?.tools || []).map((t) => t.name);
step("tools/list", names.length === 5, names.join(","));

for (const [name, args] of [
  ["btc_price", {}],
  ["btc_etf", {}],
  ["btc_forecast", {}],
  ["btc_klines", { interval: "1h", limit: 50 }],
  ["btc_report", {}],
]) {
  const t = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name, arguments: args } });
  const payload = t.json?.result?.content?.[0]?.text;
  let data = null;
  try { data = JSON.parse(payload); } catch { /* not JSON */ }
  const bad = t.json?.result?.isError || (data && data.error);
  step(`tools/call ${name}`, t.status === 200 && !bad, bad ? String(bad) : `${payload ? payload.length : 0} bytes`);
  if (name === "btc_report" && data) {
    step("report shape",
      ["price", "ticker", "indicators", "signals", "composite", "emaCross", "prediction", "levels", "etf", "longTerm"]
        .every((k) => data[k] !== undefined),
      Object.keys(data).join(","));
    step("report has no chart by default", data.chart === undefined);
    step("report has schemaVersion", data.schemaVersion === 1);
  }
}

// Validation tests (P0 #1)
const badKlines1 = await rpc({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "btc_klines", arguments: { interval: "2h", limit: 100 } } });
step("btc_klines interval=2h → -32602", badKlines1.json?.error?.code === -32602, `code=${badKlines1.json?.error?.code}`);

const badKlines2 = await rpc({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "btc_klines", arguments: { interval: "1h", limit: 9 } } });
step("btc_klines limit=9 → -32602", badKlines2.json?.error?.code === -32602, `code=${badKlines2.json?.error?.code}`);

const badKlines3 = await rpc({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "btc_klines", arguments: { interval: "1h", limit: 1001 } } });
step("btc_klines limit=1001 → -32602", badKlines3.json?.error?.code === -32602, `code=${badKlines3.json?.error?.code}`);

for (const [label, status, extra] of results) {
  console.log(`${status === "OK" ? "  PASS" : "  FAIL"}  ${label}${extra ? " — " + extra : ""}`);
}
const failed = results.filter(([, s]) => s !== "OK").length;
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
