// The measured accuracy of idtrack shown on the Method page, generated from the published results of the benchmark
// repository (github.com/theislab/idtrack-reproducibility) at one commit: the tree its README names as the release's
// (`main`), each family's totals on that tree as its methods document states them ("Totals" under "On main"), checked
// line by line against the result files they are sums of, the graphs the families were asked on, and the comparison
// with other tools (family G: `results/g/main/all/tool_task.tsv`, as the table "g:rates" of its document shows it).
// Nothing is typed by hand: every number is read from a file of the repository at the commit the generated file names.
//
//   npm run benchmarks -- --from <checkout>          read a local clone of the repository (its HEAD, or --commit <sha>)
//   npm run benchmarks -- --commit <sha>             fetch the files of that commit from GitHub
//   npm run benchmarks:check [-- --from <checkout>]  fail when src/generated/benchmarks.json is not what the files of
//                                                    its commit give (CI runs it)
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { format, resolveConfig } from "prettier";

const target = fileURLToPath(new URL("../src/generated/benchmarks.json", import.meta.url));
export const REPOSITORY = "https://github.com/theislab/idtrack-reproducibility";
const RAW = "https://raw.githubusercontent.com/theislab/idtrack-reproducibility";

/** The tree whose results are the release's: the README's table of trees names it and its commit. */
export const TREE = "main";
/** The families with a measured rate, in the order of the README's table of benchmarks. */
export const FAMILIES = ["astar", "a", "b", "c", "d", "e"];
/** The order the page shows them in: what users ask first (real-world inputs, names, other databases' ids), then
 *  history travel on average and where it is hardest, then robustness to what users mistype. A reader's first
 *  question is how idtrack does on lists like theirs; the families of the history come after it. */
export const SHOWN = ["d", "b", "c", "a", "astar", "e"];
/** The file of the repository that names its organisms and the tools of family G as its documents write them. */
export const NAMES_FILE = "src/idtrack_reproducibility/families/g/report.py";

/** A dict of strings of Python source (`NAME = {"key": "value", ...}`), as a Map. */
export function pythonDict(source: string, name: string): Map<string, string> {
  const start = source.indexOf(`${name} = {`);
  if (start < 0) throw new Error(`${NAMES_FILE} has no ${name}`);
  const body = source.slice(start, source.indexOf("}", start));
  const entries = [...body.matchAll(/"([^"\\]*)":\s*"((?:[^"\\]|\\.)*)"/g)].map(
    ([, key = "", value = ""]): [string, string] => [key, value.replace(/\\(.)/g, "$1")],
  );
  if (!entries.length) throw new Error(`${NAMES_FILE}: ${name} is empty`);
  return new Map(entries);
}

/** The organisms in the order the repository lists them (`ORGANISMS`), each with the word its documents use. */
export function organismsOf(source: string): [string, string][] {
  const names = pythonDict(source, "ORGANISM_NAMES");
  return [...names.entries()].map(([key, word]): [string, string] => [word, key]);
}

/** A Markdown table's rows of cells (the header and the rule line left out). */
export function tableRows(lines: string[]): string[][] {
  return lines
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .replace(/^\|\s*|\s*\|$/g, "")
        .split(/\s+\|\s+/)
        .map((c) => c.trim()),
    )
    .filter((cells) => !cells.every((c) => /^:?-{3,}:?$/.test(c)));
}

/** A cell of Markdown as the page writes text: links by their text, escapes undone; `code` kept for the page. */
export function plainCell(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\\([*_|])/g, "$1")
    .trim();
}

/** Text with its asides left out: every parenthesis that holds code or a link (a reference for a programmer, not a
 *  word for a reader), then the spaces and punctuation that leaves. */
export function withoutAsides(text: string): string {
  let out = text;
  for (let previous = ""; previous !== out;) {
    previous = out;
    out = out.replace(/ ?\(([^()]*)\)/g, (whole: string, inner: string) => (/`|\[\[|https?:/.test(inner) ? "" : whole));
  }
  return out
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of a text (a full stop followed by a space and a capital, a code mark or the end). */
export function firstSentence(text: string): string {
  const at = text.search(/\.(?=\s+[A-Z`*]|$)/);
  return at < 0 ? text : text.slice(0, at + 1);
}

