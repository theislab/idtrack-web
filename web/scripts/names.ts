// The tool's name in every text a person reads of the pages and the repository's documents: IDTrack in prose,
// `idtrack` only where it is code. The texts the api serves are held to the same rule by api/tests/test_names.py.
//
//   npm run names            print each bare name as <file>:<line>: <its text>; exit status 1 when there is any
//
// Read: the pages' words (every JSX text of web/src, and the attributes a person reads or hears: title, alt,
// aria-label, aria-description, placeholder), outside code (<code>, <pre>, <kbd>, <samp> and the page's <Mono>); and
// every Markdown file of the repository, outside code spans and blocks, link targets, addresses, tags and quotations.
// Code in either is also a code span (between backticks), an address, or the name joined to a path, an address, a
// package, a command or a header (`idtrack-web`, `idtrack.API`, `/idtrack/`, `Idtrack-Graph-Digest`).
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = fileURLToPath(new URL("..", import.meta.url));
const repository = join(web, "..");

/** The name as a word of prose, as api/tests/test_names.py reads it. */
const BARE = /(?<![\w./\-#:@])idtrack(?![\w\-/:@#])(?!\.\w)/g;
const CODE_SPAN = /`[^`\n]*`/g;
const ADDRESS = /https?:\/\/\S+/g;
/** In Markdown, what is not prose: a fenced block (in a list item too), a link's target, a tag, a quotation. */
const MARKDOWN_CODE = /^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$|\]\([^)\n]*\)|<[A-Za-z/!][^>\n]*>|^>.*$/gm;
const CODE_ELEMENTS = new Set(["code", "pre", "kbd", "samp", "Mono"]);
const READ_ATTRIBUTES = new Set(["title", "alt", "aria-label", "aria-description", "placeholder"]);

/** Blank a match out, keeping its line breaks, so that line numbers stay. */
const blank = (match: string) => match.replace(/[^\n]/g, " ");

/** The line numbers (from 1) at which a text, its code blanked out, writes the bare name. */
function bareLines(text: string, offset = 0): number[] {
  const prose = text.replace(CODE_SPAN, blank).replace(ADDRESS, blank);
  return [...prose.matchAll(BARE)].map((m) => offset + text.slice(0, m.index).split("\n").length);
}

export interface Bare {
  file: string;
  line: number;
  text: string;
}

/** Every bare name of a Markdown text. */
export function markdownBare(file: string, text: string): Bare[] {
  const lines = text.split("\n");
  const found = bareLines(text.replace(MARKDOWN_CODE, blank));
  return [...new Set(found)].map((line) => ({ file, line, text: (lines[line - 1] ?? "").trim() }));
}

/** Whether a node lies inside an element of code. */
function inCode(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isJsxElement(n) && CODE_ELEMENTS.has(n.openingElement.tagName.getText())) return true;
  }
  return false;
}

/** Every bare name of the words a page's source gives a person (its JSX texts and read attributes). */
export function pageBare(file: string, source: string): Bare[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Bare[] = [];
  const add = (text: string, from: number) => {
    const start = tree.getLineAndCharacterOfPosition(from).line;
    for (const line of bareLines(text, start)) found.push({ file, line, text: text.trim().slice(0, 160) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && !inCode(node)) add(node.getFullText(tree), node.getFullStart());
    if (ts.isJsxAttribute(node) && READ_ATTRIBUTES.has(node.name.getText()) && node.initializer) {
      const value = node.initializer;
      if (ts.isStringLiteral(value)) add(value.text, value.getStart(tree));
      else if (ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression)) {
        add(value.expression.text, value.expression.getStart(tree));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/** Every .tsx file under a folder, generated files left out. */
function pages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !p.includes("/generated/"));
}

function main(): number {
  const markdown = execFileSync("git", ["-C", repository, "ls-files", "*.md"], { encoding: "utf8" }).split("\n");
  const found: Bare[] = [];
  let texts = 0;
  for (const name of markdown.filter(Boolean)) {
    found.push(...markdownBare(name, readFileSync(join(repository, name), "utf8")));
    texts += 1;
  }
  for (const path of pages(join(web, "src"))) {
    found.push(...pageBare(relative(repository, path), readFileSync(path, "utf8")));
    texts += 1;
  }
  for (const b of found) console.log(`${b.file}:${String(b.line)}: ${b.text}`);
  console.log(`${String(found.length)} bare names in ${String(texts)} texts`);
  return found.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
