# BTC // OBSERVER

Локальный наблюдатель за BTC/USDT на публичном API Binance.

- 1H свечи, 500 штук
- EMA 20 / 50 / 200, Bollinger Bands
- RSI, MACD, Stochastic, ADX/DI, ATR, OBV, VWAP, CCI, Williams %R, MFI, ROC
- Ichimoku, Fibonacci, Pivot Points, swing high/low
- Композитный сигнал с весами
- **BTC ETF flows 2W (farside)**: дневные потоки, inflow/outflow, IBIT/FBTC, verdict
- **Signal Long / Short**: круглый индикатор tech + ETF, long 1-3M / short 24h
- **EMA CROSS**: пересечения 20/50, 50/200, 20/200 — вверх = BUY, вниз = SELL (отдельный сигнал + панель + стрелки на графике цены)
- Все графики (цена, RSI, MACD, объём, EMA CROSS) на TradingView Lightweight Charts с синхронной осью времени и кроссхэйром
- Дневной 1D-анализ для долгосрочной части индикатора
- Прогноз на 24 часа: Monte Carlo GBM, 5000 траекторий, 1H шаги, волатильность EWMA(0.94), детерминированный сид на сутки
- Тёмный минималистичный интерфейс с неоновыми графиками
- Без API-ключей и без внешних зависимостей (Python stdlib + vanilla JS)

## Запуск

```sh
cd ~/Загрузки/btc-observer
python3 server.py --host 127.0.0.1 --port 8787
```

Открыть:

```text
http://127.0.0.1:8787
```

Для доступа из локальной сети:

```sh
python3 server.py --host 0.0.0.0 --port 8787
```

и разрешить порт в firewall, например:

```sh
sudo ufw allow from 192.168.216.0/24 to any port 8787 proto tcp
```

## Фоновый запуск

```sh
./start.sh
```

Остановка:

```sh
./stop.sh
```

Лог: `server.log`.

## API

- `GET /api/health` — проверка сервера
- `GET /api/klines?interval=1h&limit=500` — свечи
- `GET /api/market` — цена, индикаторы, сигналы, прогноз, ETF, long-term
- `GET /api/etf` — 2-недельный ETF-срез
- `GET /api/ticker` — 24h тикер Binance
- `POST /mcp` — MCP-сервер для агентов (см. ниже)

## MCP-сервер (для агентов)

Встроен в Worker на `POST /mcp` (MCP streamable HTTP, JSON-RPC 2.0, без сессий и SSE).
Один вызов `btc_report` вытаскивает весь снимок рынка вместо N запросов к API.

Инструменты:

- `btc_report` — полный снимок: цена, 24h тикер, индикаторы, 21 сигнал, композит, EMA cross,
  прогноз Monte Carlo 24h, уровни (фиб/пивоты/свинги), ETF 2W, long-term.
  Параметры: `include_chart` (240 1h-свечей, по умолчанию false), `include_daily` (ETF по дням, default true)
- `btc_price` — цена и 24h тикер
- `btc_etf` — ETF-потоки 2W
- `btc_klines` — сырые OHLCV, `interval` (1m…1w, default 1h), `limit` (10–1000, default 100)
- `btc_forecast` — прогноз 24h + контекст (композит, EMA cross)

Подключение в OpenCode:

```sh
opencode mcp add btc-observer --global --url https://btc-observer.ivanbenks7-e96.workers.dev/mcp
```

Защита (опционально): записать секрет `MCP_API_KEY` в Worker
(`npx wrangler secret put MCP_API_KEY`) — тогда запросы без
`Authorization: Bearer <key>` (или `X-API-Key: <key>`) получат 401.
Без секрета эндпоинт публичный, как остальные /api.

Локальный smoke-тест без деплоя:

```sh
node scripts/mcp_test.mjs
```

## SEO / social / AI

- Title, description, keywords, canonical, robots
- Open Graph + Twitter `summary_large_image`
- OG image: `/og-image.png` (1200×630)
- JSON-LD: `WebSite`, `WebApplication`, `Dataset`
- `/robots.txt` с разрешением AI-ботам (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot)
- `/sitemap.xml`
- `/llms.txt` для AI-поисковиков
- `/manifest.webmanifest` и `/apple-touch-icon.png`

## Cloudflare Workers

Репозиторий: `https://github.com/Matros777/BTC-OBSERVER`

Проект в Cloudflare — **Workers** (`btc-observer`), не Pages.

- Entry point: `worker.js`
- Static assets: `static` → binding `ASSETS`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- API: `/api/market`, `/api/etf`, `/api/klines`, `/api/ticker`, `/mcp` (MCP-сервер для агентов)
- Индикаторы считаются в браузере; Worker только отдаёт свечи/тикер и статику
- Данные: MEXC (Binance-compatible) → `data-api.binance.vision` → `api.binance.com` fallback
- ETF-сид 2W встроен в `static/etf.js` (его же импортирует Worker), живые дни — в `static/etf-live.json`
- Автодеплой: push в `main` → сборка Cloudflare Workers

`wrangler.toml`:

```toml
name = "btc-observer"
main = "worker.js"
compatibility_date = "2026-11-17"

[assets]
directory = "./static"
binding = "ASSETS"
```

Прямой деплой:

```sh
npm install
npx wrangler deploy
```