/** Markdown of a reader's sentence: links by their text, bold and escapes undone, asides left out; `code` kept. */
export function readerText(markdown: string): string {
  // A link is kept as its text, marked so that the aside holding it is known for a reference.
  const marked = markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, "[[$1]]");
  return plainCell(withoutAsides(marked).replace(/\[\[([^\]]+)\]\]/g, "$1")).replace(/\*\*([^*]+)\*\*/g, "$1");
}

/** What a family is judged against, from its document's section "Truth": the opening sentences (where it says that
 *  nothing of idtrack is read, and what is read), each top-level item by its lead and its first sentence, and whether
 *  any of it walks Ensembl's history (the shared source the harness names). */
export function truthOf(markdown: string): {
  opening: string;
  items: { lead: string; text: string }[];
  history: boolean;
} {
  const lines = section(markdown, "## Truth");
  const text = lines.join("\n");
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim());
  const opening = blocks.find((b) => b && !b.startsWith("- ") && !b.startsWith("#")) ?? "";
  const sentences = readerText(opening).split(/(?<=\.)\s+(?=[A-Z`])/);
  const lead = sentences[0] ?? "";
  const said = /^Nothing of idtrack\.?$/.test(lead) && sentences[1] ? `${lead} ${sentences[1]}` : lead;
  const top = lines.filter((l) => l.startsWith("- **"));
  const items = top.map((l) => {
    const [, lead, rest] = /^- \*\*([^*]+)\*\*\s*(.*)$/.exec(l) ?? [];
    if (lead === undefined || rest === undefined) throw new Error(`a truth item reads '${l.slice(0, 60)}'`);
    const body = firstSentence(
      readerText(rest)
        .replace(/^\([^)]*\)\s*/, "")
        .replace(/^[:,;]\s*/, ""),
    ).replace(/[;:,]$/, ".");
    return { lead: readerText(lead).replace(/:$/, ""), text: body };
  });
  const summary = [said, ...items.flatMap((i) => [i.lead, i.text])].join(" ");
  if (!said.startsWith("Nothing of idtrack")) throw new Error("a truth section does not open by what it reads");
  return {
    opening: said.replace(/:$/, "."),
    items,
    history: /\bhistory\b|\bwalk/i.test(summary),
  };
}

/** The harness's first statement of what it cannot check independently: that the history truth is the table idtrack
 *  itself stores. */
export function historyCaveatOf(harness: string): string {
  const lines = section(harness, "## Limits");
  const at = lines.findIndex((l) => l.trim() === "What the harness cannot check independently:");
  const item = lines.slice(at + 1).find((l) => l.startsWith("- "));
  if (at < 0 || !item) throw new Error("the harness states nothing it cannot check independently");
  const sentence = firstSentence(readerText(item.slice(2)));
  if (!sentence.includes("stable_id_event")) throw new Error("the harness's first limit is not the history's source");
  return sentence;
}

/** The intervals of the methods: the Wilson interval's caveat and the cluster bootstrap's unit, in its words. */
export function intervalsOf(methods: string): { wilson: string; cluster: string } {
  const lines = section(methods, "## Intervals");
  const item = (lead: string) => {
    const line = lines.find((l) => l.startsWith(`- **${lead}**`));
    if (!line) throw new Error(`the methods' intervals name no '${lead}'`);
    return readerText(line.slice(`- **${lead}**`.length));
  };
  const wilson =
    item("Wilson")
      .split(/(?<=\.)\s+/)
      .pop() ?? "";
  const cluster = firstSentence(item("Cluster bootstrap"));
  if (!wilson.includes("independent")) throw new Error("the methods say nothing of the Wilson interval's independence");
  return { wilson, cluster };
}

/** The two judges of the families that score twice, in E's words: what each holds. */
export function judgesOf(e: string): { now: string; decided: string; when: string | null } {
  const lines = section(e, "## The two judges");
  const of = (name: string) => {
    const line = lines.find((l) => l.startsWith(`- judge \`${name}\`:`));
    if (!line) throw new Error(`E names no judge '${name}'`);
    return readerText(line.slice(`- judge \`${name}\`:`.length)).replace(/;.*$|\.$/, "");
  };
  const when = /^Where (.+?), every line is scored both ways/.exec(readerText(lines.find((l) => l.trim()) ?? ""));
  return { now: of("now"), decided: of("decided"), when: when?.[1] ?? null };
}

/** The release whose answers a tree has, as the README's row of the tree says ("release 0.1.2 (`7f71b26`"). */
export function releaseOf(what: string): { release: string; commit: string } {
  const [, release, commit] = /release (\d+\.\d+\.\d+) \(`?([0-9a-f]{7,40})`?/.exec(what) ?? [];
  if (release === undefined || commit === undefined)
    throw new Error(`the README's tree names no release whose answers it has: '${what}'`);
  return { release, commit };
}

/** Every stratum of a family on the tree with a wrong answer, and how many it has without one, per organism, from
 *  the result files its totals sum (the same rule as `countsFromResults`; B and E by the judge `now`), each with the
 *  interval its file gives: the cluster bootstrap where it is there, else Wilson's. */
/** A stratum's counts and rate (with its interval) as its result file writes them. */
interface Stratum {
  stratum: string;
  n: number;
  right: number;
  wrong: number;
  undetermined: number;
  rate: string;
  low: string;
  high: string;
  interval: string;
}

/** The result files a family's counts are read from: results/index.tsv, and B's and E's files by organism. */
interface ResultFiles {
  index: Row[];
  reportB: (organism: string) => string;
  eSummary: (organism: string) => string;
}

export function strataOf(
  family: string,
  organisms: [string, string][],
  files: ResultFiles,
): { rows: (Stratum & { organism: string })[]; clean: Record<string, number> } {
  const out: (Stratum & { organism: string })[] = [];
  const clean: Record<string, number> = {};
  for (const [, organism] of organisms) {
    let rows: Stratum[];
    if (family === "b") {
      rows = tsv(files.reportB(organism))
        .filter(
          (r) =>
            cell(r, "judge") === "now" &&
            !cell(r, "stratum").startsWith("group ") &&
            cell(r, "stratum") !== "b2_moved_from" &&
            cell(r, "stratum") !== "b2_moved_from: history ends",
        )
        .map((r): Stratum => ({
          stratum: cell(r, "stratum"),
          n: Number(cell(r, "n")),
          right: Number(cell(r, "right")) + Number(cell(r, "expected_error")),
          wrong: Number(cell(r, "wrong")) + Number(cell(r, "error")),
          undetermined: Number(cell(r, "undetermined")) + Number(cell(r, "timeout")),
          rate: cell(r, "rate"),
          low: cell(r, "boot_low") || cell(r, "wilson_low"),
          high: cell(r, "boot_high") || cell(r, "wilson_high"),
          interval: cell(r, "boot_low") ? "cluster" : "wilson",
        }));
    } else {
      rows = files.index
        .filter((r) => cell(r, "family") === family && cell(r, "tree") === TREE && cell(r, "organism") === organism)
        .map((r): Stratum => ({
          stratum: cell(r, "stratum"),
          n: Number(cell(r, "n")),
          right: Number(cell(r, "right")),
          wrong: Number(cell(r, "wrong")) + Number(cell(r, "error")),
          undetermined: Number(cell(r, "undetermined")) + Number(cell(r, "timeout")),
          rate: cell(r, "rate"),
          low: cell(r, "low"),
          high: cell(r, "high"),
          interval: cell(r, "interval"),
        }));
    }
    const judged = rows.filter((r) => r.right + r.wrong > 0);
    if (!judged.length) continue;
    clean[organism] = judged.filter((r) => r.wrong === 0).length;
    for (const r of judged.filter((x) => x.wrong > 0)) {
      if (!/^\d\.\d+$/.test(r.rate) || !/^\d\.\d+$/.test(r.low) || !/^\d\.\d+$/.test(r.high))
        throw new Error(`${family} ${organism} ${r.stratum}: a rate is written '${r.rate} (${r.low}–${r.high})'`);
      out.push({ organism, ...r });
    }
  }
  return { rows: out, clean };
}

/** The lines of a section: from its heading to the next heading of its level or above. */
export function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`no section '${heading}'`);
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const end = lines.findIndex((l, i) => i > start && /^#+\s/.test(l) && (/^#+/.exec(l)?.[0].length ?? 9) <= level);
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

const integer = (text: string): number => {
  if (!/^\d{1,3}(,\d{3})*$/.test(text)) throw new Error(`not a count: '${text}'`);
  return Number(text.replaceAll(",", ""));
};

/** The first table of a family's "On main" section that opens with `| family | organism |`: its totals. */
/** A row of a family's totals as its document writes it, with the organism by its key. */
export interface Total {
  organism: string;
  part: string | null;
  judge: string | null;
  n: number;
  right: number;
  wrong: number;
  undetermined: number;
  rate: string;
  low: string;
  high: string;
  reference: string | null;
  referenceNote: string | null;
}

export function totalsOf(markdown: string, family: string, organisms: [string, string][]): Total[] {
  const ORGANISM = new Map(organisms);
  const lines = section(markdown, "### On main");
  const head = lines.findIndex((l) => l.startsWith("| family | organism | n | right | wrong | undetermined |"));
  if (head < 0) throw new Error(`${family}: no table of totals under 'On main'`);
  const end = lines.findIndex((l, i) => i > head && !l.startsWith("|"));
  const rows = tableRows(lines.slice(head + 1, end < 0 ? lines.length : end)).map((cells): Total => {
    if (cells.length !== 8) throw new Error(`${family}: a row of totals has ${cells.length} cells`);
    const [label = "", organism = "", n = "", right = "", wrong = "", undetermined = "", rate = "", reference = ""] =
      cells;
    const named = /^(\w+)(?: \((now|decided)\)| \[(now|decided)\]| \[(\w+)\])?$/.exec(label);
    if (named?.[1] !== family) throw new Error(`${family}: a row of totals is labelled '${label}'`);
    const [, value, low, high] = /^(\d\.\d+) \((\d\.\d+)–(\d\.\d+)\)$/.exec(rate) ?? [];
    if (value === undefined || low === undefined || high === undefined)
      throw new Error(`${family}: a rate is written '${rate}'`);
    const key = ORGANISM.get(organism);
    if (!key) throw new Error(`${family}: an organism is named '${organism}'`);
    return {
      organism: key,
      part: named[4] ?? null,
      judge: named[2] ?? named[3] ?? null,
      n: integer(n),
      right: integer(right),
      wrong: integer(wrong),
      undetermined: integer(undetermined),
      rate: value,
      low,
      high,
      reference: /^\d\.\d+$/.test(reference) ? reference : null,
      referenceNote: /^\d\.\d+$/.test(reference) ? null : reference,
    };
  });
  return rows;
}

/** The rows of a tab-separated file, by its header. */
/** A row of a tab-separated file: the value of each column of its header, by the column's name. */
export type Row = Readonly<Record<string, string>>;

export function tsv(text: string): Row[] {
  const [header = "", ...lines] = text.trimEnd().split("\n");
  const names = header.split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    // A line whose last cells are empty may end early (the file's end is trimmed): those cells are empty.
    return Object.fromEntries(names.map((name, i) => [name, values[i] ?? ""]));
  });
}

