#!/usr/bin/env node
/**
 * BTC Observer — daily ETF flow sync.
 *
 * farside.co.uk sits behind a Cloudflare challenge, so it cannot be fetched by
 * the Worker, by GitHub Actions or by plain curl. A real Chrome session passes
 * the challenge, so this script drives the already running browser over CDP,
 * parses the flow table, merges the days into static/etf-live.json and commits
 * the file through the GitHub API. The push triggers the Cloudflare auto-deploy.
 *
 * Usage (asus):
 *   DISPLAY=:0 node scripts/etf_sync.mjs            # sync + commit
 *   node scripts/etf_sync.mjs --dry-run             # parse + show diff only
 *   node scripts/etf_sync.mjs --seed                # print parsed days as JSON
 *
 * Env:
 *   GITHUB_TOKEN      token with contents:write (or ~/.config/btc-observer/github_token)
 *   CDP_URL           default http://127.0.0.1:9222
 *   PLAYWRIGHT_DIR    where playwright-core is installed (default /tmp/cf-inspect)
 *   CHROME_PROFILE    profile used when Chrome has to be started
 *   REPO / BRANCH     default Matros777/BTC-OBSERVER / main
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const REPO = process.env.REPO || "Matros777/BTC-OBSERVER";
const BRANCH = process.env.BRANCH || "main";
const FILE = "static/etf-live.json";
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const CDP_PORT = Number(new URL(CDP_URL).port || 9222);
const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR || "/tmp/cf-inspect";
const CHROME_PROFILE = process.env.CHROME_PROFILE || path.join(os.homedir(), ".config/chrome-btc-profile");
const FARSIDE = "https://farside.co.uk/btc/";
const TOKEN_FILE = process.env.GITHUB_TOKEN_FILE || path.join(os.homedir(), ".config/btc-observer/github_token");

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const SEED_ONLY = args.has("--seed");

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const log = (...a) => console.log(new Date().toISOString(), ...a);

function requirePlaywright() {
  const req = createRequire(path.join(PLAYWRIGHT_DIR, "package.json"));
  return req("playwright-core");
}

function num(raw) {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const neg = s.startsWith("(") && s.endsWith(")");
  const v = Number(s.replace(/[()]/g, ""));
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

function toDay(label) {
  const m = String(label).trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

/** rows -> { "YYYY-MM-DD": { total, ibit, fbtc, src } } */
export function rowsToDays(rows) {
  const days = {};
  let col = null;
  for (const row of rows) {
    if (!col) {
      const idx = {};
      row.forEach((cell, i) => {
        const name = String(cell || "").trim().toUpperCase();
        if (name) idx[name] = i;
      });
      if (idx.IBIT !== undefined) {
        col = { ibit: idx.IBIT, fbtc: idx.FBTC ?? idx.IBIT + 1, total: row.length - 1 };
      }
      continue;
    }
    const day = toDay(row[0]);
    if (!day) continue;
    const total = num(row[col.total]);
    const ibit = num(row[col.ibit]);
    const fbtc = num(row[col.fbtc]);
    // farside renders "-" until a day is final; a pending row has no IBIT/FBTC
    // values at all (only a placeholder 0.0 total), so skip it instead of
    // storing a fake zero-flow day.
    if (ibit === null && fbtc === null) continue;
    days[day] = { total: total ?? 0, ibit, fbtc, src: "farside" };
  }
  return days;
}

async function cdpAlive() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureChrome() {
  if (await cdpAlive()) return false;
  log("Chrome CDP is down, starting it");
  const child = spawn("google-chrome", [
    `--user-data-dir=${CHROME_PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-position=-32000,-32000",
    ...(process.env.DISPLAY ? [] : ["--headless=new"]),
    "about:blank",
  ], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await cdpAlive()) return true;
  }
  throw new Error("Chrome did not expose CDP on " + CDP_URL);
}

async function scrape() {
  const { chromium } = requirePlaywright();
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  const readRows = () =>
    page.$$eval("table tr", (trs) =>
      trs.map((tr) => [...tr.querySelectorAll("th,td")].map((td) => td.textContent.trim())));

  try {
    await page.goto(FARSIDE, { waitUntil: "domcontentloaded", timeout: 60000 });
    // A Cloudflare interstitial has no flow table. Poll: a real browser usually
    // clears it in a few seconds, sometimes after one reload.
    let rows = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let wait = 0; wait < 10; wait++) {
        rows = await readRows().catch(() => []);
        if (rowsToDays(rows) && Object.keys(rowsToDays(rows)).length) break;
        await page.waitForTimeout(1500);
      }
      if (Object.keys(rowsToDays(rows) || {}).length) break;
      log(`challenge or empty table (attempt ${attempt + 1}), reloading`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }
    const days = rowsToDays(rows);
    if (!Object.keys(days).length) throw new Error("no flow rows parsed (challenge page?)");
    return days;
  } finally {
    await page.close().catch(() => {});
  }
}

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    throw new Error(`GitHub token not found (${TOKEN_FILE}) and GITHUB_TOKEN is empty`);
  }
}

async function gh(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "btc-observer-etf-sync",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function commitDays(days, token) {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  let current = null;
  let currentPayload = { updated: null, days: {} };
  try {
    current = await gh("GET", `${url}?ref=${BRANCH}`, token);
    currentPayload = JSON.parse(Buffer.from(current.content, "base64").toString("utf8"));
  } catch (err) {
    if (!String(err.message).includes("404")) throw err;
  }

  const merged = { ...(currentPayload.days || {}) };
  const added = [];
  for (const [day, item] of Object.entries(days)) {
    const prev = merged[day];
    if (prev && Math.abs(Number(prev.total) - item.total) < 0.05 && Number(prev.ibit ?? 0) === Number(item.ibit ?? 0)) continue;
    merged[day] = item;
    added.push(day);
  }

  const payload = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "farside.co.uk/btc (browser session, asus)",
    days: Object.fromEntries(Object.keys(merged).sort().map((d) => [d, merged[d]])),
  };

  if (!added.length) return { changed: false, payload, added };

  const body = {
    message: `data(etf): sync ${added.join(", ")}`,
    content: Buffer.from(JSON.stringify(payload, null, 2) + "\n").toString("base64"),
    branch: BRANCH,
  };
  if (current && current.sha) body.sha = current.sha;
  await gh("PUT", url, token, body);
  return { changed: true, payload, added };
}

async function main() {
  await ensureChrome();
  const days = await scrape();
  const list = Object.keys(days).sort();
  log(`parsed ${list.length} days: ${list[0]} .. ${list[list.length - 1]}`);

  if (SEED_ONLY) {
    console.log(JSON.stringify({ days }, null, 2));
    return;
  }

  const token = DRY ? null : readToken();
  if (DRY) {
    log("dry run: no commit");
    console.log(JSON.stringify({ days }, null, 2));
    return;
  }
  const result = await commitDays(days, token);
  if (!result.changed) {
    log("no new days, nothing committed");
    return;
  }
  log(`committed ${result.added.join(", ")} -> ${REPO}@${BRANCH}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntry) {
  main().catch((err) => {
    console.error(new Date().toISOString(), "FAIL:", err.message);
    process.exit(1);
  });
}
