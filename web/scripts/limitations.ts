// The known limitations of idtrack that the answer's evidence cites, generated from idtrack's own documentation: the
// section "Limitations" of docs/limitations.rst at the documentation commit, the same commit as the Method page's
// (src/generated/idtrack_docs.json, scripts/idtrack-docs.ts): the code commit the api is pinned to (api/uv.lock) or a
// later commit of idtrack whose changes since it touch only documentation (docs/ and README.rst), which the generator
// checks. Each of the section's subsections is one limitation, which idtrack opens with a lead sentence in bold; each
// item is that lead sentence, as written, and the page links to the section at the documentation commit.
//
//   npm run limitations [-- --docs-commit <sha>]          fetch docs/limitations.rst from GitHub, write the file (the
//                                                         docs commit: the one given, else idtrack_docs.json's while
//                                                         it is of the same pin, else the pin)
//   npm run limitations -- --from <dir> [--docs-commit <sha>]   read a local checkout of idtrack instead
//   npm run limitations:check [-- --from <dir>]           fail when src/generated/limitations.json is not what it gives
//
// Run it after every change of the idtrack commit (SETUP.md, "The idtrack commit"); a unit test fails while the file
// names another code commit than api/uv.lock, or another documentation commit than idtrack_docs.json.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { format, resolveConfig } from "prettier";

const lockUrl = new URL("../../api/uv.lock", import.meta.url);
const target = fileURLToPath(new URL("../src/generated/limitations.json", import.meta.url));
const docsTarget = fileURLToPath(new URL("../src/generated/idtrack_docs.json", import.meta.url));
const REPOSITORY = "https://github.com/theislab/idtrack";

/** The idtrack commit of api/uv.lock (its git source, `...#<commit>`). */
export function pinnedCommit(lock: string): string {
  const found = /source = \{ git = "https:\/\/github\.com\/theislab\/idtrack\.git\?[^"#]*#([0-9a-f]{40})" \}/.exec(
    lock,
  )?.[1];
  if (found === undefined) throw new Error("api/uv.lock names no git commit of idtrack");
  return found;
}

/** RST inline markup as the page writes text: ``code`` and `code` as `code`, roles by their target's last name. */
function plain(text: string): string {
  return text
    .replace(/:py:\w+:`~?([^`]+)`/g, (_, name: string) => `\`${name.split(".").pop() ?? name}\``)
    .replace(/:ref:`([^`<]+?)\s*(<[^>]+>)?`/g, (_, label: string) => label.trim())
    .replace(/``([^`]+)``/g, "`$1`")
    .replace(/\s+/g, " ")
    .trim();
}

/** A section's title: a line of text underlined by a line of `mark` at least as long. */
function titleAt(lines: string[], i: number, mark: string): boolean {
  const line = lines[i] ?? "";
  const under = lines[i + 1] ?? "";
  return /^\S/.test(line) && under.length >= line.trim().length && new RegExp(`^\\${mark}{3,}$`).test(under);
}

/** The id docutils gives a section of this title (`docutils.nodes.make_id`), the anchor of its page on GitHub and on
 *  Read the Docs: lower case, every run of other characters than letters and digits one hyphen, no leading digit or
 *  hyphen, no trailing hyphen. */
export function sectionId(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "");
}

/** The limitations of the section "Limitations": one per subsection, its title, the anchor of the title and its
 *  opening text in bold (the lead sentence). */
export interface Limitation {
  title: string;
  anchor: string;
  lead: string;
}

export function sectionsOf(rst: string): Limitation[] {
  const lines = rst.split("\n");
  const start = lines.findIndex((line, i) => line.trim() === "Limitations" && titleAt(lines, i, "-"));
  if (start < 0) throw new Error("docs/limitations.rst has no section 'Limitations'");
  const rest = lines.slice(start + 2);
  // The section ends where the next section of its level begins.
  const next = rest.findIndex((_, i) => titleAt(rest, i, "-"));
  const section = next < 0 ? rest : rest.slice(0, next);
  const heads = section.flatMap((_, i) => (titleAt(section, i, "~") ? [i] : []));
  if (!heads.length) throw new Error("the section 'Limitations' has no subsections");
  return heads.map((head, k) => {
    const body = section
      .slice(head + 2, heads[k + 1] ?? section.length)
      .filter((line) => !/^\.\. _[^:]+:$/.test(line)) // the label of the next subsection
      .join("\n")
      .trim();
    const lead = /^\*\*([\s\S]+?)\*\*/.exec(body);
    const title = (section[head] ?? "").trim();
    if (lead?.[1] === undefined)
      throw new Error(`the limitation '${title}' does not open with a lead sentence in bold`);
    // A lead that is the start of its sentence is marked as continued in idtrack's text.
    const text = plain(lead[1]);
    return { title, anchor: sectionId(title), lead: /[.?!]$/.test(text) ? text : `${text} …` };
  });
}