/** The value of a row's column; a column the file's header does not name is a fault of the reader, not of the row. */
export function cell(row: Row, column: string): string {
  const value = row[column];
  if (value === undefined) throw new Error(`no column '${column}'`);
  return value;
}

const sum = (rows: Row[], field: string): number => rows.reduce((s, r) => s + Number(r[field] ?? 0), 0);

interface Counts {
  n: number;
  right: number;
  wrong: number;
  undetermined: number;
}

/** The counts a row of totals is the sum of, read from the result files by the rule the family's document states. */
export function countsFromResults(family: string, row: Total, files: ResultFiles): Counts {
  if (family === "b") {
    // "the groups of report_b.tsv, B2 its measured part": every stratum of the judge, B2's moved names read at an old
    // release by the part whose history continues (the part whose history ends has no rate, and its summary rows
    // ("group ...") are not strata).
    const rows = tsv(files.reportB(row.organism)).filter(
      (r) =>
        cell(r, "judge") === row.judge &&
        !cell(r, "stratum").startsWith("group ") &&
        cell(r, "stratum") !== "b2_moved_from" &&
        cell(r, "stratum") !== "b2_moved_from: history ends",
    );
    return {
      n: sum(rows, "n"),
      right: sum(rows, "right") + sum(rows, "expected_error"),
      wrong: sum(rows, "wrong") + sum(rows, "error"),
      undetermined: sum(rows, "undetermined") + sum(rows, "timeout"),
    };
  }
  if (family === "e") {
    // "sums over the strata of e_summary.tsv": an expected error is a right answer, an error a wrong one.
    const rows = tsv(files.eSummary(row.organism)).filter((r) => cell(r, "judge") === row.judge);
    return {
      n: sum(rows, "n"),
      right: sum(rows, "right") + sum(rows, "expected_error"),
      wrong: sum(rows, "wrong") + sum(rows, "error"),
      undetermined: sum(rows, "undetermined") + sum(rows, "timeout"),
    };
  }
  // The other families' totals are the sums over their strata in results/index.tsv, of the tree or its named part.
  const tree = row.part ?? TREE;
  const rows = files.index.filter(
    (r) => cell(r, "family") === family && cell(r, "tree") === tree && cell(r, "organism") === row.organism,
  );
  if (!rows.length) throw new Error(`${family} ${tree} ${row.organism}: no rows in results/index.tsv`);
  return {
    n: sum(rows, "n"),
    right: sum(rows, "right"),
    wrong: sum(rows, "wrong") + sum(rows, "error"),
    undetermined: sum(rows, "undetermined") + sum(rows, "timeout"),
  };
}

