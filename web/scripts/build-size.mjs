// The size of the production build (dist/): every file, raw and gzip-compressed, and the totals of what a first
// visit loads (the page, its script and style; fonts are loaded per script of text, Latin only for most readers).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const files = [];
const walk = (folder) => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (!name.endsWith(".map")) files.push(path);
  }
};
walk(dist);
const rows = files
  .map((path) => {
    const bytes = readFileSync(path);
    return { file: relative(dist, path), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  })
  .sort((a, b) => b.raw - a.raw);
const kb = (n) => (n / 1024).toFixed(1).padStart(8);
for (const row of rows) console.log(`${kb(row.raw)} KiB ${kb(row.gzip)} KiB gzip  ${row.file}`);
const first = rows.filter((r) => /\.(html|js|css)$/.test(r.file) || /latin-wght-normal/.test(r.file));
const sum = (list, key) => list.reduce((n, r) => n + r[key], 0);
console.log(
  `${kb(sum(rows, "raw"))} KiB ${kb(sum(rows, "gzip"))} KiB gzip  all files (${rows.length}, source maps left out)`,
);
console.log(
  `${kb(sum(first, "raw"))} KiB ${kb(sum(first, "gzip"))} KiB gzip  a first visit (page, script, style, Latin fonts)`,
);