/** The lead sentences of the section "Limitations": one per subsection, its opening text in bold. */
export function limitationsOf(rst: string): string[] {
  return sectionsOf(rst).map((section) => section.lead);
}

const argument = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};

/** Whether a path of idtrack's repository is documentation: the folder docs/ or the README. */
export function isDocumentation(path: string): boolean {
  return path.startsWith("docs/") || path === "README.rst";
}

/** The paths changed between two commits of idtrack: from a checkout, or from a clone of GitHub's repository without
 *  its files' contents (its trees are enough to list the paths). */
export async function changedPaths(from: string | null, base: string, head: string): Promise<string[]> {
  if (base === head) return [];
  let folder = from;
  if (!folder) {
    folder = await mkdtemp(join(tmpdir(), "idtrack-docs-"));
    execFileSync("git", ["clone", "--quiet", "--bare", "--filter=blob:none", `${REPOSITORY}.git`, folder]);
  }
  const out = execFileSync("git", ["-C", folder, "diff", "--name-only", base, head], { encoding: "utf8" });
  if (!from) await rm(folder, { recursive: true, force: true });
  return out.split("\n").filter(Boolean);
}

async function main() {
  const commit = pinnedCommit(await readFile(lockUrl, "utf8"));
  const from = argument("--from");
  // The documentation commit named, else the Method page's while it documents the same pin, else the pin itself.
  const docs = JSON.parse(await readFile(docsTarget, "utf8").catch(() => "{}")) as {
    commit?: string;
    docsCommit?: string;
  };
  const docsCommit = argument("--docs-commit") ?? (docs.commit === commit ? docs.docsCommit : null) ?? commit;
  if (!/^[0-9a-f]{40}$/.test(docsCommit)) throw new Error(`name the documentation commit in full: '${docsCommit}'`);
  const other = (await changedPaths(from, commit, docsCommit)).filter((path) => !isDocumentation(path));
  if (other.length)
    throw new Error(
      `idtrack ${docsCommit.slice(0, 12)} changes more than documentation since ${commit.slice(0, 12)}: ${other.join(", ")}`,
    );
  const raw = `https://raw.githubusercontent.com/theislab/idtrack/${docsCommit}/docs/limitations.rst`;
  let rst: string;
  if (from) {
    rst = execFileSync("git", ["-C", from, "show", `${docsCommit}:docs/limitations.rst`], { encoding: "utf8" });
  } else {
    const response = await fetch(raw);
    if (!response.ok) throw new Error(`${raw}: ${response.status}`);
    rst = await response.text();
  }
  const sections = sectionsOf(rst);
  const items = sections.map((section) => section.lead);
  const document = {
    about: "Generated by scripts/limitations.ts from idtrack's docs/limitations.rst at the commit: do not edit.",
    commit,
    docsCommit,
    source: `${REPOSITORY}/blob/${docsCommit}/docs/limitations.rst#limitations`,
    items,
    // Each limitation with its title and the anchor of its section in the documentation (the page at the
    // documentation commit: `source` without its fragment, then `#anchor`).
    sections,
  };
  const text = await format(JSON.stringify(document), { ...(await resolveConfig(target)), filepath: target });
  if (process.argv.includes("--check")) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== text) {
      console.error(
        "src/generated/limitations.json is not what idtrack's Limitations give: run `npm run limitations`.",
      );
      process.exit(1);
    }
    console.log(`src/generated/limitations.json matches idtrack ${docsCommit.slice(0, 12)} (${items.length} items)`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    console.log(
      `wrote src/generated/limitations.json from idtrack ${docsCommit.slice(0, 12)} (the code of ${commit.slice(0, 12)}; ${items.length} items)`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