/** Wilson's 95 % interval of a share. */
export function wilson(right: number, judged: number): [number, number] {
  const z = 1.959963984540054;
  if (!judged) return [0, 1];
  const p = right / judged;
  const d = 1 + (z * z) / judged;
  const c = (p + (z * z) / (2 * judged)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / judged + (z * z) / (4 * judged * judged))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** The README's description of each family (its table "What is here"), by the family's key. */
/** A family as the README describes it: its title, what it measures, and its document. */
interface Family {
  title: string;
  measures: string;
  document: string | null;
}

export function familiesOf(readme: string): Record<string, Family> {
  const rows = tableRows(section(readme, "## What is here")).slice(1);
  const names = { astar: /^A\*,/, a: /^A,/, b: /^B,/, c: /^C,/, d: /^D,/, e: /^E,/, g: /^G,/ };
  const out: Record<string, Family> = {};
  for (const [key, pattern] of Object.entries(names)) {
    const row = rows.find((cells) => pattern.test(plainCell(cells[0] ?? "")));
    if (!row) throw new Error(`the README describes no family ${key}`);
    const [title = "", measures = "", link = ""] = row;
    const doc = /\]\(([^)]+)\)/.exec(link)?.[1];
    out[key] = { title: plainCell(title), measures: plainCell(measures), document: doc ?? null };
  }
  return out;
}