Если нужен отдельный **Pages**-проект (не текущий Workers):

```sh
npm run pages:deploy
```

Если Cloudflare не сможет достучаться до Binance, API вернёт 502 — тогда нужен прокси или свой сервер.

## ETF flows: авто-обновление на Cloudflare

farside.co.uk закрыт Cloudflare-челленджем: его не читают ни Worker, ни GitHub Actions, ни curl —
проверено, все датацентровые IP получают 403. Поэтому источник — **cryptoetf.today**, его открытый
MCP-эндпоинт (`https://mcp.cryptoetf.today/api/mcp`): без аккаунта и без ключа, 60 запросов/мин на IP,
история 30 дней, разбивка по фондам (IBIT, FBTC и остальные). Значения совпадают с farside.

Как это работает:

- Worker (`functions/_lib/etf-source.js`) вызывает MCP-инструмент `get_fund_flows` для `btc`
- ответ (SSE `data: {...}` → JSON-строка) превращается в `{ "YYYY-MM-DD": { total, ibit, fbtc } }`
- результат кэшируется на 6 часов в edge-кэше, поэтому квота не расходуется (≈4 запроса в сутки)
- `/api/etf` и `/api/market` отдают готовый срез, в ответе есть поле `source`
- порядок фолбэков: `cryptoetf.today` → `static/etf-live.json` → встроенный сид в `static/etf.js`
- новые дни появляются сами: окно 2W всегда берёт последние 10 торговых дней

Ни ключей, ни секретов, ни кронов, ни ноутбука — всё считается внутри Cloudflare при запросе.

Проверка:

```sh
curl -s https://btc-observer.ivanbenks7-e96.workers.dev/api/etf \
  | jq '{source, window, last: .summary.last}'
# source: "cryptoetf.today"
```

Ручной резерв (если когда-нибудь понадобится): `scripts/etf_sync.mjs` забирает farside через
локальный Chrome (CDP) и коммитит `static/etf-live.json`.

## Темы

- Тёмная (по умолчанию) и белая темы, переключатель в шапке
- Выбор хранится в `localStorage` (`btc-observer-theme`), применяется до первой отрисовки
- Палитра графиков переключается вместе с темой (`PALETTES` в `static/app.js`)

## Важно

Прогноз вероятностный, не является финансовой рекомендацией.
Публичный API Binance может быть недоступен в некоторых регионах/VPN.

## Forecast Scoreboard (daily self-audit)

The dashboard audits its own 24h Monte Carlo forecast — no hindsight, no edits:

- Cron trigger `0 9 * * *` (UTC): snapshots the current forecast (median, P10/P90, probUp) into D1 (`forecast_snapshots`) and verifies yesterday's snapshot against the actual 1m close at the horizon.
- Lazy bootstrap: if today's snapshot is missing, the job also runs from the first `/api/market` request of the day.
- Metrics: direction hit-rate, P10–P90 corridor calibration (~80% target), median error (MAE), current streak.
- Headline stats are **live-only**; walk-forward replay rows are reported separately (they are not the forecast that was published that day).
- Monte Carlo is seeded by UTC day, so the cron snapshot, the dashboard and the replay backfill draw the same paths and the numbers stay stable within a day.
- API: `GET /api/forecast-accuracy` — UI: FORECAST SCOREBOARD panel at the bottom of the dashboard.

First remote setup:

```sh
npx wrangler d1 create btc-observer-forecast   # paste the returned database_id into wrangler.toml
npx wrangler d1 execute btc-observer-forecast --remote --file migrations/0001_forecast_snapshots.sql
npx wrangler deploy
```

Local development uses the simulated D1 database automatically:

```sh
npx wrangler d1 execute DB --local --file migrations/0001_forecast_snapshots.sql
npx wrangler dev          # dashboard at http://127.0.0.1:8787
curl 'http://127.0.0.1:8787/__scheduled?cron=0+9+*+*+*'   # trigger the job manually
```

### Historical backfill (walk-forward replay)

`scripts/backfill_forecast.mjs` rebuilds what the model *would have said* on past days:
for each day D it feeds the model only the 500 hourly candles that existed before
D 09:00 UTC, runs the production `analysis.js`, then verifies against the actual
close at D+24h. Rows are stored with `source='replay'` and marked `R` in the UI —
live snapshots stay separate and only live rows feed the headline hit-rate/calibration.
Monte Carlo is seeded from the day, so a replay run is reproducible; it still differs
from the original live row if the provider served slightly different candles.

Model note (2026-11-23): drift is set to zero for the 24h horizon (the sample drift is
noise at that scale and walk-forward showed it worsened the median), volatility is an
EWMA(λ=0.94) over the last 500 hourly log-returns, and P10/P50/P90 are linearly
interpolated across 5000 paths.

```sh
node scripts/backfill_forecast.mjs 2026-10-22 2026-10-23 ... > /tmp/backfill.sql
npx wrangler d1 execute btc-observer-forecast --remote --config wrangler.toml --file /tmp/backfill.sql -y
```

Provider note: MEXC ignores `startTime` when it is sent alone and returns the latest
candles. A request with **both** `startTime` and `endTime` is honored; `getCloseAt`
sends both, validates that the requested minute came back, and falls through to the
next provider otherwise.
