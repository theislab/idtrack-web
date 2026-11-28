// The third-party software and fonts a visitor's browser receives, generated from the production bundle itself: Vite
// builds the site in memory (nothing is written), and every package of node_modules whose code or files are in the
// bundle (its modules, its fonts) is listed with its version, its licence as its package.json declares it, and its
// licence text, copied as the package ships it to public/licences/<package>.txt, so that the site serves each text
// beside what it covers (the licences page links them). Nothing is listed by hand.
//
//   npm run licences          write src/generated/licences.json and public/licences/
//   npm run licences:check    fail when either is not what the current bundle gives
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { build, type Rolldown } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = `${root}src/generated/licences.json`;
const texts = `${root}public/licences`;

export interface Licensed {
  name: string;
  version: string;
  /** The licence as the package declares it (an SPDX expression). */
  license: string;
  description: string;
  /** The package's home page or repository. */
  url: string;
  /** The first copyright line of its licence text, as written there (empty where the text names none). */
  copyright: string;
  /** Where the site serves its licence text. */
  text: string;
  /** Whether it is a font (its files are fonts, as the bundle holds them). */
  font: boolean;
  /** A font's family, as its package's metadata names it (empty for software). */
  family: string;
}

/** The package a path inside node_modules belongs to (`@scope/name` or `name`), or null. */
export function packageOf(path: string): string | null {
  const parts = `/${path.replaceAll("\\", "/")}`.split("/node_modules/");
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  if (!last) return null;
  const found = /^((?:@[^/]+\/)?[^/]+)/.exec(last);
  return found?.[1] ?? null;
}

/** The file the site serves a package's licence text as. */
export function textFile(name: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}.txt`;
}

/** The first line of a licence text that states a copyright ("Copyright" then a sign or a year, or a sign then a
 *  year; never the licence's own words about copyright notices). */
export function copyrightOf(text: string): string {
  const line = text
    .split(/\r?\n/)
    .find((l) => /^\s*copyright\s+(\(c\)|©|\d{4})/i.test(l) || /^\s*(\(c\)|©)\s*\d{4}/i.test(l));
  return line ? line.trim().replace(/\s+/g, " ") : "";
}

function url(manifest: { homepage?: string; repository?: string | { url?: string } }, name: string): string {
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  const raw = manifest.homepage ?? repository ?? `https://www.npmjs.com/package/${name}`;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/#readme$/, "");
}

/** A font package's family, from its metadata (Fontsource's `metadata.json`), else its name. */
function familyOf(folder: string): string {
  try {
    const meta = JSON.parse(readFileSync(`${folder}/metadata.json`, "utf8")) as { family?: unknown };
    if (typeof meta.family === "string") return meta.family;
  } catch {
    // No metadata: the package's name stands for the family.
  }
  return folder.split("/").pop() ?? "";
}

/** The packages whose code or files the production bundle holds, and whether each gave the bundle a font. */
async function bundled(): Promise<Map<string, boolean>> {
  const result = await build({ root, logLevel: "silent", build: { write: false, sourcemap: false, manifest: false } });
  const outputs = (Array.isArray(result) ? result : [result as Rolldown.RolldownOutput]).flatMap((o) => o.output);
  const found = new Map<string, boolean>();
  for (const item of outputs) {
    if (item.type === "chunk") {
      for (const id of item.moduleIds) {
        const name = packageOf(id);
        if (name && !found.has(name)) found.set(name, false);
      }
    } else {
      for (const file of item.originalFileNames) {
        const name = packageOf(file);
        if (name) found.set(name, /\.(woff2?|ttf|otf)$/.test(file) || found.get(name) === true);
      }
    }
  }
  return found;
}

/** Each package's entry and its licence text. */
async function described(): Promise<{ list: Licensed[]; files: Map<string, string> }> {
  const list: Licensed[] = [];
  const files = new Map<string, string>();
  for (const [name, font] of [...(await bundled())].sort(([a], [b]) => a.localeCompare(b))) {
    const folder = `${root}node_modules/${name}`;
    const manifest = JSON.parse(readFileSync(`${folder}/package.json`, "utf8")) as {
      version: string;
      license?: string;
      description?: string;
      homepage?: string;
      repository?: string | { url?: string };
    };
    const licenceFile = readdirSync(folder).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
    if (!licenceFile) throw new Error(`${name} ships no licence text`);
    if (!manifest.license) throw new Error(`${name} declares no licence`);
    const text = readFileSync(`${folder}/${licenceFile}`, "utf8");
    files.set(textFile(name), text);
    list.push({
      name,
      version: manifest.version,
      license: manifest.license,
      description: (manifest.description ?? "").trim(),
      url: url(manifest, name),
      copyright: copyrightOf(text),
      text: `/licences/${textFile(name)}`,
      font,
      family: font ? familyOf(folder) : "",
    });
  }
  return { list, files };
}

async function document(list: Licensed[]): Promise<string> {
  const value = {
    about: "Generated by scripts/licences.ts from the production bundle: do not edit.",
    packages: list,
  };
  return format(JSON.stringify(value), { ...(await resolveConfig(target)), filepath: target });
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const { list, files } = await described();
  const json = await document(list);
  if (check) {
    const stale: string[] = [];
    if (!existsSync(target) || (await readFile(target, "utf8")) !== json) stale.push("src/generated/licences.json");
    const present = existsSync(texts) ? readdirSync(texts) : [];
    for (const [file, text] of files)
      if (!present.includes(file) || readFileSync(`${texts}/${file}`, "utf8") !== text)
        stale.push(`public/licences/${file}`);
    for (const file of present) if (!files.has(file)) stale.push(`public/licences/${file} (no longer in the bundle)`);
    if (stale.length) {
      console.error(`Not what the bundle gives (npm run licences): ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log(`licences: ${String(list.length)} packages, current`);
    return;
  }
  await writeFile(target, json);
  await rm(texts, { recursive: true, force: true });
  await mkdir(texts, { recursive: true });
  for (const [file, text] of files) await writeFile(`${texts}/${file}`, text);
  console.log(`wrote src/generated/licences.json and public/licences/: ${String(list.length)} packages`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