/** The README's sentence on where the expected answers come from. */
export function readmeTruthOf(readme: string): string {
  const found = /Every expected answer .*?\.(?= [A-Z]|$)/.exec(readme.replace(/\s+/g, " "));
  if (!found) throw new Error("the README says nothing of where its expected answers come from");
  return plainCell(found[0]);
}

/** The README's row of the tree: its commit and what it is. */
export function treeOf(readme: string): { name: string; commit: string; what: string } {
  const rows = tableRows(section(readme, "## Trees")).slice(1);
  const row = rows.find((cells) => cells[0] === `\`${TREE}\``);
  if (!row) throw new Error(`the README names no tree '${TREE}'`);
  const [, commit = "", what = ""] = row;
  return { name: TREE, commit: plainCell(commit).replaceAll("`", ""), what: plainCell(what) };
}

/** The graphs a tree was asked on, by organism: `[graphs.<tree>]` of results.toml. */
export function graphsOf(toml: string): Record<string, string> {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[graphs.${TREE}]`);
  if (start < 0) throw new Error(`results.toml has no [graphs.${TREE}]`);
  const graphs: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const [, organism, digest] = /^(\w+)\s*=\s*"([0-9a-f]{64})"/.exec(line.trim()) ?? [];
    if (organism === undefined || digest === undefined) break;
    graphs[organism] = digest;
  }
  if (!Object.keys(graphs).length) throw new Error(`[graphs.${TREE}] names no graph`);
  return graphs;
}

/** A share in whole per cent as the repository's report writes it (Python's `f"{100 * x:.0f}"`: half to even). */
export function percent(share: number): number {
  const x = 100 * share;
  const floor = Math.floor(x);
  if (x - floor !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Family G: its tasks, the table of rates per tool (as its document shows it) and what the rates are not. */
export function toolsOf(
  markdown: string,
  toolTask: Row[],
  organismWords: [string, string][],
  subjectNames: Map<string, string>,
) {
  const ORGANISM = new Map(organismWords);
  const tasksText = section(markdown, "## The tasks and the lines").join("\n");
  const tasks: Record<string, string> = {};
  for (const [, task = "", words = ""] of tasksText.matchAll(/\*\*([a-e])\*\* ([^;.]+?)(?: \([^)]*\))?(?=;|\. )/g))
    tasks[task] = words.trim();
  if (Object.keys(tasks).length !== 5) throw new Error("G's document names not five tasks");
  const results = section(markdown, "## Results");
  const start = results.findIndex((l) => l.trim() === "<!-- table g:rates -->");
  const end = results.findIndex((l, i) => i > start && l.trim() === "<!-- /table -->");
  if (start < 0 || end < 0) throw new Error("G's document has no table g:rates");
  const [header = [], ...rows] = tableRows(results.slice(start + 1, end));
  const organisms = header.slice(2).map((name) => {
    const key = ORGANISM.get(name);
    if (!key) throw new Error(`G's table names an organism '${name}'`);
    return key;
  });
  const after =
    results
      .slice(end + 1)
      .join("\n")
      .trim()
      .split(/\n\s*\n/)[0] ?? "";
  const best = toolTask.filter((r) => cell(r, "form") === "best");
  const tools = rows.map(([tool = "", task = "", ...cells]) => {
    const shown = cells.map((text, i) => {
      if (text === "–") return null;
      const [, rate, idtrack, kept] = /^(\d+) \/ (\d+) \(([\d,]+)\)$/.exec(text) ?? [];
      if (rate === undefined || idtrack === undefined || kept === undefined)
        throw new Error(`G's table has a cell '${text}'`);
      return { organism: organisms[i], tool: Number(rate), idtrack: Number(idtrack), kept: integer(kept) };
    });
    // The subject of tool_task.tsv the row shows: the one the repository names so (SUBJECT_NAMES of its report).
    const subjects = [...subjectNames.entries()].filter(([, name]) => name === tool).map(([subject]) => subject);
    if (subjects.length !== 1) throw new Error(`G's row '${tool} ${task}' names ${subjects.length} subjects`);
    const [subject] = subjects;
    return {
      tool: plainCell(tool),
      subject,
      task,
      cells: shown.map((s, i) => {
        if (s === null) return null;
        const r = best.find(
          (x) => cell(x, "subject") === subject && cell(x, "task") === task && cell(x, "organism") === organisms[i],
        );
        if (!r || Number(cell(r, "kept")) !== s.kept)
          throw new Error(`G's row '${tool} ${task}' (${organisms[i]}) is not tool_task.tsv's`);
        const rate = Number(cell(r, "rate_all"));
        const idtrack = Number(cell(r, "idtrack_rate_all"));
        if (percent(rate) !== s.tool || percent(idtrack) !== s.idtrack)
          throw new Error(`G's row '${tool} ${task}' (${organisms[i]}) differs from tool_task.tsv`);
        return {
          organism: organisms[i],
          kept: Number(cell(r, "kept")),
          right: Number(cell(r, "right_all")),
          wrong: Number(cell(r, "wrong_all")),
          error: Number(cell(r, "error_all")),
          rate: cell(r, "rate_all"),
          idtrack: cell(r, "idtrack_rate_all"),
          idtrackN: Number(cell(r, "idtrack_n_all")),
          posed: Number(cell(r, "posed")),
          notAnswered: Number(cell(r, "not_answered")),
          coverage: cell(r, "coverage"),
        };
      }),
    };
  });
  // The paragraph after the table, without its pointer to the document's later section (" is read below:").
  for (const t of tools)
    for (const c of t.cells)
      if (
        c &&
        (!/^\d(\.\d{1,4})?$/.test(c.rate) ||
          !/^\d(\.\d{1,4})?$/.test(c.idtrack) ||
          !/^\d(\.\d{1,4})?$/.test(c.coverage))
      )
        throw new Error(`G's row '${t.tool} ${t.task}' has a rate of more than 4 decimals`);
  const measures = section(markdown, "## What it measures").join(" ");
  const coverage = /coverage \(([^)]+)\)/.exec(measures)?.[1];
  const all = /`all` \(([^)]+)\)/.exec(measures)?.[1];
  if (!coverage || !all) throw new Error("G's document does not say what coverage and the view `all` are");
  return {
    tasks,
    organisms,
    tools,
    reading: plainCell(after).replace(/ is read below:/g, ":"),
    coverage: readerText(coverage),
    viewAll: readerText(all),
  };
}

