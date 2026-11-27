// What idtrack's documentation says that the pages show where it is used, generated from the documentation of idtrack
// at one commit (the documentation commit, below):
//
// - the citation (docs/authors.rst, "Citing idtrack": the BibTeX entry as written, and the sentence after it);
// - the data sources idtrack names (docs/authors.rst, "Data Sources": each resource, its address and description);
// - what each database name of a graph holds (docs/databases.rst, "The names a graph lists": the table "Which name to
//   pass", the names of labels and of the databases whose labels they are, the databases that hold display names with
//   what each group of them is, and the phrase that names the symbols projected onto other organisms' genes);
// - which assembly changes Ensembl publishes a mapping for (docs/limitations.rst, "Places across an assembly change":
//   its lead, its paragraphs, and the assembly changes its two lists name);
// - what Ensembl's mapping score is and what each version event of Ensembl's history records (docs/concepts.rst: the
//   paragraph that defines the **mapping score**, and the table of events of "History travel and Ensembl's scores");
// - the limitations (docs/limitations.rst, "Limitations": each subsection's title, anchor, lead and whole first
//   sentence);
// - the counts of a graph's build and what idtrack's code says of each (idtrack/build/builder.py's `counts`, with the
//   concepts' page on a graph's nodes and edges, or the docstring of the member of the same name of TheGraph or of the
//   graph's record, read at the code commit).
//
// The documentation commit is the code commit the api is pinned to (api/uv.lock) or a later commit of idtrack whose
// changes since it touch only documentation (docs/ and README.rst, never the package): the documentation of the code
// that answers, as up to date as idtrack has written it. The generator checks that the changes between the two commits
// are documentation only (`git diff --name-only`, in the checkout given or in a clone of GitHub's repository without the files' contents) and
// refuses a commit whose changes touch anything else.
//
//   npm run idtrack-docs [-- --docs-commit <sha>]          fetch the files from GitHub, write the file (the docs commit:
//                                                          the one given, else the one the file names, else the pin)
//   npm run idtrack-docs -- --from <dir> [--docs-commit <sha>]   read a local checkout of idtrack instead
//   npm run idtrack-docs:check [-- --from <dir>]           fail when src/generated/idtrack_docs.json is not what they give
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { format, resolveConfig } from "prettier";
import { changedPaths, isDocumentation, pinnedCommit, sectionId } from "./limitations.ts";

// Whether a path is documentation is one rule for both generated files (scripts/limitations.ts).
export { isDocumentation };

const lockUrl = new URL("../../api/uv.lock", import.meta.url);
const target = fileURLToPath(new URL("../src/generated/idtrack_docs.json", import.meta.url));
const REPOSITORY = "https://github.com/theislab/idtrack";

/** RST inline markup as the page writes text: ``code`` and `code` as `code`, roles by their target's last name. */
export function plain(text: string): string {
  return text
    .replace(/:py:\w+:`~?([^`<]+?)(\s*<[^>]+>)?`/g, (_, name: string) => `\`${name.trim().split(".").pop() ?? name}\``)
    .replace(/:ref:`([^`<]+?)\s*(<[^>]+>)?`/g, (_, label: string) => label.trim())
    .replace(/:doc:`([^`<]+?)\s*(<[^>]+>)?`/g, (_, label: string) => label.trim())
    .replace(/``([^`]+)``/g, "`$1`")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text for a reader of the page rather than a programmer: an aside in parentheses that opens with code (a reference
 *  to the package's interface) is left out, and so is a sentence that opens with code (an instruction for a call). */
export function forReaders(text: string): string {
  return text
    .replace(/ \(`[^()]*\)/g, "")
    .split(/(?<=\.) (?=\S)/)
    .filter((sentence) => !sentence.startsWith("`"))
    .join(" ");
}

/** The lines of the section titled `title` (underlined by `mark`), up to the next title of that mark. */
export function sectionOf(rst: string, title: string, mark: string): string[] {
  const lines = rst.split("\n");
  const under = (i: number) => new RegExp(`^\\${mark}{3,}$`).test(lines[i + 1] ?? "");
  const start = lines.findIndex((l, i) => l.trim() === title && under(i));
  if (start < 0) throw new Error(`no section '${title}'`);
  const rest = lines.slice(start + 2);
  const next = rest.findIndex((l, i) => /^\S/.test(l) && new RegExp(`^\\${mark}{3,}$`).test(rest[i + 1] ?? ""));
  return next < 0 ? rest : rest.slice(0, next);
}

/** Paragraphs of RST lines (blank lines apart), directives and labels left out. */
function paragraphs(lines: string[]): string[] {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(".. "));
}

