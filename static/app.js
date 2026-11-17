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

  function drawPriceChart(data) {
    const canvas = $("priceChart");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const chart = data.chart;
    const candles = chart.candles || [];
    if (!candles.length) return;

    const padL = 10, padR = 66, padT = 12, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const forecast = data.prediction && data.prediction.path ? data.prediction.path : [];
    const total = candles.length + Math.max(0, forecast.length - 1);

    let min = Infinity, max = -Infinity;
    for (const k of candles) { if (k.l < min) min = k.l; if (k.h > max) max = k.h; }
    for (let i = 0; i < chart.bb_lower.length; i++) {
      const lo = chart.bb_lower[i], hi = chart.bb_upper[i];
      if (lo !== null && lo < min) min = lo;
      if (hi !== null && hi > max) max = hi;
    }
    if (forecast.length) {
      const last = candles[candles.length - 1].c;
      const p10 = data.prediction.p10, p90 = data.prediction.p90;
      min = Math.min(min, p10, last);
      max = Math.max(max, p90, last);
    }
    const pad = (max - min) * 0.06 || 1;
    min -= pad; max += pad;
    const xOf = (i) => padL + (i / Math.max(1, total - 1)) * plotW;
    const yOf = (v) => padT + (1 - (v - min) / (max - min || 1)) * plotH;

    // grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.font = "9px " + getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = C.dim;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      const val = max - ((max - min) * i) / 4;
      ctx.textAlign = "left";
      ctx.fillText(fmtMoney(val, 0), w - padR + 8, y + 3);
    }
    const stepX = Math.max(1, Math.floor(total / 7));
    for (let i = 0; i < total; i += stepX) {
      const x = xOf(i);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      const c = candles[Math.min(i, candles.length - 1)];
      if (c) {
        ctx.textAlign = "center";
        ctx.fillStyle = C.dim;
        ctx.fillText(dateLabel(c.t) + " " + timeLabel(c.t), x, h - 6);
      }
    }

    // bollinger band fill
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < chart.bb_upper.length; i++) {
      const v = chart.bb_upper[i];
      if (v === null) continue;
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    for (let i = chart.bb_lower.length - 1; i >= 0; i--) {
      const v = chart.bb_lower[i];
      if (v === null) continue;
      ctx.lineTo(xOf(i), yOf(v));
    }
    ctx.closePath();
    ctx.fillStyle = alpha(C.cyan, 0.08);
    ctx.fill();
    ctx.strokeStyle = alpha(C.cyan, 0.30);
    ctx.lineWidth = 1;
    ctx.stroke();

    // candles
    const cw = Math.max(1, (plotW / total) * 0.62);
    for (let i = 0; i < candles.length; i++) {
      const k = candles[i];
      const up = k.c >= k.o;
      const color = up ? C.neon : C.pink;
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(k.h));
      ctx.lineTo(x, yOf(k.l));
      ctx.stroke();
      const yo = yOf(k.o), yc = yOf(k.c);
      const top = Math.min(yo, yc), height = Math.max(1, Math.abs(yc - yo));
      ctx.fillRect(x - cw / 2, top, cw, height);
    }
    ctx.globalAlpha = 1;

    // EMAs
    const drawSeries = (series, color, width, glow) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < series.length; i++) {
        const v = series[i];
        if (v === null) { started = false; continue; }
        const x = xOf(i), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    drawSeries(chart.ema20, C.cyan, 1.4, 6);
    drawSeries(chart.ema50, C.pink, 1.4, 6);
    drawSeries(chart.ema200, C.yellow, 1.4, 6);

    // forecast cone + path
    if (forecast.length > 1) {
      const baseIndex = candles.length - 1;
      const p10 = data.prediction.p10, p90 = data.prediction.p90;
      const half = Math.max(0, (p90 - p10) / 2);
      ctx.beginPath();
      for (let i = 1; i < forecast.length; i++) {
        const x = xOf(baseIndex + i);
        const y = yOf(forecast[i] + half * (i / (forecast.length - 1)));
        if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = forecast.length - 1; i >= 1; i--) {
        const x = xOf(baseIndex + i);
        const y = yOf(forecast[i] - half * (i / (forecast.length - 1)));
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = alpha(C.neon, 0.07);
      ctx.fill();
      ctx.strokeStyle = alpha(C.neon, 0.22);
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      for (let i = 0; i < forecast.length; i++) {
        const x = xOf(baseIndex + i);
        const y = yOf(forecast[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = C.neon;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = C.neon;
      ctx.shadowBlur = 10;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // NOW divider
      const xNow = xOf(baseIndex);
      ctx.strokeStyle = C.lineStrong;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(xNow, padT); ctx.lineTo(xNow, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.dim;
      ctx.textAlign = "center";
      ctx.fillText("NOW", xNow, padT - 2);
    }

    // last price line
    const last = candles[candles.length - 1];
    const yLast = yOf(last.c);
    ctx.strokeStyle = alpha(C.neon, 0.45);
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(padL, yLast); ctx.lineTo(w - padR, yLast); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.neon;
    ctx.textAlign = "left";
    ctx.fillText(fmtMoney(last.c, 0), w - padR + 8, yLast + 3);

    // hover crosshair
    if (state.hover && state.hover.chart === "price") {
      const i = Math.max(0, Math.min(candles.length - 1, state.hover.index));
      const x = xOf(i);
      ctx.strokeStyle = C.lineStrong;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawRSI(data) {
    const canvas = $("rsiChart");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const series = data.chart.rsi || [];
    const padL = 8, padR = 8, padT = 10, padB = 14;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const xOf = (i) => padL + (i / Math.max(1, series.length - 1)) * plotW;
    const yOf = (v) => padT + (1 - v / 100) * plotH;

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    [30, 50, 70].forEach((level) => {
      const y = yOf(level);
      ctx.strokeStyle = level === 50 ? C.gridStrong : C.grid;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = C.dim;
      ctx.font = "8px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "left";
      ctx.fillText(String(level), padL + 2, y - 2);
    });

    // fill under
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v === null) continue;
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    if (started) {
      ctx.lineTo(xOf(series.length - 1), padT + plotH);
      ctx.lineTo(xOf(0), padT + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, "rgba(178,107,255,0.18)");
      grad.addColorStop(1, "rgba(178,107,255,0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.strokeStyle = C.purple;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = C.purple;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v === null) { started = false; continue; }
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawMACD(data) {
    const canvas = $("macdChart");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const line = data.chart.macd || [];
    const sig = data.chart.macd_signal || [];
    const hist = data.chart.macd_hist || [];
    const padL = 8, padR = 8, padT = 10, padB = 14;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    let min = Infinity, max = -Infinity;
    for (const arr of [line, sig, hist]) {
      for (const v of arr) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = -1; max = 1; }
    const pad = (max - min) * 0.1 || 1;
    min -= pad; max += pad;
    const xOf = (i) => padL + (i / Math.max(1, line.length - 1)) * plotW;
    const yOf = (v) => padT + (1 - (v - min) / (max - min || 1)) * plotH;
    const y0 = yOf(0);

    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(w - padR, y0); ctx.stroke();

    const bw = Math.max(1, (plotW / Math.max(1, hist.length)) * 0.55);
    for (let i = 0; i < hist.length; i++) {
      const v = hist[i];
      if (v === null) continue;
      const x = xOf(i);
      const y = yOf(v);
      ctx.fillStyle = v >= 0 ? alpha(C.neon, 0.55) : alpha(C.pink, 0.55);
      ctx.fillRect(x - bw / 2, Math.min(y, y0), bw, Math.max(1, Math.abs(y - y0)));
    }

    const draw = (arr, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 7;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v === null) { started = false; continue; }
        const x = xOf(i), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    draw(line, C.cyan);
    draw(sig, C.pink);
  }

  function drawVolume(data) {
    const canvas = $("volumeChart");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const candles = data.chart.candles || [];
    const vols = data.chart.volume || [];
    const padL = 8, padR = 8, padT = 10, padB = 14;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const max = Math.max(...vols.filter((v) => Number.isFinite(v)), 1);
    const bw = Math.max(1, (plotW / Math.max(1, vols.length)) * 0.6);
    for (let i = 0; i < vols.length; i++) {
      const k = candles[i];
      if (!k) continue;
      const x = padL + (i / Math.max(1, vols.length - 1)) * plotW;
      const bh = (vols[i] / max) * plotH;
      const up = k.c >= k.o;
      ctx.fillStyle = up ? alpha(C.neon, 0.42) : alpha(C.pink, 0.42);
      ctx.fillRect(x - bw / 2, padT + plotH - bh, bw, bh);
    }
    ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(w - padR, padT + plotH); ctx.stroke();
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
        <div class="signal-note">score ${s.score >= 0 ? "+" : ""}${s.score.toFixed(2)} · weight ${s.weight}</div>
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
        ctx.font = "7px " + getComputedStyle(document.body).fontFamily;
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

  function attachTooltip() {
    const canvas = $("priceChart");
    const tip = $("tooltip");
    canvas.addEventListener("mousemove", (ev) => {
      if (!state.data) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const padL = 10, padR = 66;
      const plotW = rect.width - padL - padR;
      const candles = state.data.chart.candles;
      const total = candles.length + (state.data.prediction.path.length - 1);
      const idx = Math.round(((x - padL) / plotW) * (total - 1));
      if (idx < 0 || idx >= candles.length) {
        tip.classList.add("hidden");
        state.hover = null;
        drawPriceChart(state.data);
        return;
      }
      const k = candles[idx];
      state.hover = { chart: "price", index: idx };
      const up = k.c >= k.o;
      tip.innerHTML = `
        <b>${new Date(k.t).toLocaleString("en-GB")}</b><br>
        O ${fmtMoney(k.o, 1)} · H ${fmtMoney(k.h, 1)}<br>
        L ${fmtMoney(k.l, 1)} · C <span class="${up ? "up" : "down"}">${fmtMoney(k.c, 1)}</span><br>
        VOL ${fmtCompact(k.v)} BTC
      `;
      tip.style.left = Math.min(rect.width - 170, Math.max(8, x + 12)) + "px";
      tip.style.top = Math.max(8, ev.clientY - rect.top - 20) + "px";
      tip.classList.remove("hidden");
      drawPriceChart(state.data);
    });
    canvas.addEventListener("mouseleave", () => {
      tip.classList.add("hidden");
      state.hover = null;
      if (state.data) drawPriceChart(state.data);
    });
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
  attachTooltip();
  initTheme();
  tickClock();
  setInterval(tickClock, 1000);
  fetchData();
  setInterval(fetchData, 30000);
})();
