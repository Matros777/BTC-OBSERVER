// Forecast Scoreboard — renders the daily self-audit of the 24h forecast.
// Data: GET /api/forecast-accuracy (D1, written by the 09:00 UTC cron job).
//   direction hit-rate — did price move the way probUp leaned (next-day close);
//   corridor hit-rate  — did the close land inside the P10–P90 cone (target ≈ 80%);
//   median error (MAE) — |median − fact| / fact;
//   streak             — consecutive verified direction hits, newest first.

const $ = (id) => document.getElementById(id);

const usd = (v) => (v == null ? "--" : "$" + Math.round(v).toLocaleString("en-US"));
const pct = (v, digits = 0) => (v == null ? "--" : (v * 100).toFixed(digits) + "%");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const POS = '<span class="fs-pos">&#9650;</span>';
const NEG = '<span class="fs-neg">&#9660;</span>';

function setCard(id, value, cls) {
  const el = $(id);
  el.textContent = value;
  el.className = "fs-value" + (cls ? " " + cls : "");
}

function renderLast(last) {
  const el = $("fsLast");
  if (!last) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const dir = last.prob_up >= 0.5 ? "UP" : "DOWN";
  const dirMark = last.hit_dir === 1 ? "&#10003;" : "&#10007;";
  const rangeMark = last.in_range === 1 ? "inside &#10003;" : "outside &#10007;";
  el.innerHTML =
    `LAST VERIFIED &#8212; <b>${esc(last.day)}</b>: said <b>${dir}</b> ${pct(last.prob_up)} from ${usd(last.price_now)}, ` +
    `median ${usd(last.median)} (P10 ${usd(last.p10)} &#8211; P90 ${usd(last.p90)}) &#8594; ` +
    `fact ${usd(last.fact_price)} &#183; direction ${dirMark} &#183; corridor ${rangeMark} &#183; err ${(last.mae_pct ?? 0).toFixed(2)}%`;
}

function renderTable(history) {
  const rows = (history || []).map((r) => {
    const pending = !r.verified;
    const forecast = `${usd(r.median)} <span class="fs-dim">&#183; ${usd(r.p10)}&#8211;${usd(r.p90)}</span>`;
    const fact = pending ? "--" : usd(r.fact_price);
    const dir = pending
      ? `<span class="fs-pending">p=${Math.round((r.prob_up || 0) * 100)}%</span>`
      : r.hit_dir === 1
        ? POS
        : r.hit_dir === 0
          ? NEG
          : "--";
    const range = pending
      ? '<span class="fs-pending">waiting</span>'
      : r.in_range === 1
        ? '<span class="fs-pos">inside</span>'
        : r.in_range === 0
          ? '<span class="fs-neg">outside</span>'
          : "--";
    const err = r.mae_pct == null ? "--" : r.mae_pct.toFixed(2) + "%";
    return (
      `<tr class="${pending ? "fs-pending-row" : ""}">` +
      `<td>${esc(r.day)}</td><td>${forecast}</td><td>${fact}</td><td>${dir}</td><td>${range}</td><td>${err}</td></tr>`
    );
  });
  $("fsBody").innerHTML =
    rows.join("") || '<tr><td colspan="6" class="fs-empty">No snapshots yet.</td></tr>';
}

function render(data) {
  if (!data || data.ok !== true) {
    $("fsMeta").textContent = "SCOREBOARD UNAVAILABLE";
    $("fsBody").innerHTML =
      '<tr><td colspan="6" class="fs-empty">Scoreboard data is not available right now.</td></tr>';
    return;
  }
  const s = data.summary || {};
  const verified = s.verified || 0;
  const total = s.total || 0;

  $("fsMeta").textContent = `${verified}/${total} DAYS VERIFIED · DAILY 09:00 UTC`;

  if (total === 0) {
    setCard("fsHit", "--", "");
    $("fsHitSub").textContent = "first snapshot at the next 09:00 UTC run";
    setCard("fsCal", "--", "");
    setCard("fsMae", "--", "");
    setCard("fsStreak", "--", "");
    $("fsBody").innerHTML =
      '<tr><td colspan="6" class="fs-empty">The scoreboard starts filling after the first 09:00 UTC run — first honest numbers appear within a few days.</td></tr>';
    return;
  }

  const hitCls = s.hit_rate == null ? "" : s.hit_rate >= 0.5 ? "fs-pos" : "fs-neg";
  setCard("fsHit", pct(s.hit_rate), hitCls);
  $("fsHitSub").textContent = `n = ${verified} verified day${verified === 1 ? "" : "s"}`;

  const calCls =
    s.in_range_rate == null ? "" : s.in_range_rate >= 0.75 ? "fs-pos" : s.in_range_rate < 0.6 ? "fs-neg" : "";
  setCard("fsCal", pct(s.in_range_rate), calCls);

  setCard("fsMae", s.mae_avg == null ? "--" : s.mae_avg.toFixed(2) + "%", "");

  const streak = s.streak || 0;
  setCard(
    "fsStreak",
    verified ? (streak > 0 ? streak + " ✓" : "0") : "--",
    verified ? (streak > 0 ? "fs-pos" : "fs-neg") : ""
  );

  renderLast(data.last);
  renderTable(data.history);
}

async function load() {
  try {
    const res = await fetch("/api/forecast-accuracy", { headers: { Accept: "application/json" } });
    render(await res.json());
  } catch {
    $("fsMeta").textContent = "SCOREBOARD OFFLINE";
  }
}

load();
