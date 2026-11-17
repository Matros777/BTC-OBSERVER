# BTC // OBSERVER

Локальный наблюдатель за BTC/USDT на публичном API Binance.

- 1H свечи, 500 штук
- EMA 20 / 50 / 200, Bollinger Bands
- RSI, MACD, Stochastic, ADX/DI, ATR, OBV, VWAP, CCI, Williams %R, MFI, ROC
- Ichimoku, Fibonacci, Pivot Points, swing high/low
- Композитный сигнал с весами
- **BTC ETF flows 2W (farside)**: дневные потоки, inflow/outflow, IBIT/FBTC, verdict
- **Signal Long / Short**: круглый индикатор tech + ETF, long 1-3M / short 24h
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

## ETF flows: авто-обновление дней

farside.co.uk закрыт Cloudflare-челленджем: ни Worker, ни GitHub Actions, ни curl его не читают.
Поэтому свежие дни забирает реальный браузер на asus и коммитит их в репозиторий.

- Сид (исторический датасет) — `static/etf.js`
- Живые дни — `static/etf-live.json` (`{ "updated": "...", "days": { "YYYY-MM-DD": {...} } }`)
- Фронт мержит live поверх сида (`loadEtfDataset()`), окно 2W сдвигается само
- Worker: `/api/etf` и `/api/market` читают тот же файл через `ASSETS`
- Локальный `server.py` тоже подхватывает `static/etf-live.json`

Ручной синк (asus, Chrome с CDP на `127.0.0.1:9222`):

```sh
DISPLAY=:0 node scripts/etf_sync.mjs --dry-run   # только распарсить
DISPLAY=:0 node scripts/etf_sync.mjs             # распарсить + коммит в main
```

Токен с правом `contents:write` берётся из `GITHUB_TOKEN` или
`~/.config/btc-observer/github_token` (chmod 600). Коммит в `main` запускает автодеплой.

Ежедневный запуск — systemd-таймер `btc-etf-sync.timer` (01:10, 02:10, 03:10, 04:10 по локальному времени;
скрипт идемпотентен и ничего не коммитит, если новых дней нет).

## Темы

- Тёмная (по умолчанию) и белая темы, переключатель в шапке
- Выбор хранится в `localStorage` (`btc-observer-theme`), применяется до первой отрисовки
- Палитра графиков переключается вместе с темой (`PALETTES` в `static/app.js`)

## Важно

Прогноз вероятностный, не является финансовой рекомендацией.
Публичный API Binance может быть недоступен в некоторых регионах/VPN.