/** The citation: the BibTeX entry of "Citing idtrack", dedented, its year, and the sentence that follows it. */
export function citationOf(rst: string): { bibtex: string; year: string; note: string | null } {
  const lines = sectionOf(rst, "Citing idtrack", "-");
  const at = lines.findIndex((l) => l.trim() === ".. code-block:: bibtex");
  if (at < 0) throw new Error("'Citing idtrack' has no BibTeX block");
  const block: string[] = [];
  let i = at + 1;
  for (let line = lines[i]; line !== undefined && (line.trim() === "" || /^\s/.test(line)); line = lines[++i])
    block.push(line);
  const body = block.filter((l) => l.trim());
  const indent = Math.min(...body.map((l) => l.length - l.trimStart().length));
  const bibtex = body.map((l) => l.slice(indent)).join("\n");
  const year = /year = \{(\d{4})\}/.exec(bibtex)?.[1];
  if (!year) throw new Error("the BibTeX entry has no year");
  const after = paragraphs(lines.slice(i))[0];
  return { bibtex, year, note: after ? plain(after) : null };
}

/** The ``names`` of an RST cell, each with the note in parentheses that follows it. */
function namesOf(cell: string): { name: string; note: string | null }[] {
  return [...cell.matchAll(/``([^`]+)``(?:\s*\(([^)]*)\))?/g)]
    .map((m) => ({ name: m[1] ?? "", note: m[2] ? plain(m[2]) : null }))
    .filter((n) => !/^_|_$/.test(n.name)); // a part of a name (``_predicted``, ``XM_``), not a database
}

/** What each database name holds, by idtrack's page of external databases. */
/** A database name and what it holds, with the page's note and the part of the page that says it. */
export interface DatabaseMeaning {
  name: string;
  holds: string;
  note: string | null;
  source: "which-name-to-pass" | "labels" | "display-names";
}

/** The rows of an RST list-table: each row's first cell and second cell. */
type Rows = [string, string][];

export function databasesOf(rst: string): DatabaseMeaning[] {
  const lines = sectionOf(rst, "The names a graph lists", "-");
  const out: DatabaseMeaning[] = [];
  // The table "Which name to pass": each row what one gets, and the names that give it.
  const at = lines.findIndex((l) => l.trim().startsWith("Which name to pass"));
  if (at < 0) throw new Error("no table 'Which name to pass'");
  const rows: Rows = [];
  for (const line of lines.slice(at)) {
    const first = /^\s{4}\* - (.*)$/.exec(line)?.[1];
    const second = /^\s{6}- (.*)$/.exec(line)?.[1];
    const more = /^\s{8}(\S.*)$/.exec(line)?.[1];
    const row = rows[rows.length - 1];
    if (first !== undefined) rows.push([first, ""]);
    else if (second !== undefined && row) row[1] = second;
    else if (more !== undefined && row) {
      if (row[1]) row[1] += ` ${more}`;
      else row[0] += ` ${more}`;
    }
  }
  for (const [get, cell] of rows.slice(1)) {
    const what = plain(get);
    // "A / B" against "``x`` / ``y``": each name takes its part; a part of one word completes the first part in its
    // place ("The Ensembl gene id with version (default) / without": "The Ensembl gene id without version").
    const parts = what.split(" / ").map((part, i, all) => (i ? completePart(all[0] ?? "", part) : part));
    const cells = cell.split(" / ").map(namesOf);
    const paired = parts.length > 1 && parts.length === cells.length && parts.every((p) => p.split(" ").length > 1);
    (paired ? cells : [cells.flat()]).forEach((names, i) => {
      for (const { name, note } of names)
        out.push({ name, holds: paired ? (parts[i] ?? what) : what, note, source: "which-name-to-pass" });
    });
  }
  // The names of labels ("the labels of ``A``, ``B`` and ``C`` are ``A label``, ..."), and the databases that hold
  // display names (point 2).
  const text = paragraphs(lines).join(" ").replace(/\s+/g, " ");
  const labels = /the labels of ((?:``[^`]+``(?:, | and )?)+) are ((?:``[^`]+``(?:, | and )?)+)/.exec(text);
  if (!labels) throw new Error("no sentence naming the labels' names");
  const sources = [...(labels[1] ?? "").matchAll(/``([^`]+)``/g)].map((m) => m[1] ?? "");
  const named = [...(labels[2] ?? "").matchAll(/``([^`]+)``/g)].map((m) => m[1] ?? "");
  if (sources.length !== named.length) throw new Error("the labels' sentence names unequal lists");
  named.forEach((name, i) =>
    out.push({ name, holds: `the labels of ${sources[i] ?? ""}`, note: null, source: "labels" }),
  );
  // "Where Ensembl gives the labels and the accessions of a database one name, the labels take a name of their own":
  // the database's own name then holds its accessions.
  if (!text.includes("the labels and the accessions of a database one name, the labels take a name of their own"))
    throw new Error("no sentence saying that a database's labels take a name of their own");
  sources.forEach((name, i) =>
    out.push({ name, holds: `the accessions of ${name}`, note: `its labels are ${named[i] ?? ""}`, source: "labels" }),
  );
  const display = /\*\*Display names are held under the name of their database's labels\.\*\*(.+?)They are not in/.exec(
    text,
  );
  const point = display?.[1];
  if (point === undefined) throw new Error("no point on display names");
  const sentence = plain(point.split(":")[0] ?? "");
  // Each group of names with what the page says its names are ("(HGNC's projections)", "(UniProt's entry names)").
  for (const { name, group } of groupedNames(point.slice(point.indexOf(":") + 1)))
    out.push({ name, holds: sentence, note: group, source: "display-names" });
  const seen = new Set<string>();
  for (const d of out) {
    if (seen.has(d.name)) throw new Error(`the page of databases describes '${d.name}' twice`);
    seen.add(d.name);
  }
  return out;
}

/** The assembly changes one of the limitation's lists names: "organism A to B to C, organism D to E and E to F". */
export function changesOf(list: string): { organism: string; from: string; to: string }[] {
  const pairs: { organism: string; from: string; to: string }[] = [];
  for (const item of list.split(/,\s+/)) {
    const words = item
      .replace(/\s+across both changes$/, "")
      .trim()
      .split(" ");
    const chains = words.slice(1).join(" ").split(" and ");
    for (const chain of chains) {
      const names = chain.split(" to ").map((n) => n.trim());
      names.forEach((name, k) => {
        const from = names[k - 1];
        if (from === undefined) return;
        // A later name written as the part that differs from the earlier one ("Macaca_fascicularis_5.0 to 6.0").
        const tail = /[\d.]+$/.exec(from);
        const to = /^[\d.]+$/.test(name) && tail ? from.slice(0, tail.index) + name : name;
        pairs.push({ organism: words[0] ?? "", from, to });
      });
    }
  }
  return pairs;
}

/** The limitation on places across an assembly change: its text and the changes with and without Ensembl's mapping. */
export function assemblyMappingOf(rst: string): {
  title: string;
  lead: string;
  paragraphs: string[];
  mapped: { organism: string; from: string; to: string }[];
  unmapped: { organism: string; from: string; to: string }[];
} {
  const lines = sectionOf(rst, "Places across an assembly change", "~");
  const ps = paragraphs(lines);
  const all = ps.join(" ").replace(/\s+/g, " ");
  const mapped = /Where it does \(([^)]+)\)/.exec(all)?.[1];
  const unmapped = /Where Ensembl publishes no mapping \(([^)]+)\)/.exec(all)?.[1];
  if (mapped === undefined || unmapped === undefined)
    throw new Error("the limitation names no lists of assembly changes");
  const lead = /^\*\*([\s\S]+?)\*\*/.exec(ps[0] ?? "")?.[1];
  if (lead === undefined) throw new Error("the limitation does not open with a lead in bold");
  return {
    title: "Places across an assembly change",
    lead: plain(lead),
    paragraphs: ps.map((p) => forReaders(plain(p))),
    mapped: changesOf(mapped),
    unmapped: changesOf(unmapped),
  };
}

/** The paragraph of the concepts that defines Ensembl's mapping score. */
export function mappingScoreOf(rst: string): string {
  const found = paragraphs(rst.split("\n")).find((p) => p.includes("**mapping score**"));
  if (!found) throw new Error("docs/concepts.rst defines no **mapping score**");
  return forReaders(plain(found));
}

/** The data sources of docs/authors.rst ("Data Sources"): each row's resources (name and address) and description. */
export function sourcesOf(rst: string): { resources: { name: string; url: string | null }[]; description: string }[] {
  const lines = sectionOf(rst, "Data Sources", "~");
  const rows = listRows(lines);
  const out = rows.slice(1).map(([cell, description]) => {
    const links = [...cell.matchAll(/`([^`<]+?)\s*<([^>]+)>`_/g)].map((m) => ({
      name: (m[1] ?? "").trim(),
      url: m[2] ?? null,
    }));
    // Resources named without an address ("CCDS, Havana and Vega"): the words of the cell outside its links.
    const bare = cell
      .replace(/`[^`]+`_/g, "")
      .split(/,|\band\b/)
      .map((w) => w.trim())
      .filter(Boolean)
      .map((name) => ({ name, url: null as string | null }));
    return { resources: [...links, ...bare], description: plain(description) };
  });
  if (!out.length) throw new Error("'Data Sources' lists no resource");
  return out;
}

/** "with version (default)" and "without": a part of one word that begins with a word of the first part takes that
 *  word's place in it (its asides left out), so that each of "A / B" says what it is in words. */
/** The rows of an RST list-table of two columns (each row's first cell and its second, trimmed), up to the first line
 *  that is not part of the table when `untilText` (a line of text at the left edge). */
function listRows(lines: string[], untilText = false): Rows {
  const rows: Rows = [];
  for (const line of lines) {
    const first = /^\s{4}\* - (.*)$/.exec(line)?.[1];
    const second = /^\s{6}- (.*)$/.exec(line)?.[1];
    const row = rows[rows.length - 1];
    if (first !== undefined) rows.push([first, ""]);
    else if (second !== undefined && row) row[1] = second.trim();
    else if (untilText && line.trim() && !/^\s/.test(line)) break;
  }
  return rows;
}

export function completePart(first: string, part: string): string {
  if (part.includes(" ")) return part;
  const words = first.replace(/\s*\([^)]*\)/g, "").split(" ");
  const at = words.findIndex((w) => part.startsWith(w) && part !== w);
  if (at < 0) return part;
  return [...words.slice(0, at), part, ...words.slice(at + 1)].join(" ");
}

/** The names of a list of RST names, each group of them with the words in parentheses that follow the group. */
function groupedNames(text: string): { name: string; group: string | null }[] {
  const out: { name: string; group: string | null }[] = [];
  let pending: string[] = [];
  for (const m of text.matchAll(/``([^`]+)``|\(([^()]*)\)/g)) {
    if (m[1] !== undefined) pending.push(m[1]);
    else {
      for (const name of pending) out.push({ name, group: plain(m[2] ?? "") });
      pending = [];
    }
  }
  for (const name of pending) out.push({ name, group: null });
  return out;
}

