// Fails when a stylesheet of the app styles a class that no code of the app names: a rule left from a part that was
// replaced or removed (no stale code, README "Code"). Every class selector of src/**/*.css is looked for in the code
// (src/**/*.ts, *.tsx and index.html) as a whole word; a class the code builds from a variable is named by the
// template it is built in (`load-dot--${state}` names every class that begins with `load-dot--`), so no list of
// exceptions is kept.
//
//   node scripts/unused-classes.ts    the classes styled and never named, by file and line; exit 1 when any
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const src = join(root, "src");

function files(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, keep));
    else if (keep(name)) out.push(path);
  }
  return out;
}

/** The class selectors of a stylesheet with the line each is first styled at (comments and strings left out). */
export function classesOf(css: string): Map<string, number> {
  const found = new Map<string, number>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/"[^"\n]*"|'[^'\n]*'/g, '""');
  let line = 1;
  let depth = 0;
  let selector = "";
  let selectorLine = 1;
  for (const ch of text) {
    if (ch === "\n") line++;
    if (ch === "{") {
      // A block's head is a selector unless it is an at-rule's (@media, @keyframes, @supports …).
      if (!selector.trim().startsWith("@") && !/^\s*(from|to|\d+%)\s*$/.test(selector)) {
        for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          const name = m[1] ?? "";
          if (!found.has(name)) found.set(name, selectorLine);
        }
      }
      depth++;
      selector = "";
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      selector = "";
      continue;
    }
    if (ch === ";") {
      selector = "";
      continue;
    }
    if (!selector.trim()) selectorLine = line;
    selector += ch;
  }
  return found;
}

/** The names the code gives: every word that can be a class, and the beginnings of the classes it builds. */
export function namesOf(code: string): { words: Set<string>; prefixes: string[] } {
  const words = new Set(code.match(/[\w-]+/g) ?? []);
  const prefixes = new Set<string>();
  // `name--${x}`, `name--row${x}` and the like in a template; "name--" + x in a concatenation.
  for (const m of code.matchAll(/([A-Za-z][\w-]*)\$\{/g)) prefixes.add(m[1] ?? "");
  for (const m of code.matchAll(/["'`]([A-Za-z][\w-]*)["'`]\s*\+/g)) prefixes.add(m[1] ?? "");
  return { words, prefixes: [...prefixes].filter((p) => p.length > 2) };
}

export function unusedClasses(): { file: string; line: number; name: string }[] {
  const code = [
    ...files(src, (n) => /\.(ts|tsx)$/.test(n)).map((f) => readFileSync(f, "utf8")),
    readFileSync(join(root, "index.html"), "utf8"),
  ].join("\n");
  const { words, prefixes } = namesOf(code);
  const out: { file: string; line: number; name: string }[] = [];
  for (const file of files(src, (n) => n.endsWith(".css")).sort()) {
    for (const [name, line] of classesOf(readFileSync(file, "utf8"))) {
      if (words.has(name) || prefixes.some((p) => name.startsWith(p))) continue;
      out.push({ file: relative(root, file), line, name });
    }
  }
  return out;
}

if (import.meta.main) {
  const unused = unusedClasses();
  for (const u of unused) console.log(`${u.file}:${u.line}: .${u.name} is styled but never named in src`);
  console.log(unused.length ? `${unused.length} classes styled and never named` : "every class styled is named");
  process.exit(unused.length ? 1 : 0);
}
