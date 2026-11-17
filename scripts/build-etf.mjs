// Keeps the browser copy in sync with the canonical Worker module.
// static/etf.js is generated: edit functions/_lib/etf.js instead.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "functions/_lib/etf.js");
const dst = path.join(root, "static/etf.js");
const body = fs.readFileSync(src, "utf8");
fs.writeFileSync(dst, body);
console.log(`etf.js: ${body.length} bytes -> static/etf.js`);
