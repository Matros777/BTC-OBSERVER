import { getKlines, getTicker } from "../_lib/binance.js";
import { analyze, analyzeLongTerm } from "../_lib/analysis.js";
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
    const [klines, ticker, etfDataset] = await Promise.all([
      getKlines("1h", 500),
      getTicker(),
      getEtfDataset(env, request),
    ]);
    const data = analyze(klines, ticker);
    data.etf = etfSummary(data.price, 10, etfDataset);
    try {
      data.longTerm = analyzeLongTerm(await getKlines("1d", 250));
    } catch {
      data.longTerm = {
        score: 0,
        label: "NEUTRAL",
        confidence: 0,
        details: {},
        signals: [],
      };
    }
    return json(data);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 502);
  }
}
