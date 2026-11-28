// The page Caddy answers while the api cannot (deploy/maintenance.html) in the site's own faces: no file can be
// fetched then, so the latin files of Inter and Source Serif 4 that the site serves are written into its one style,
// and that style's hash into the policy of every Caddy file (`style-src 'sha256-...'`), which allows the style and
// nothing else (api/tests/test_deploy.py keeps the two equal).
//
//   npm run maintenance          write the faces into the page and its hash into the Caddy files
//   npm run maintenance:check    fail when either is not what the current faces and page give
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const web = fileURLToPath(new URL("..", import.meta.url));
const PAGE = `${root}deploy/maintenance.html`;
const CADDYFILES = ["deploy/Caddyfile", "deploy/vm/Caddyfile.institute-cert", "deploy/vm/Caddyfile.behind-proxy"].map(
  (path) => `${root}${path}`,
);
const START = "/* faces: the site's own (Inter and Source Serif 4, latin), written in by web/scripts/maintenance.ts */";
const END = "/* end of faces */";

/** A face of the site as its package declares it for latin text, with its file written in. */
function face(family: string, file: string, css: string): string {
  const declared = readFileSync(`${web}node_modules/@fontsource-variable/${css}`, "utf8");
  const name = file.split("/").pop() ?? file;
  const block = new RegExp(`@font-face \\{[^}]*/${name.replace(/\./g, "\\.")}\\)[^}]*\\}`).exec(declared)?.[0];
  const range = block ? /unicode-range: ([^;]+);/.exec(block)?.[1] : undefined;
  if (!range) throw new Error(`No latin face of ${family} in ${css}.`);
  const data = readFileSync(`${web}node_modules/@fontsource-variable/${file}`).toString("base64");
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    "  font-style: normal;",
    "  font-display: swap;",
    "  font-weight: 100 900;",
    `  src: url(data:font/woff2;base64,${data}) format("woff2");`,
    `  unicode-range: ${range};`,
    "}",
  ]
    .map((line) => `      ${line}`)
    .join("\n");
}

/** The page with the current faces written between the two markers of its style. */
function pageWithFaces(page: string): string {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${PAGE}: the markers of the faces are missing.`);
  const faces = [
    face("Inter Variable", "inter/files/inter-latin-wght-normal.woff2", "inter/wght.css"),
    face(
      "Source Serif 4 Variable",
      "source-serif-4/files/source-serif-4-latin-wght-normal.woff2",
      "source-serif-4/wght.css",
    ),
  ].join("\n");
  return `${page.slice(0, start + START.length)}\n${faces}\n      ${page.slice(end)}`;
}

/** The hash of the page's one style, as a Content-Security-Policy names it. */
function styleHash(page: string): string {
  const styles = [...page.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  if (styles.length !== 1) throw new Error(`${PAGE}: one style expected, ${String(styles.length)} found.`);
  return `'sha256-${createHash("sha256")
    .update(styles[0]?.[1] ?? "")
    .digest("base64")}'`;
}

const check = process.argv.includes("--check");
const page = readFileSync(PAGE, "utf8");
const wanted = pageWithFaces(page);
const hash = styleHash(wanted);
const files: [string, string, string][] = [[PAGE, page, wanted]];
for (const path of CADDYFILES) {
  const text = readFileSync(path, "utf8");
  files.push([path, text, text.replace(/style-src '[^']*'/g, `style-src ${hash}`)]);
}
const stale = files.filter(([, now, then]) => now !== then).map(([path]) => path.slice(root.length));
if (check) {
  if (stale.length) {
    console.error(`Not what the faces and the page give: ${stale.join(", ")}. Run \`npm run maintenance\`.`);
    process.exit(1);
  }
  console.log("deploy/maintenance.html and its hash in the Caddy files are current.");
} else {
  for (const [path, now, then] of files) if (now !== then) writeFileSync(path, then);
  console.log(stale.length ? `wrote ${stale.join(", ")}` : "nothing to write");
}