/** The phrase of the page of databases that names the symbols of one authority projected onto other organisms' genes
 *  ("the HGNC symbols projected onto pig and macaque genes"): the authority's database and the organisms' words. */
export function projectionsOf(rst: string): { phrase: string; database: string; organisms: string[] }[] {
  const text = rst.replace(/\s+/g, " ");
  return [...text.matchAll(/the (\w+) symbols projected onto ([a-z ,]+?) genes/g)].map(
    ([, authority = "", onto = ""]) => ({
      phrase: `the ${authority} symbols projected onto ${onto} genes`,
      database: `${authority} Symbol`,
      organisms: onto.split(/,\s*|\s+and\s+/).map((w) => w.trim()),
    }),
  );
}

/** The version events of Ensembl's history (docs/concepts.rst, the table of "History travel and Ensembl's scores"):
 *  each row's reasons and what Ensembl recorded. */
export function eventsOf(rst: string): { reasons: string[]; recorded: string }[] {
  const lines = sectionOf(rst, "History travel and Ensembl's scores", "-");
  const at = lines.findIndex((l) => l.trim() === ".. list-table::");
  if (at < 0) throw new Error("'History travel and Ensembl's scores' has no table of events");
  const rows = listRows(lines.slice(at + 1), true);
  const out = rows.slice(1).map(([codes, recorded]) => ({
    reasons: [...codes.matchAll(/``([^`]+)``/g)].map((m) => m[1] ?? ""),
    recorded: plain(recorded),
  }));
  if (out.length < 4) throw new Error("the table of events has fewer rows than Ensembl's kinds of event");
  return out;
}

/** Each limitation of "Limitations" (one per subsection, opened by its lead in bold): its title, its anchor, the lead
 *  and its whole first sentence (the lead continued to the sentence's end, so that a lead that is the start of its
 *  sentence is never cut short), with the sentence after it (what the page shows where the first is short). */
export function limitationSentencesOf(
  rst: string,
): { title: string; anchor: string; lead: string; sentence: string; next: string | null }[] {
  const lines = sectionOf(rst, "Limitations", "-");
  const heads = lines.flatMap((l, i) => (/^\S/.test(l) && /^~{3,}$/.test(lines[i + 1] ?? "") ? [i] : []));
  if (!heads.length) throw new Error("the section 'Limitations' has no subsections");
  return heads.map((head, k) => {
    const title = (lines[head] ?? "").trim();
    const body = paragraphs(lines.slice(head + 2, heads[k + 1] ?? lines.length))[0] ?? "";
    const lead = /^\*\*([\s\S]+?)\*\*/.exec(body)?.[1];
    if (lead === undefined) throw new Error(`the limitation '${title}' does not open with a lead in bold`);
    const text = plain(body);
    const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z`(])/);
    const [sentence = text, next = null] = sentences.map((x) => forReaders(x));
    return { title, anchor: sectionId(title), lead: plain(lead), sentence, next };
  });
}

const argument = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

/** The counts a graph's build records (the keys of `counts` in idtrack/build/builder.py), each with what idtrack's code
 *  says of the thing of the same name: the first sentence of the docstring of `TheGraph`'s member of that name
 *  (idtrack/graph/graph.py; "Return a gene's places ..." read as "A gene's places ..."), else of the record's
 *  attribute of that name (idtrack/graph/record.py), else none. A member's sentence about the node it is asked of
 *  ("the gene-history edges that leave a node") is not a meaning of the count and is not taken. */
export function countMeaningsOf(
  builder: string,
  graph: string,
  record: string,
  concepts: string,
): { key: string; meaning: string | null; source: "concepts" | "graph" | "record" | null }[] {
  // The concepts' page says what a graph's nodes and its two kinds of edges are ("The graph"): `nodes` takes its
  // sentence on nodes, `<kind>_edges` the item of the kind of that name.
  const theGraph = paragraphs(sectionOf(concepts, "The graph", "-")).join("\n\n");
  const nodes = /Its nodes are ([\s\S]*?)\. Its edges/.exec(theGraph.replace(/\s+/g, " "));
  const kinds = theGraph.split(/\n\n|\n(?=\* )/).flatMap((item) => {
    const [, kind, text] = /^\* \*\*([^*]+)\*\*: ([\s\S]*)$/.exec(item) ?? [];
    return kind === undefined || text === undefined
      ? []
      : [{ kind: kind.replace(/s$/, "").replace(/ /g, "_"), text: forReaders(plain(text)).replace(/[;,]$/, ".") }];
  });
  const block = /counts = \{([\s\S]*?)\n\s*\}/.exec(builder)?.[1];
  if (block === undefined) throw new Error("idtrack/build/builder.py records no counts");
  const keys = [...block.matchAll(/"(\w+)":/g)].map((m) => m[1] ?? "");
  if (keys.length < 3) throw new Error("idtrack/build/builder.py records fewer than three counts");
  const firstSentence = (text: string) => {
    const flat = plain(text.replace(/\s+/g, " ").trim());
    const end = /^[\s\S]*?\.(?=\s|$)/.exec(flat);
    return (end ? end[0] : flat).replace(/^Return (\w)/, (_, c: string) => c.toUpperCase());
  };
  return keys.map((key) => {
    if (key === "nodes" && nodes?.[1] !== undefined)
      return {
        key,
        meaning: `${forReaders(plain(nodes[1])).replace(/^\w/, (c) => c.toUpperCase())}.`,
        source: "concepts",
      };
    const kind = kinds.find((k) => `${k.kind}_edges` === key);
    if (kind) return { key, meaning: kind.text.charAt(0).toUpperCase() + kind.text.slice(1), source: "concepts" };
    const member = new RegExp(`def ${key}\\(self[^)]*\\)[^:]*:\\s*\\n\\s*"""([\\s\\S]*?)(?:\\n\\s*\\n|""")`).exec(
      graph,
    );
    // A method of one node whose sentence is about the node asked ("the edges that leave a node") says what one node
    // has, not what the count counts: it is not taken.
    const said = member?.[1] !== undefined ? forReaders(firstSentence(member[1])) : null;
    if (said && !/\ba node\b/.test(said)) return { key, meaning: said, source: "graph" };
    const attribute = new RegExp(`\\n\\s{8}${key} \\([^)]*\\): ([\\s\\S]*?)(?=\\n\\s{8}\\w+ \\(|\\n\\s*\\n)`).exec(
      record,
    );
    if (attribute?.[1] !== undefined)
      return { key, meaning: forReaders(firstSentence(attribute[1])), source: "record" };
    return { key, meaning: null, source: null };
  });
}

async function main() {
  const commit = pinnedCommit(await readFile(lockUrl, "utf8"));
  const from = argument("--from");
  const previous = JSON.parse(await readFile(target, "utf8").catch(() => "{}")) as {
    commit?: string;
    docsCommit?: string;
  };
  // The documentation commit named, else the one the file names while the pin is the same, else the pin itself.
  const docsCommit = argument("--docs-commit") ?? (previous.commit === commit ? previous.docsCommit : null) ?? commit;
  if (!/^[0-9a-f]{40}$/.test(docsCommit)) throw new Error(`name the documentation commit in full: '${docsCommit}'`);
  const other = (await changedPaths(from, commit, docsCommit)).filter((path) => !isDocumentation(path));
  if (other.length)
    throw new Error(
      `idtrack ${docsCommit.slice(0, 12)} changes more than documentation since ${commit.slice(0, 12)}: ${other.join(", ")}`,
    );
  const read = from
    ? (path: string) =>
        Promise.resolve(execFileSync("git", ["-C", from, "show", `${docsCommit}:${path}`], { encoding: "utf8" }))
    : async (path: string) => {
        const raw = `https://raw.githubusercontent.com/theislab/idtrack/${docsCommit}/${path}`;
        const response = await fetch(raw);
        if (!response.ok) throw new Error(`${raw}: ${response.status}`);
        return response.text();
      };
  // The package's own words (its docstrings) are read at the code commit itself.
  const readCode = from
    ? (path: string) =>
        Promise.resolve(execFileSync("git", ["-C", from, "show", `${commit}:${path}`], { encoding: "utf8" }))
    : async (path: string) => {
        const raw = `https://raw.githubusercontent.com/theislab/idtrack/${commit}/${path}`;
        const response = await fetch(raw);
        if (!response.ok) throw new Error(`${raw}: ${response.status}`);
        return response.text();
      };
  const blob = (path: string, anchor: string) =>
    `${REPOSITORY}/blob/${docsCommit}/${path}${anchor ? `#${anchor}` : ""}`;
  const authors = await read("docs/authors.rst");
  const databases = await read("docs/databases.rst");
  const concepts = await read("docs/concepts.rst");
  const limitations = await read("docs/limitations.rst");
  const document = {
    about: "Generated by scripts/idtrack-docs.ts from idtrack's documentation at the commit: do not edit.",
    commit,
    docsCommit,
    citation: { ...citationOf(authors), source: blob("docs/authors.rst", "citing-idtrack") },
    sources: { source: blob("docs/authors.rst", "data-sources"), items: sourcesOf(authors) },
    databases: {
      source: blob("docs/databases.rst", "the-names-a-graph-lists"),
      items: databasesOf(databases),
      projections: projectionsOf(databases),
      filing: blob("docs/databases.rst", "database-filing"),
    },
    assemblyMapping: {
      ...assemblyMappingOf(limitations),
      source: blob("docs/limitations.rst", "places-across-an-assembly-change"),
    },
    mappingScore: {
      text: mappingScoreOf(concepts),
      source: blob("docs/concepts.rst", "history-travel-and-ensembl-s-scores"),
    },
    events: { source: blob("docs/concepts.rst", "history-travel-and-ensembl-s-scores"), items: eventsOf(concepts) },
    limitations: { source: blob("docs/limitations.rst", "limitations"), items: limitationSentencesOf(limitations) },
    counts: {
      source: `${REPOSITORY}/blob/${commit}/idtrack/build/builder.py`,
      concepts: blob("docs/concepts.rst", "the-graph"),
      items: countMeaningsOf(
        await readCode("idtrack/build/builder.py"),
        await readCode("idtrack/graph/graph.py"),
        await readCode("idtrack/graph/record.py"),
        concepts,
      ),
    },
  };
  const text = await format(JSON.stringify(document), { ...(await resolveConfig(target)), filepath: target });
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== text) {
      console.error(
        "src/generated/idtrack_docs.json is not what idtrack's documentation gives: run `npm run idtrack-docs`.",
      );
      process.exit(1);
    }
    console.log(`src/generated/idtrack_docs.json matches idtrack ${docsCommit.slice(0, 12)}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    console.log(
      `wrote src/generated/idtrack_docs.json from idtrack ${docsCommit.slice(0, 12)} (the code of ${commit.slice(0, 12)})`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
