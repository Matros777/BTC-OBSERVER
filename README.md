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
- Прогноз на 24 часа: Monte Carlo GBM, 2000 траекторий, 1H шаги
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
- API: `/api/market`, `/api/etf`, `/api/klines`, `/api/ticker`
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
