// The size of the production build (dist/): every file, raw and gzip-compressed; what a first visit of the home loads
// (index.html, every file it names: its script, the scripts it preloads, its style; and the Latin faces of the three
// fonts at their normal style, which a page in English uses); and the scripts loaded only when a page needs them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const files: string[] = [];
const walk = (folder: string): void => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (!name.endsWith(".map")) files.push(path);
  }
};
walk(dist);
interface Row {
  file: string;
  raw: number;
  gzip: number;
}
const rows = files
  .map((path): Row => {
    const bytes = readFileSync(path);
    return { file: relative(dist, path), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  })
  .sort((a, b) => b.raw - a.raw);
const kb = (n: number): string => (n / 1024).toFixed(1).padStart(8);
for (const row of rows) console.log(`${kb(row.raw)} KiB ${kb(row.gzip)} KiB gzip  ${row.file}`);
const page = readFileSync(join(dist, "index.html"), "utf8");
const named = new Set(
  [...page.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1] ?? "").filter((f) => /\.(js|css)$/.test(f)),
);
const first = rows.filter(
  (r) =>
    r.file === "index.html" || named.has(r.file) || /^assets\/[a-z-]+-latin-wght-normal-[^/]+\.woff2$/.test(r.file),
);
const later = rows.filter((r) => r.file.endsWith(".js") && !named.has(r.file));
const sum = (list: Row[], key: "raw" | "gzip"): number => list.reduce((n, r) => n + r[key], 0);
console.log(
  `${kb(sum(rows, "raw"))} KiB ${kb(sum(rows, "gzip"))} KiB gzip  all files (${rows.length}, source maps left out)`,
);
console.log(
  `${kb(sum(first, "raw"))} KiB ${kb(sum(first, "gzip"))} KiB gzip  a first visit of the home (${first.length} files: the page, the files it names, the Latin faces of its fonts)`,
);
console.log(
  `${kb(sum(later, "raw"))} KiB ${kb(sum(later, "gzip"))} KiB gzip  scripts loaded when a page needs them (${later.length}; the largest ${kb(later[0]?.raw ?? 0).trim()} KiB)`,
);
