// Resolves the ETF dataset: embedded seed + live days from /etf-live.json.
// The file is committed to the repo by the daily sync (scripts/etf_sync.mjs).
import { ETF_DATASET, mergeEtfDatasets } from "./etf.js";

export async function getEtfDataset(env, request) {
  if (!env || !env.ASSETS || !request) return ETF_DATASET;
  try {
    const url = new URL("/etf-live.json", request.url);
    const res = await env.ASSETS.fetch(url);
    if (!res.ok) return ETF_DATASET;
    const payload = await res.json();
    return mergeEtfDatasets(payload && payload.days);
  } catch {
    return ETF_DATASET;
  }
}
