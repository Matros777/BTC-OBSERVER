// Resolves the ETF dataset used by /api/etf and /api/market.
// Priority: upstream (cryptoetf.today) > committed live days > embedded seed.
import { mergeEtfDatasets } from "./etf.js";
import { fetchUpstreamDays } from "./etf-source.js";

async function readCommittedDays(env, request) {
  if (!env || !env.ASSETS || !request) return null;
  try {
    const res = await env.ASSETS.fetch(new URL("/etf-live.json", request.url));
    if (!res.ok) return null;
    const payload = await res.json();
    return (payload && payload.days) || null;
  } catch {
    return null;
  }
}

export async function getEtfDataset(env, request) {
  const committed = await readCommittedDays(env, request);
  let upstream = null;
  try {
    upstream = await fetchUpstreamDays(env);
  } catch {
    /* key missing, quota hit or upstream down — fall back below */
  }
  const extra = { ...(committed || {}), ...((upstream && upstream.days) || {}) };
  return {
    dataset: mergeEtfDatasets(extra),
    source: upstream ? "cryptoetf.today" : committed && Object.keys(committed).length ? "etf-live.json" : "seed",
    updatedAt: (upstream && upstream.updated) || null,
  };
}
