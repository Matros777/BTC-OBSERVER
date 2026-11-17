#!/usr/bin/env node
/**
 * Server-side ETF sync for GitHub Actions.
 *
 * Tries to read farside.co.uk without a browser. Datacenter IPs are often
 * stopped by the Cloudflare challenge; when that happens the script exits
 * cleanly without touching the data file and the last known days stay live.
 *
 * The browser-based equivalent for a residential IP is scripts/etf_sync.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { rowsToDays } from "./etf_sync.mjs";

const FILE = path.join(process.cwd(), "static/etf-live.json");
const FARSIDE = "https://farside.co.uk/btc/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const log = (...a) => console.log(new Date().toISOString(), ...a);

export function parseHtml(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());
    if (cells.length) rows.push(cells);
  }
  return rowsToDays(rows);
}

async function main() {
  const res = await fetch(FARSIDE, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    redirect: "follow",
  });
  const html = await res.text();
  log(`farside HTTP ${res.status}, ${html.length} bytes`);

  if (!res.ok) {
    log("source blocked for this egress IP — keeping the committed dataset");
    return;
  }

  const days = parseHtml(html);
  const keys = Object.keys(days).sort();
  if (!keys.length) {
    log("no flow rows parsed (challenge page?) — keeping the committed dataset");
    return;
  }
  log(`parsed ${keys.length} days: ${keys[0]} .. ${keys[keys.length - 1]}`);

  let payload = { updated: null, days: {} };
  try {
    payload = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { /* first run */ }

  const merged = { ...(payload.days || {}) };
  const added = [];
  for (const [day, item] of Object.entries(days)) {
    const prev = merged[day];
    if (prev && Number(prev.total) === item.total && Number(prev.ibit ?? 0) === Number(item.ibit ?? 0)) continue;
    merged[day] = item;
    added.push(day);
  }
  if (!added.length) {
    log("no new days, nothing to write");
    return;
  }

  const out = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "farside.co.uk/btc (GitHub Actions)",
    days: Object.fromEntries(Object.keys(merged).sort().map((d) => [d, merged[d]])),
  };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
  log(`updated ${added.join(", ")}`);
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isEntry) {
  main().catch((err) => {
    console.error(new Date().toISOString(), "FAIL:", err.message);
    process.exit(1);
  });
}
