// Every text file of the build compressed with Brotli at its strongest, once, beside it (`<file>.br`), for the server
// to send to a browser that accepts it (api/idtrack_web_api/frontend.py; gzip is made by the server itself). Brotli
// gives 10 to 15 % fewer bytes than gzip on the page's scripts and styles; made here, at build time, its cost is paid
// once. A file whose Brotli form would not be smaller, or that is under 512 bytes, gets none.
//
//   node scripts/compress.ts            after `vite build` (npm run build runs it)
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

/** The suffixes the server sends compressed (api/idtrack_web_api/frontend.py, COMPRESSED_SUFFIXES), source maps aside. */
const TEXT = new Set([".html", ".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml", ".webmanifest", ".ico"]);
const SMALLEST = 512;

const dist = fileURLToPath(new URL("../dist", import.meta.url));
let files = 0;
let before = 0;
let after = 0;
const walk = (folder: string): void => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (name.endsWith(".br")) {
      rmSync(path); // of an earlier build in the same folder: made again below where it is still wanted
      continue;
    }
    if (!TEXT.has(extname(name)) || name === "index.html") continue; // the page is sent with the server's answers in
    const data = readFileSync(path);
    if (data.length < SMALLEST) continue;
    const packed = brotliCompressSync(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    });
    if (packed.length >= data.length) continue;
    writeFileSync(`${path}.br`, packed);
    files += 1;
    before += data.length;
    after += packed.length;
  }
};
walk(dist);
console.log(`wrote ${String(files)} Brotli files: ${(before / 1024).toFixed(1)} KB as ${(after / 1024).toFixed(1)} KB`);
