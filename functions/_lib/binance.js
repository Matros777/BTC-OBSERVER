// Market data with provider fallback.
// MEXC is Binance-compatible and reachable from Cloudflare; Binance is fallback.
// Credentials/proxy are never stored here — use Cloudflare secrets if needed.

const PROVIDERS = [
  {
    name: "mexc",
    base: "https://api.mexc.com",
    interval: (value) => (value === "1h" ? "60m" : value),
    tickerScale: 100,
  },
  {
    name: "binance-vision",
    base: "https://data-api.binance.vision",
    interval: (value) => value,
    tickerScale: 1,
  },
  {
    name: "binance",
    base: "https://api.binance.com",
    interval: (value) => value,
    tickerScale: 1,
  },
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

async function cachedJson(url) {
  const key = new Request(`https://btc-observer-cache.local/${encodeURIComponent(url)}`);
  if (typeof caches !== "undefined" && caches.default) {
    const hit = await caches.default.match(key);
    if (hit) return hit.json();
  }

  const data = await fetchJson(url);
  if (typeof caches !== "undefined" && caches.default) {
    const response = new Response(JSON.stringify(data), {
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
  let lastError = null;
  for (const provider of PROVIDERS) {
    try {
      const iv = provider.interval(interval);
      const url = `${provider.base}/api/v3/klines?symbol=BTCUSDT&interval=${encodeURIComponent(iv)}&limit=${limit}`;
      const raw = await cachedJson(url);
      return raw.map((k) => ({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
        ct: Number(k[6]),
        qv: Number(k[7]),
        n: Number(k[8] || 0),
        tb: Number(k[9] || 0),
        tq: Number(k[10] || 0),
      }));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("market data unavailable");
}

export async function getTicker() {
  let lastError = null;
  for (const provider of PROVIDERS) {
    try {
      const url = `${provider.base}/api/v3/ticker/24hr?symbol=BTCUSDT`;
      const data = await cachedJson(url);
      if (provider.tickerScale !== 1 && data.priceChangePercent !== null && data.priceChangePercent !== undefined) {
        data.priceChangePercent = Number(data.priceChangePercent) * provider.tickerScale;
      }
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("ticker unavailable");
}

// Close of the 1-minute candle ending exactly at tsMs — the last traded price
// before tsMs. Used by the forecast scoreboard to verify yesterday's snapshot.
export async function getCloseAt(tsMs) {
  const start = tsMs - 60_000;
  let lastError = null;
  for (const provider of PROVIDERS) {
    try {
      const url = `${provider.base}/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=1`;
      const raw = await cachedJson(url);
      if (!Array.isArray(raw) || raw.length === 0) throw new Error("empty klines");
      // The provider must honor startTime; MEXC silently ignores it and would
      // return the newest candle instead of the one at the requested minute.
      if (Number(raw[0][0]) !== start) throw new Error("startTime not honored");
      return Number(raw[0][4]);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("price at timestamp unavailable");
}
