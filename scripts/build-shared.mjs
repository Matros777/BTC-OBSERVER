// Keeps the browser copies in sync with the canonical Worker modules.
// static/*.js is generated: edit functions/_lib/*.js instead.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
for (const name of ["etf.js", "analysis.js"]) {
  const src = path.join(root, "functions/_lib", name);
  const dst = path.join(root, "static", name);
  const body = fs.readFileSync(src, "utf8");
  fs.writeFileSync(dst, body);
  console.log(`${name}: ${body.length} bytes -> static/${name}`);
}