/** Everything the page shows, from the repository's files at one commit. */
export async function benchmarks(read: (path: string) => Promise<string>, commit: string) {
  const readme = await read("README.md");
  const names = await read(NAMES_FILE);
  const ORGANISMS = organismsOf(names);
  const index = tsv(await read("results/index.tsv"));
  const described = familiesOf(readme);
  const tree = treeOf(readme);
  const b = new Map<string, string>();
  const e = new Map<string, string>();
  for (const [, organism] of ORGANISMS) {
    b.set(organism, await read(`results/b/${TREE}/${organism}/report_b.tsv`));
    e.set(organism, await read(`results/e/${TREE}/${organism}/e_summary.tsv`));
  }
  const fileOf = (files: Map<string, string>, organism: string): string => {
    const text = files.get(organism);
    if (text === undefined) throw new Error(`no result file of ${organism}`);
    return text;
  };
  const files: ResultFiles = { index, reportB: (o) => fileOf(b, o), eSummary: (o) => fileOf(e, o) };
  const families = [];
  for (const key of FAMILIES) {
    const path = `docs/families/${key}.md`;
    const rows = totalsOf(await read(path), key, ORGANISMS);
    for (const row of rows) {
      const counted = countsFromResults(key, row, files);
      for (const field of ["n", "right", "wrong", "undetermined"] as const)
        if (counted[field] !== row[field])
          throw new Error(
            `${key} ${row.part ?? row.judge ?? ""} ${row.organism}: ${field} is ${row[field]} in ${path}, ${counted[field]} in the results`,
          );
      const judged = row.right + row.wrong;
      const [low, high] = wilson(row.right, judged);
      const digits = row.rate.length - 2;
      const close = (a: number, b: string) => Math.abs(a - Number(b)) <= 1.5 * 10 ** -digits;
      if (!close(row.right / judged, row.rate) || !close(low, row.low) || !close(high, row.high))
        throw new Error(`${key} ${row.organism}: the rate ${row.rate} (${row.low}–${row.high}) is not its counts'`);
    }
    const document = await read(path);
    families.push({
      key,
      ...described[key],
      source: `${path}#on-main`,
      truth: { source: `${path}#truth`, ...truthOf(document) },
      rows,
      strata: strataOf(key, ORGANISMS, files),
    });
  }
  families.sort((x, y) => SHOWN.indexOf(x.key) - SHOWN.indexOf(y.key));
  const g = toolsOf(
    await read("docs/families/g.md"),
    tsv(await read("results/g/main/all/tool_task.tsv")),
    ORGANISMS,
    pythonDict(names, "SUBJECT_NAMES"),
  );
  return {
    about:
      "Generated by scripts/benchmarks.ts from the published results of idtrack-reproducibility at the commit: do not edit.",
    repository: REPOSITORY,
    commit,
    tree: { ...tree, answers: releaseOf(tree.what) },
    truth: readmeTruthOf(readme),
    historyCaveat: historyCaveatOf(await read("docs/harness.md")),
    intervals: intervalsOf(await read("docs/methods.md")),
    judges: judgesOf(await read("docs/families/e.md")),
    graphs: graphsOf(await read("results.toml")),
    families,
    tools: {
      ...described["g"],
      source: "results/g/main/all/tool_task.tsv",
      table: "docs/families/g.md#results",
      ...g,
    },
  };
}

