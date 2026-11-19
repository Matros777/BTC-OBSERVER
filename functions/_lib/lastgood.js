// Last-good ETF snapshot stored in the Workers edge cache (caches.default).
// Survives upstream outages without requiring any KV namespace or extra binding.
// Same pattern as binance.js (synthetic cache URL + cf.cacheTtl with cacheEverything).

const LASTGOOD_URL = "https://btc-observer-cache.local/etf-lastgood";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function saveEtfLastGood(payload) {
  if (typeof caches === "undefined" || !caches.default) return;
  try {
    const res = new Response(JSON.stringify({ ...payload, fetchedAt: Date.now() }), {
      headers: { "Content-Type": "application/json" },
    });
    await caches.default.put(
      new Request(LASTGOOD_URL, { cf: { cacheTtl: TTL_SECONDS, cacheEverything: true } }),
      res
    );
  } catch { /* cache is best-effort */ }
}

export async function readEtfLastGood() {
  if (typeof caches === "undefined" || !caches.default) return null;
  try {
    const hit = await caches.default.match(new Request(LASTGOOD_URL));
    return hit ? hit.json() : null;
  } catch {
    return null;
  }
}
