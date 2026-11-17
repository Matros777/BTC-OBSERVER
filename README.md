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

## Cloudflare Pages

Репозиторий: `https://github.com/Matros777/BTC-OBSERVER`

- Build command: `npm run build` (или пусто)
- Build output directory: `static`
- Functions: каталог `functions/` — API `/api/market`, `/api/etf`, `/api/klines`
- Данные Binance: `data-api.binance.vision`, fallback `api.binance.com`
- ETF-датасет 2W встроен в `functions/_lib/etf.js`, внешний fetch не нужен

Прямой деплой:

```sh
npm install
npx wrangler pages deploy static
```

При подключении репозитория в Cloudflare Pages:

- Framework preset: **None**
- Build command: `npm run build`
- Build output directory: `static`

Если Cloudflare не сможет достучаться до Binance, API вернёт 502 — тогда нужен прокси или свой сервер.

## Важно

Прогноз вероятностный, не является финансовой рекомендацией.
Публичный API Binance может быть недоступен в некоторых регионах/VPN.
