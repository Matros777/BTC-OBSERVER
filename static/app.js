/* BTC // OBSERVER — frontend */
import { analyze, analyzeLongTerm } from "./analysis.js";
import { etfSummary, loadEtfDataset } from "./etf.js";

(() => {
  "use strict";

  const PALETTES = {
    dark: {
      bg: "#050507",
      grid: "rgba(255,255,255,0.045)",
      gridStrong: "rgba(255,255,255,0.08)",
      line: "rgba(255,255,255,0.08)",
      lineStrong: "rgba(255,255,255,0.22)",
      text: "#e9e9f2",
      muted: "#76768a",
      dim: "#4a4a5a",
      neon: "#00ffb3",
      pink: "#ff2d6f",
      cyan: "#00e5ff",
      purple: "#b26bff",
      yellow: "#ffe066",
      orange: "#ff9f43",
    },
    light: {
      bg: "#f4f6fb",
      grid: "rgba(15,23,42,0.07)",
      gridStrong: "rgba(15,23,42,0.12)",
      line: "rgba(15,23,42,0.10)",
      lineStrong: "rgba(15,23,42,0.24)",
      text: "#0f172a",
      muted: "#556176",
      dim: "#8792a8",
      neon: "#00986e",
      pink: "#d81b53",
      cyan: "#0079a3",
      purple: "#6b37cf",
      yellow: "#9a7400",
      orange: "#bd6400",
    },
  };

  const getTheme = () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  let C = PALETTES[getTheme()];

  // hex -> rgba, so translucent chart fills follow the active palette
  const alpha = (hex, a) => {
    const h = String(hex).replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  const $ = (id) => document.getElementById(id);
  const state = { data: null, hover: null };

  const fmtMoney = (v, digits = 0) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
    return "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  };
  const fmtNum = (v, digits = 2) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  };
  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
    return (Number(v) >= 0 ? "+" : "") + Number(v).toFixed(digits) + "%";
  };
  const fmtCompact = (v) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
    const n = Number(v);
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(0);
  };
  const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "neutral");
  const timeLabel = (ms) => {
    const d = new Date(ms);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  };
  const dateLabel = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  function setStatus(text, online = true) {
    $("statusText").textContent = text;
    $("status").classList.toggle("offline", !online);
  }

  function showError(msg) {
    const el = $("error");
    if (!msg) { el.classList.add("hidden"); return; }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(10, rect.width);
    const h = Math.max(10, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function linePath(ctx, points, xOf, yOf) {
    let started = false;
    ctx.beginPath();
    for (const p of points) {
      if (!p) { started = false; continue; }
      const x = xOf(p.i);
      const y = yOf(p.v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
  }

  // ------------------------------------------------------------------
  // Price chart: TradingView Lightweight Charts (candles + EMA/BB + 24h cone)
  // ------------------------------------------------------------------
  let lwc = null;
  let lwcSeries = null;
  let lwcZoomed = false;
  const panelCharts = {};
  const lwcCharts = [];
  let lwcSyncGuard = false;

  const lwcPalette = () => ({
    up: C.neon,
    down: C.pink,
    text: C.muted,
    grid: C.grid,
    line: C.line,
    crosshair: C.lineStrong,
    cyan: C.cyan,
    pink: C.pink,
    yellow: C.yellow,
    neon: C.neon,
    band: alpha(C.cyan, 0.42),
    cone: alpha(C.neon, 0.38),
  });

  const toTime = (ms) => Math.floor(Number(ms) / 1000);

  function lineData(candles, values) {
    const out = [];
    for (let i = 0; i < values.length && i < candles.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue;
      out.push({ time: toTime(candles[i].t), value: Number(v) });
    }
    return out;
  }

  function handleLwcCrosshair(param) {
    const tip = $("tooltip");
    if (!tip) return;
    if (!param || !param.point || param.time === undefined || !lwcSeries || !state.data) {
      tip.classList.add("hidden");
      return;
    }
    const bar = param.seriesData.get(lwcSeries.candles);
    if (!bar) { tip.classList.add("hidden"); return; }
    const up = bar.close >= bar.open;
    const candles = state.data.chart.candles;
    const idx = candles.findIndex((k) => toTime(k.t) === param.time);
    const vol = idx >= 0 ? (state.data.chart.volume || [])[idx] : null;
    const ema = param.seriesData.get(lwcSeries.ema20);
    tip.innerHTML = `
      <b>${new Date(Number(param.time) * 1000).toLocaleString("en-GB")}</b><br>
      O ${fmtMoney(bar.open, 1)} · H ${fmtMoney(bar.high, 1)}<br>
      L ${fmtMoney(bar.low, 1)} · C <span class="${up ? "up" : "down"}">${fmtMoney(bar.close, 1)}</span><br>
      ${ema ? "EMA20 " + fmtMoney(ema.value, 1) + " · " : ""}${vol ? "VOL " + fmtCompact(vol) + " BTC" : ""}
    `;
    const host = $("priceChart");
    tip.style.left = Math.min(host.clientWidth - 190, Math.max(8, param.point.x + 14)) + "px";
    tip.style.top = Math.max(8, param.point.y - 24) + "px";
    tip.classList.remove("hidden");
  }

  function ensureLwc() {
    const host = $("priceChart");
    if (!host || !window.LightweightCharts) return null;
    if (lwc) return lwc;
    const P = lwcPalette();
    lwc = window.LightweightCharts.createChart(host, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: P.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 10,
        attributionLogo: false,
      },
      grid: { vertLines: { color: P.grid }, horzLines: { color: P.grid } },
      rightPriceScale: { borderColor: P.line, scaleMargins: { top: 0.2, bottom: 0.1 } },
      timeScale: {
        borderColor: P.line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 5,
        fixLeftEdge: false,
      },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: P.crosshair, style: 2, labelBackgroundColor: C.text },
        horzLine: { color: P.crosshair, style: 2, labelBackgroundColor: C.text },
      },
      localization: { priceFormatter: (v) => fmtMoney(v, Math.abs(v) >= 1000 ? 0 : 2) },
    });
    lwcSeries = {
      candles: lwc.addCandlestickSeries({
        upColor: P.up,
        downColor: P.down,
        borderUpColor: P.up,
        borderDownColor: P.down,
        wickUpColor: P.up,
        wickDownColor: P.down,
        priceLineColor: P.neon,
        priceLineStyle: 2,
      }),
      ema20: lwc.addLineSeries({ color: P.cyan, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      ema50: lwc.addLineSeries({ color: P.pink, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      ema200: lwc.addLineSeries({ color: P.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      bbUpper: lwc.addLineSeries({ color: P.band, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      bbLower: lwc.addLineSeries({ color: P.band, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      coneUp: lwc.addLineSeries({ color: P.cone, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      coneDown: lwc.addLineSeries({ color: P.cone, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      median: lwc.addLineSeries({ color: P.neon, lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    };
    lwc.subscribeCrosshairMove(handleLwcCrosshair);
    panelCharts.price = lwc;
    lwc.__main = lwcSeries.candles;
    registerSync(lwc);
    return lwc;
  }

  function drawPriceChart(data) {
    const chart = data.chart || {};
    const candles = chart.candles || [];
    if (!candles.length) return;
    if (!ensureLwc()) return;
    const P = lwcPalette();

    lwc.applyOptions({
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: P.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 10,
      },
      grid: { vertLines: { color: P.grid }, horzLines: { color: P.grid } },
      rightPriceScale: { borderColor: P.line },
      timeScale: { borderColor: P.line },
      crosshair: {
        vertLine: { color: P.crosshair, labelBackgroundColor: C.text },
        horzLine: { color: P.crosshair, labelBackgroundColor: C.text },
      },
    });
    lwcSeries.candles.applyOptions({
      upColor: P.up, downColor: P.down,
      borderUpColor: P.up, borderDownColor: P.down,
      wickUpColor: P.up, wickDownColor: P.down,
      priceLineColor: P.neon,
    });
    lwcSeries.ema20.applyOptions({ color: P.cyan });
    lwcSeries.ema50.applyOptions({ color: P.pink });
    lwcSeries.ema200.applyOptions({ color: P.yellow });
    lwcSeries.bbUpper.applyOptions({ color: P.band });
    lwcSeries.bbLower.applyOptions({ color: P.band });
    lwcSeries.coneUp.applyOptions({ color: P.cone });
    lwcSeries.coneDown.applyOptions({ color: P.cone });
    lwcSeries.median.applyOptions({ color: P.neon });

    lwcSeries.candles.setData(candles.map((k) => ({
      time: toTime(k.t), open: k.o, high: k.h, low: k.l, close: k.c,
    })));
    lwcSeries.ema20.setData(lineData(candles, chart.ema20 || []));
    lwcSeries.ema50.setData(lineData(candles, chart.ema50 || []));
    lwcSeries.ema200.setData(lineData(candles, chart.ema200 || []));
    lwcSeries.bbUpper.setData(lineData(candles, chart.bb_upper || []));
    lwcSeries.bbLower.setData(lineData(candles, chart.bb_lower || []));
    lwc.__values = new Map(candles.map((k) => [toTime(k.t), k.c]));

    const pred = data.prediction || {};
    const path = Array.isArray(pred.path) ? pred.path : [];
    const last = candles[candles.length - 1];
    const step = 3600;
    const t0 = toTime(last.t);
    if (path.length > 1 && Number.isFinite(pred.p10) && Number.isFinite(pred.p90)) {
      const half = Math.max(0, (pred.p90 - pred.p10) / 2);
      const up = [], down = [], mid = [];
      for (let i = 0; i < path.length; i++) {
        const frac = i / (path.length - 1);
        const time = t0 + i * step;
        up.push({ time, value: path[i] + half * frac });
        down.push({ time, value: path[i] - half * frac });
        mid.push({ time, value: path[i] });
      }
      lwcSeries.coneUp.setData(up);
      lwcSeries.coneDown.setData(down);
      lwcSeries.median.setData(mid);
      // EMA cross arrows on price + the NOW marker, one marker per timestamp
      const uniq = new Map();
      for (const e of (chart.ema_cross && chart.ema_cross.events) || []) {
        if (e.pair === "20/200") continue;
        const tt = toTime(e.t);
        if (tt <= t0 && !uniq.has(tt)) uniq.set(tt, e);
      }
      const crossMarks = [...uniq.values()].slice(-18).map((e) => ({
        time: toTime(e.t),
        position: e.dir === "up" ? "belowBar" : "aboveBar",
        color: e.dir === "up" ? P.neon : P.pink,
        shape: e.dir === "up" ? "arrowUp" : "arrowDown",
        text: "",
      }));
      const marks = crossMarks.concat([{ time: t0, position: "aboveBar", color: P.neon, shape: "circle", text: "NOW" }])
        .sort((a, b) => a.time - b.time);
      lwcSeries.candles.setMarkers(marks);
    } else {
      lwcSeries.coneUp.setData([]);
      lwcSeries.coneDown.setData([]);
      lwcSeries.median.setData([]);
      lwcSeries.candles.setMarkers([]);
    }

    // first paint: show the recent window plus the forecast tail instead of all 500 bars
    if (!lwcZoomed) {
      lwcZoomed = true;
      const host = $("priceChart");
      const narrow = host && host.clientWidth < 640;
      const bars = Math.min(narrow ? 90 : 200, candles.length);
      lwc.timeScale().setVisibleLogicalRange({ from: candles.length - bars, to: candles.length + 26 });
    }
  }

  // ==================================================================
  // Indicator panels on Lightweight Charts, synced time axis + crosshair
  // ==================================================================
  function panelOptions(P) {
    return {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: P.text,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 9,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "transparent" }, horzLines: { color: P.grid } },
      rightPriceScale: { borderColor: P.line, entireTextOnly: true, scaleMargins: { top: 0.18, bottom: 0.18 } },
      timeScale: { borderColor: P.line, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 5 },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: P.crosshair, style: 2, labelBackgroundColor: C.text },
        horzLine: { color: P.crosshair, style: 2, labelBackgroundColor: C.text },
      },
      localization: { priceFormatter: (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) },
    };
  }

  function applyPanelTheme(chart, P) {
    chart.applyOptions({
      layout: { textColor: P.text, fontFamily: getComputedStyle(document.body).fontFamily },
      grid: { horzLines: { color: P.grid } },
      rightPriceScale: { borderColor: P.line },
      timeScale: { borderColor: P.line },
      crosshair: {
        vertLine: { color: P.crosshair, labelBackgroundColor: C.text },
        horzLine: { color: P.crosshair, labelBackgroundColor: C.text },
      },
    });
  }

  function registerSync(chart) {
    if (chart.__synced) return;
    chart.__synced = true;
    lwcCharts.push(chart);
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || lwcSyncGuard) return;
      lwcSyncGuard = true;
      for (const other of lwcCharts) {
        if (other === chart) continue;
        try { other.timeScale().setVisibleLogicalRange(range); } catch (e) { /* shorter series */ }
      }
      lwcSyncGuard = false;
    });
    chart.subscribeCrosshairMove((param) => {
      if (lwcSyncGuard) return;
      lwcSyncGuard = true;
      for (const other of lwcCharts) {
        if (other === chart) continue;
        try {
          if (param.time === undefined || !other.__main) { other.clearCrosshairPosition(); continue; }
          const v = other.__values && other.__values.get(param.time);
          if (v === undefined) other.clearCrosshairPosition();
          else other.setCrosshairPosition(v, param.time, other.__main);
        } catch (e) { /* chart without data */ }
      }
      lwcSyncGuard = false;
    });
  }

  function ensurePanel(key, build) {
    if (panelCharts[key]) return panelCharts[key];
    const host = $(key + "Chart");
    if (!host || !window.LightweightCharts) return null;
    const P = lwcPalette();
    const chart = window.LightweightCharts.createChart(host, panelOptions(P));
    chart.__values = new Map();
    chart.__lines = [];
    panelCharts[key] = chart;
    build(chart, P);
    registerSync(chart);
    return chart;
  }

  function seriesPoints(candles, values) {
    const out = [];
    for (let i = 0; i < values.length && i < candles.length; i++) {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(Number(v))) continue;
      out.push({ time: toTime(candles[i].t), value: Number(v) });
    }
    return out;
  }

  function drawRSI(data) {
    const P = lwcPalette();
    const chart = ensurePanel("rsi", (c, p) => {
      c.__series = c.addAreaSeries({
        lineColor: p.purple,
        topColor: alpha(p.purple, 0.18),
        bottomColor: alpha(p.purple, 0),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      c.__main = c.__series;
    });
    if (!chart) return;
    applyPanelTheme(chart, P);
    const candles = data.chart.candles || [];
    const pts = seriesPoints(candles, data.chart.rsi || []);
    chart.__series.applyOptions({ lineColor: P.purple, topColor: alpha(P.purple, 0.18), bottomColor: alpha(P.purple, 0) });
    chart.__series.setData(pts);
    chart.__values = new Map(pts.map((pt) => [pt.time, pt.value]));
    chart.__lines.forEach((l) => chart.__series.removePriceLine(l));
    chart.__lines = [30, 50, 70].map((level) => chart.__series.createPriceLine({
      price: level,
      color: level === 50 ? P.lineStrong : P.line,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: false,
      title: String(level),
    }));
  }

  function drawMACD(data) {
    const P = lwcPalette();
    const chart = ensurePanel("macd", (c, p) => {
      c.__hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
      c.__line = c.addLineSeries({ color: p.cyan, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      c.__sig = c.addLineSeries({ color: p.pink, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      c.__main = c.__line;
    });
    if (!chart) return;
    applyPanelTheme(chart, P);
    const candles = data.chart.candles || [];
    const hist = seriesPoints(candles, data.chart.macd_hist || [])
      .map((pt) => ({ ...pt, color: pt.value >= 0 ? alpha(P.neon, 0.55) : alpha(P.pink, 0.55) }));
    const line = seriesPoints(candles, data.chart.macd || []);
    const sig = seriesPoints(candles, data.chart.macd_signal || []);
    chart.__line.applyOptions({ color: P.cyan });
    chart.__sig.applyOptions({ color: P.pink });
    chart.__hist.setData(hist);
    chart.__line.setData(line);
    chart.__sig.setData(sig);
    chart.__values = new Map(line.map((pt) => [pt.time, pt.value]));
    chart.__lines.forEach((l) => chart.__line.removePriceLine(l));
    chart.__lines = [chart.__line.createPriceLine({ price: 0, color: P.line, lineWidth: 1, lineStyle: 0, axisLabelVisible: false })];
  }

  function drawVolume(data) {
    const P = lwcPalette();
    const chart = ensurePanel("volume", (c) => {
      c.__hist = c.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "volume" } });
      c.__main = c.__hist;
    });
    if (!chart) return;
    applyPanelTheme(chart, P);
    const candles = data.chart.candles || [];
    const vols = data.chart.volume || [];
    const pts = [];
    const vals = new Map();
    for (let i = 0; i < vols.length && i < candles.length; i++) {
      const v = Number(vols[i]);
      if (!Number.isFinite(v)) continue;
      const time = toTime(candles[i].t);
      const up = candles[i].c >= candles[i].o;
      pts.push({ time, value: v, color: up ? alpha(P.neon, 0.45) : alpha(P.pink, 0.45) });
      vals.set(time, v);
    }
    chart.__hist.setData(pts);
    chart.__values = vals;
  }

  function drawEmaCross(data) {
    const P = lwcPalette();
    const chart = ensurePanel("emaCross", (c, p) => {
      c.__p2050 = c.addLineSeries({ color: p.cyan, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      c.__p50200 = c.addLineSeries({ color: p.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      c.__main = c.__p2050;
    });
    if (!chart) return;
    applyPanelTheme(chart, P);
    const candles = data.chart.candles || [];
    const cross = data.chart.ema_cross || {};
    const a = seriesPoints(candles, cross.p2050 || []);
    const b = seriesPoints(candles, cross.p50200 || []);
    chart.__p2050.applyOptions({ color: P.cyan });
    chart.__p50200.applyOptions({ color: P.yellow });
    chart.__p2050.setData(a);
    chart.__p50200.setData(b);
    chart.__values = new Map(a.map((pt) => [pt.time, pt.value]));
    chart.__lines.forEach((l) => chart.__p2050.removePriceLine(l));
    chart.__lines = [chart.__p2050.createPriceLine({ price: 0, color: P.lineStrong, lineWidth: 1, lineStyle: 2, axisLabelVisible: false })];

    const timesA = new Set(a.map((pt) => pt.time));
    const timesB = new Set(b.map((pt) => pt.time));
    const ev = Array.isArray(cross.events) ? cross.events : [];
    const marks = (pair, set) => ev
      .filter((e) => e.pair === pair && set.has(toTime(e.t)))
      .slice(-24)
      .map((e) => ({
        time: toTime(e.t),
        position: e.dir === "up" ? "belowBar" : "aboveBar",
        color: e.dir === "up" ? P.neon : P.pink,
        shape: e.dir === "up" ? "arrowUp" : "arrowDown",
        text: "",
      }))
      .sort((x, y) => x.time - y.time);
    chart.__p2050.setMarkers(marks("20/50", timesA));
    chart.__p50200.setMarkers(marks("50/200", timesB));
  }

  function renderSignals(signals) {
    const grid = $("signalGrid");
    grid.innerHTML = "";
    $("matrixCount").textContent = signals.length + " SIGNALS";
    for (const s of signals) {
      const card = document.createElement("div");
      card.className = "signal-card";
      const bull = s.score > 0.15;
      const bear = s.score < -0.15;
      const badgeCls = bull ? "bull" : bear ? "bear" : "neutral";
      card.innerHTML = `
        <div class="signal-top">
          <span class="signal-name">${s.name}</span>
          <span class="signal-badge ${badgeCls}">${s.signal}</span>
        </div>
        <div class="signal-value">${s.value}</div>
        <div class="signal-note">${s.weight > 0 ? `score ${s.score >= 0 ? "+" : ""}${s.score.toFixed(2)} · weight ${s.weight}` : (s.note || "")}</div>
      `;
      grid.appendChild(card);
    }
  }

  function renderLevels(data) {
    const levels = data.levels || {};
    const fib = levels.fibonacci || { levels: {} };
    const piv = levels.pivots || {};
    const rows = [
      ["RESISTANCE", levels.resistance, "down"],
      ["PIVOT P", piv.p, ""],
      ["SUPPORT", levels.support, "up"],
      ["FIB 0.236", fib.levels["0.236"], ""],
      ["FIB 0.382", fib.levels["0.382"], ""],
      ["FIB 0.500", fib.levels["0.500"], ""],
      ["FIB 0.618", fib.levels["0.618"], ""],
      ["FIB 0.786", fib.levels["0.786"], ""],
    ];
    $("levels").innerHTML = rows.map(([k, v, c]) => `
      <div class="level-row"><span class="k">${k}</span><span class="v ${c}">${fmtMoney(v, 0)}</span></div>
    `).join("");

    const swingRows = [
      ...(levels.swing_highs || []).slice(-3).reverse().map((v) => ["SWING HIGH", v, "down"]),
      ...(levels.swing_lows || []).slice(-3).reverse().map((v) => ["SWING LOW", v, "up"]),
      ["PIVOT R1", piv.r1, "down"],
      ["PIVOT S1", piv.s1, "up"],
    ];
    $("swings").innerHTML = swingRows.map(([k, v, c]) => `
      <div class="level-row"><span class="k">${k}</span><span class="v ${c}">${fmtMoney(v, 0)}</span></div>
    `).join("");
  }

  const fmtFlow = (v) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "--";
    const n = Number(v);
    const sign = n > 0 ? "+" : n < 0 ? "-" : "";
    const abs = Math.abs(n);
    if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}B`;
    return `${sign}$${abs.toFixed(1)}M`;
  };

  const shortDate = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  const clampScore = (v, a, b) => Math.max(a, Math.min(b, v));

  function setArc(id, score) {
    const el = document.getElementById(id);
    if (!el) return;
    const r = Number(el.getAttribute("r"));
    const C = 2 * Math.PI * r;
    const frac = (clampScore(score, -100, 100) + 100) / 200;
    el.style.strokeDasharray = `${C}`;
    el.style.strokeDashoffset = `${C * (1 - frac)}`;
    if (score >= 20) el.style.stroke = "url(#cosmicGreen)";
    else if (score <= -20) el.style.stroke = "url(#cosmicRed)";
    else el.style.stroke = "url(#cosmicYellow)";
  }

  function renderCosmic(data) {
    const techShort = Number((data.composite || {}).score || 0);
    const techLong = Number((data.longTerm || {}).score || 0);
    const etfScore = Number((data.etf || {}).score || 0);
    const shortScore = clampScore(0.65 * techShort + 0.35 * etfScore, -100, 100);
    const longScore = clampScore(0.70 * techLong + 0.30 * etfScore, -100, 100);
    const overall = clampScore(0.5 * shortScore + 0.5 * longScore, -100, 100);
    const conf = clampScore(
      40 + Math.abs(overall) * 0.40
        + Math.min(Number((data.composite || {}).confidence || 0), 50) * 0.15
        + Math.min(Number((data.longTerm || {}).confidence || 0), 50) * 0.15,
      0, 95
    );

    setArc("cosmicShortArc", shortScore);
    setArc("cosmicLongArc", longScore);

    const verdict = overall >= 60 ? "STRONG BULLISH"
      : overall >= 25 ? "BULLISH"
      : overall <= -60 ? "STRONG BEARISH"
      : overall <= -25 ? "BEARISH"
      : "NEUTRAL";
    const el = $("cosmicVerdict");
    el.textContent = verdict;
    el.className = "cosmic-verdict " + (overall >= 25 ? "up" : overall <= -25 ? "down" : "neutral");
    $("cosmicConf").textContent = conf.toFixed(0) + "% confidence";
    $("shortScore").textContent = (shortScore >= 0 ? "+" : "") + shortScore.toFixed(1);
    $("longScore").textContent = (longScore >= 0 ? "+" : "") + longScore.toFixed(1);
  }

  function renderEtf(etf) {
    if (!etf || !etf.summary) return;
    const s = etf.summary;
    const net = $("etfNet");
    net.textContent = fmtFlow(s.net);
    net.className = "etf-net " + (s.net > 0 ? "pos" : s.net < 0 ? "neg" : "");

    const v = $("etfVerdict");
    v.textContent = s.lastVerdict || "--";
    const vc = s.lastVerdict === "FLASH-BUY" ? "buy"
      : s.lastVerdict === "FLASH-FAKE" ? "fake"
      : s.lastVerdict === "RED" ? "red" : "yellow";
    v.className = "etf-verdict " + vc;

    $("etfIn").textContent = fmtFlow(s.inflows);
    $("etfOut").textContent = fmtFlow(s.outflows);
    $("etfDaysCount").textContent = `${s.greenDays} / ${s.redDays}`;
    $("etfIbit").textContent = fmtFlow(s.ibitNet);
    $("etfFbtc").textContent = fmtFlow(s.fbtcNet);
    $("etfWow").textContent = s.wow === null || s.wow === undefined ? "--" : "x" + Number(s.wow).toFixed(2);
    $("etfAvg").textContent = fmtFlow(s.avgDaily);
    $("etfPressure").textContent = s.pressure === null || s.pressure === undefined ? "--" : Number(s.pressure).toFixed(1) + "x";
    $("etfLast").textContent = s.last ? shortDate(s.last.date) + " " + fmtFlow(s.last.total) : "--";

    const days = $("etfDays");
    days.innerHTML = (etf.daily || []).slice(-10).map((r) => {
      const c = r.total > 0 ? "pos" : r.total < 0 ? "neg" : "neutral";
      return `<div class="etf-day"><span class="d">${shortDate(r.date)}</span><span class="v ${c}">${fmtFlow(r.total)}</span></div>`;
    }).join("");

    drawEtfChart(etf);
  }

  function drawEtfChart(etf) {
    const canvas = $("etfChart");
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const rows = (etf && etf.daily) || [];
    if (!rows.length) return;

    const padL = 4, padR = 4, padT = 6, padB = 16;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxAbs = Math.max(...rows.map((r) => Math.abs(r.total)), 1);
    const zero = padT + plotH / 2;

    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(padL, zero);
    ctx.lineTo(w - padR, zero);
    ctx.stroke();

    const bw = Math.max(2, (plotW / rows.length) * 0.55);
    rows.forEach((r, i) => {
      const x = padL + (i + 0.5) * (plotW / rows.length);
      const bh = (Math.abs(r.total) / maxAbs) * (plotH / 2 - 2);
      const y = r.total >= 0 ? zero - bh : zero;
      ctx.fillStyle = r.total >= 0 ? alpha(C.neon, 0.65) : alpha(C.pink, 0.65);
      ctx.fillRect(x - bw / 2, y, bw, Math.max(1, bh));
      if (i % 2 === 0) {
        ctx.fillStyle = C.dim;
        ctx.font = "8px " + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = "center";
        ctx.fillText(shortDate(r.date), x, h - 4);
      }
    });
  }

  function render(data) {
    state.data = data;
    const t = data.ticker || {};
    const price = data.price;
    const change = t.change24h;

    $("price").textContent = fmtMoney(price, 0);
    const ch = $("change");
    ch.textContent = fmtPct(change);
    ch.className = "change " + cls(change);

    $("high").textContent = fmtMoney(t.high24h, 0);
    $("low").textContent = fmtMoney(t.low24h, 0);
    $("volume").textContent = fmtCompact(t.volume24h) + " BTC";
    $("trades").textContent = t.trades24h ? fmtCompact(t.trades24h) : "--";

    const comp = data.composite || {};
    const score = Number(comp.score || 0);
    $("gaugeFill").style.width = Math.max(0, Math.min(100, (score + 100) / 2)) + "%";
    $("gaugeScore").textContent = (score >= 0 ? "+" : "") + score.toFixed(1);
    $("gaugeLabel").textContent = comp.label || "NEUTRAL";
    $("gaugeLabel").className = "gauge-text " + cls(score);
    $("gaugeConf").textContent = fmtNum(comp.confidence, 0) + "%";

    const p = data.prediction || {};
    $("forecastMedian").textContent = fmtMoney(p.median, 0);
    const fc = $("forecastChange");
    fc.textContent = fmtPct(p.changePct);
    fc.className = "forecast-change " + cls(p.changePct);
    $("forecastLow").textContent = fmtMoney(p.p10, 0);
    $("forecastHigh").textContent = fmtMoney(p.p90, 0);
    $("probUp").textContent = (Number(p.probUp || 0) * 100).toFixed(1) + "%";
    $("forecastConf").textContent = fmtNum(p.confidence, 0) + "%";
    const volPct = data.indicators && data.indicators.atr14 ? (data.indicators.atr14 / price) * 100 : 0;
    $("volatility").textContent = volPct.toFixed(2) + "%";

    const rangePos = p.p90 && p.p10 && p.median
      ? Math.max(0, Math.min(100, ((p.median - p.p10) / (p.p90 - p.p10)) * 100))
      : 50;
    $("rangeFill").style.width = rangePos + "%";

    $("rsiTag").textContent = fmtNum(data.indicators.rsi14, 1);
    $("macdTag").textContent = fmtNum(data.indicators.macd_hist, 1);
    $("volumeTag").textContent = fmtCompact(t.volume24h);

    renderSignals(data.signals || []);
    renderLevels(data);
    renderCosmic(data);
    renderEtf(data.etf);
    $("updated").textContent = "UPDATED " + new Date(data.updatedAt).toLocaleTimeString("en-GB");
    drawPriceChart(data);
    drawRSI(data);
    drawMACD(data);
    drawVolume(data);
    drawEmaCross(data);
    const ec = data.emaCross || {};
    const crossTag = $("emaCrossTag");
    if (crossTag) {
      crossTag.textContent = ec.lastEvent
        ? `${ec.label} · ${ec.lastEvent.pair} ${ec.lastEvent.dir === "up" ? "▲" : "▼"} ${new Date(ec.lastEvent.t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
        : (ec.label || "--");
      crossTag.style.color = ec.state === "bull" ? "var(--neon)" : ec.state === "bear" ? "var(--pink)" : "";
    }
    setStatus("LIVE", true);
    showError(null);
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function fetchData() {
    setStatus("SYNC", true);
    try {
      const [k1h, k1d, ticker, etfDataset, etfApi] = await Promise.all([
        fetchJson("/api/klines?interval=1h&limit=500"),
        fetchJson("/api/klines?interval=1d&limit=250"),
        fetchJson("/api/ticker"),
        loadEtfDataset().catch(() => null),
        fetchJson("/api/etf").catch(() => null),
      ]);
      if (!k1h.klines || !k1h.klines.length) throw new Error(k1h.error || "no klines");
      const data = analyze(k1h.klines, ticker);
      // The Worker resolves flows from cryptoetf.today; the local server and
      // the offline path still fall back to the embedded seed + live file.
      if (etfApi && Array.isArray(etfApi.daily) && etfApi.daily.length) data.etf = etfApi;
      else data.etf = etfSummary(data.price, 10, etfDataset || undefined);
      try {
        data.longTerm = analyzeLongTerm(k1d.klines);
      } catch {
        data.longTerm = { score: 0, label: "NEUTRAL", confidence: 0, details: {}, signals: [] };
      }
      render(data);
    } catch (err) {
      // Fallback for the local Python server / older API deployments.
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        render(data);
      } catch (err2) {
        setStatus("OFFLINE", false);
        showError("BINANCE API: " + err2.message);
      }
    }
  }

  function pulseFavicon() {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const frames = [];
    const frameCount = 12;
    for (let f = 0; f < frameCount; f++) {
      const phase = (f / frameCount) * Math.PI * 2;
      const pulse = 0.5 + 0.5 * Math.sin(phase);

      ctx.clearRect(0, 0, size, size);
      const bg = ctx.createRadialGradient(32, 26, 4, 32, 32, 40);
      bg.addColorStop(0, "#11111a");
      bg.addColorStop(1, "#050507");
      ctx.fillStyle = bg;
      roundRect(0, 0, size, size, 14);
      ctx.fill();

      const radius = 18 + pulse * 6;
      ctx.beginPath();
      ctx.arc(32, 32, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,255,179,${0.10 + (1 - pulse) * 0.55})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(32, 12);
      ctx.lineTo(50, 32);
      ctx.lineTo(32, 52);
      ctx.lineTo(14, 32);
      ctx.closePath();
      const grad = ctx.createLinearGradient(14, 12, 50, 52);
      grad.addColorStop(0, "#00ffb3");
      grad.addColorStop(0.55, "#00e5ff");
      grad.addColorStop(1, "#b26bff");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#00ffb3";
      ctx.shadowBlur = 6 + pulse * 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(32, 32, 3.2 + pulse * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "#00ffb3";
      ctx.shadowColor = "#00ffb3";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      frames.push(canvas.toDataURL("image/png"));
    }

    let idx = 0;
    link.type = "image/png";
    link.href = frames[0];
    setInterval(() => {
      link.href = frames[idx++ % frames.length];
    }, 110);
  }

  function tickClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("en-GB");
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.data) {
        drawPriceChart(state.data);
        drawRSI(state.data);
        drawMACD(state.data);
        drawVolume(state.data);
        drawEtfChart(state.data.etf);
      }
    }, 150);
  });

  function applyTheme(theme, persist) {
    const next = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    if (persist) {
      try { localStorage.setItem("btc-observer-theme", next); } catch (e) { /* private mode */ }
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#f4f6fb" : "#050507");
    const btn = $("themeToggle");
    if (btn) {
      const icon = btn.querySelector(".theme-toggle-icon");
      const label = btn.querySelector(".theme-toggle-label");
      if (icon) icon.textContent = next === "light" ? "☾" : "☀";
      if (label) label.textContent = next === "light" ? "DARK" : "LIGHT";
      btn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
      btn.title = next === "light" ? "Switch to dark theme" : "Switch to light theme";
    }
    C = PALETTES[next];
    if (state.data) render(state.data);
  }

  function initTheme() {
    const btn = $("themeToggle");
    applyTheme(getTheme(), false);
    if (btn) {
      btn.addEventListener("click", () => applyTheme(getTheme() === "light" ? "dark" : "light", true));
    }
    window.addEventListener("storage", (ev) => {
      if (ev.key === "btc-observer-theme") applyTheme(ev.newValue, false);
    });
  }

  pulseFavicon();
  initTheme();
  tickClock();
  setInterval(tickClock, 1000);
  fetchData();
  setInterval(fetchData, 30000);
})();
