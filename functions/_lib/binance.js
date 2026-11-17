// Binance public market data with Cloudflare cache.

const BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
];
const TTL = 30;

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "btc-observer/1.0",
        Accept: "application/json",
      },
      cf: { cacheTtl: TTL, cacheEverything: true },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cachedJson(path) {
  const key = new Request(`https://btc-observer-cache.local${path}`);
  if (typeof caches !== "undefined" && caches.default) {
    const hit = await caches.default.match(key);
    if (hit) return hit.json();
  }

  let lastError = null;
  let data = null;
  for (const base of BASES) {
    try {
      data = await fetchJson(base + path);
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (data === null) throw lastError || new Error("Binance unavailable");

  if (typeof caches !== "undefined" && caches.default) {
    const body = JSON.stringify(data);
    const response = new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${TTL}`,
      },
    });
    await caches.default.put(key, response);
  }
  return data;
}

export async function getKlines(interval = "1h", limit = 500) {
  const path = `/api/v3/klines?symbol=BTCUSDT&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const raw = await cachedJson(path);
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
    ct: Number(k[6]),
    qv: Number(k[7]),
    n: Number(k[8]),
    tb: Number(k[9]),
    tq: Number(k[10]),
  }));
}

export async function getTicker() {
  return cachedJson("/api/v3/ticker/24hr?symbol=BTCUSDT");
}