const argument = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

async function main() {
  const from = argument("--from");
  const check = process.argv.includes("--check");
  let commit = argument("--commit");
  if (!commit && check) commit = (JSON.parse(await readFile(target, "utf8")) as { commit?: string }).commit ?? null;
  if (!commit && from) commit = execFileSync("git", ["-C", from, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!commit) throw new Error("name the commit (--commit <sha>) or a checkout (--from <folder>)");
  const at = commit;
  const read = from
    ? (path: string) =>
        Promise.resolve(
          execFileSync("git", ["-C", from, "show", `${at}:${path}`], { encoding: "utf8", maxBuffer: 1 << 28 }),
        )
    : async (path: string) => {
        const response = await fetch(`${RAW}/${at}/${path}`);
        if (!response.ok) throw new Error(`${RAW}/${at}/${path}: ${response.status}`);
        return response.text();
      };
  const document = await benchmarks(read, commit);
  const text = await format(JSON.stringify(document), { ...(await resolveConfig(target)), filepath: target });
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== text) {
      console.error("src/generated/benchmarks.json is not what the benchmarks' files give: run `npm run benchmarks`.");
      process.exit(1);
    }
    console.log(`src/generated/benchmarks.json matches idtrack-reproducibility ${commit.slice(0, 12)}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    console.log(`wrote src/generated/benchmarks.json from idtrack-reproducibility ${commit.slice(0, 12)}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
