// The evidence of an answer that a reader should weigh before trusting it, read from the fields the api already
// returns and nothing else: where the answer rests on an inference no record of Ensembl states (a bridge), on a step
// that puts the gene elsewhere, on a step across assemblies whose places cannot be compared, on steps without Ensembl's
// score, on a match that is not the identifier as written (a synonym, letter case, a version newer than the graph), on
// a reading at another release than the one given, where the string has another meaning at other releases, and where
// another gene than the best answer may be the one meant (a gene ranked below carries the name typed, the name is read
// only through sources that give it to other genes, the id's own continuation ranks below a branch).
//
// Each mark is a short label (the page's words), a sentence with the result's own values, the meaning of the code it is
// read from (idtrack's text, from `/vocabulary`), the field or code it comes from (shown on focus, for programmers),
// and, where idtrack's documentation states a limitation of that class, that limitation (its lead sentence and the
// anchor of its section, from `src/generated/limitations.json`). A "caution" changes how far an answer can be trusted;
// a "note" says something exact about it that is not a fault (the lowest of Ensembl's scores on the path, a Unicode
// form normalised). No threshold of the page's own is applied: a score is stated, not judged.
//
// The marks are about the best answer (the candidates marked best, and their paths where the result has them); a
// result without the path (`explain` off, a batch) gives the marks its candidates' fields support. Two classes need
// more than the result: the genes' symbols at the target release (a gene ranked below carries the name typed) and the
// organism's symbol databases (a symbol database that is not the organism's name authority); they are given where the
// page has asked for them (`EvidenceFacts`), and left out where it has not.
//
// The rules stand in one table (`RULES`), one function per class, in the order a reader meets them on the path.
import type { Candidate, ConversionResult, PathNode, PathStep } from "../api/types";
import limitations from "../generated/limitations.json";
import { pythonFloat, releaseRanges } from "./numbers";
import { ensemblPair, historyDirection } from "./pathModel";
import { NO_VOCABULARY, type Vocabulary } from "./vocabulary";

type EvidenceTone = "caution" | "note";

export interface Limitation {
  title: string;
  lead: string;
  /** The section of idtrack's documentation at the commit the api is pinned to. */
  href: string;
}

/** A conversion a mark offers as the way on: the result's own, with the parts named here changed. */
export interface EvidenceAsk {
  /** What the link says ("Ask Rhbg at release 115"). */
  words: string;
  identifier?: string;
  fromRelease?: number | null;
  toRelease?: number;
  /** The database to convert to (`null`: Ensembl genes); left out, the one asked. */
  finalDatabase?: string | null;
  fromDatabase?: string | null;
}

export type EvidenceKind =
  | "bridge"
  | "places_apart"
  | "places_unknown"
  | "unscored"
  | "lowest_score"
  | "final_other_release"
  | "read_at_another_release"
  | "match"
  | "other_release"
  | "other_reading"
  | "bare_number"
  | "outside_reference"
  | "listed_as_copy"
  | "bridge_beside"
  | "bridge_rival"
  | "one_gene"
  | "split_ranked"
  | "name_elsewhere"
  | "runner_named"
  | "own_continuation"
  | "projected_symbols";

export interface EvidenceMark {
  /** A stable key of the class of evidence (one mark per class and value). */
  kind: EvidenceKind;
  tone: EvidenceTone;
  /** A few words, shown in the mark. */
  label: string;
  /** What the result says, with its own values (code spans in backticks). */
  detail: string;
  /** idtrack's text of the code the mark is read from, where the api gives one. */
  meaning: string | null;
  /** The field or code of the result the mark is read from, as the api names it. */
  code: string;
  limitation: Limitation | null;
  /** A release at which to read the identifier again (the release a reading of another time holds). */
  readAt?: number;
  /** The conversion that answers what the mark doubts, where one does. */
  ask?: EvidenceAsk;
  /** Another gene than the best answer may be the gene meant: said beside the status, not only among the marks. */
  alert?: boolean;
}

/** What the page knows beside the result, for the marks that need it. */
export interface EvidenceFacts {
  /** The organism's symbol databases in idtrack's order (`symbol_databases` of `/databases`): the first is its name
   *  authority. */
  symbolDatabases?: readonly string[] | null;
  /** Each gene's symbols in the name authority at the target release (`lib/symbols.ts`). */
  symbols?: { database: string; of: ReadonlyMap<string, readonly string[]> } | null;
  /** The database the conversion asked for (a result without an id there names Ensembl genes as its database). */
  asked?: string | null;
}

/** The sections of idtrack's limitations by the anchor of their title (`scripts/limitations.ts`). */
const SECTIONS = new Map(limitations.sections.map((s) => [s.anchor, s]));
const PAGE = limitations.source.replace(/#.*$/, "");

/** The anchors of the limitations each class of evidence falls under (the titles of idtrack's sections), the first
 *  that the generated file holds: idtrack's documentation can retitle a section (a newer title first, the title of
 *  the pinned commit after it). A unit test fails when no anchor of a class is a section of the generated file. */
export const LIMITATION_OF = {
  bridge: ["answers-that-only-a-bridge-reaches"],
  places_apart: ["an-id-that-ensembl-moves-to-another-place"],
  places_unknown: ["places-across-an-assembly-change"],
  other_release: ["without-a-release-a-string-is-what-it-means-today"],
  case_synonym: ["symbols-typed-in-small-letters-where-symbols-are-written-in-capitals"],
  suffix: ["single-cell-suffixes-after-a-name-that-is-no-authority-s-symbol"],
  numbers: ["numbers-that-several-numbering-schemes-share"],
  split_place: ["among-the-successors-of-a-split-the-best-answer-does-not-look-at-the-old-place"],
  copies: ["copies-on-patches-and-alternative-loci"],
  lrg_copy: ["the-grch37-gene-ids-of-lrg-records-list-their-answer-among-the-copies"],
  retired_accession: ["a-retired-gene-whose-accession-another-gene-holds-today"],
  not_held: ["databases-the-graph-does-not-hold"],
  other_sources: ["a-name-that-another-source-gives-another-gene"],
  authority_other_gene: ["a-symbol-of-the-name-authority-can-answer-another-gene"],
  own_continuation: ["a-branch-can-outrank-the-gene-s-own-continuation"],
} as const satisfies Record<string, readonly string[]>;

export function limitationAt(anchors: string | readonly string[]): Limitation | null {
  for (const anchor of typeof anchors === "string" ? [anchors] : anchors) {
    const section = SECTIONS.get(anchor);
    if (section) return { title: section.title, lead: section.lead, href: `${PAGE}#${section.anchor}` };
  }
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const code = (id: string) => `\`${id}\``;
/** "A, B and C". */
const listWords = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
/** Ranks in words: "rank 2", "ranks 4–6", "ranks 2, 5". */
function rankWords(ranks: readonly number[]): string {
  const sorted = [...ranks].sort((a, b) => a - b);
  if (sorted.length === 1) return `rank ${sorted[0] ?? ""}`;
  return `ranks ${releaseRanges(sorted)}`;
}

/** The stable id of an Ensembl id with a version (`ENSG00000141510.5` → `ENSG00000141510`), else the id. */
function stableOf(id: string | null): string | null {
  if (id === null) return null;
  return /^(ENS[A-Z]*[GTP]\d+)\.\d+$/.exec(id)?.[1] ?? id;
}

const isHistory = (s: PathStep) => s.kind === "history" || s.kind === "self_loop";

/** What every rule reads: the result, and what is worked out from it once. */
interface Context {
  result: ConversionResult;
  vocabulary: Vocabulary;
  facts: EvidenceFacts;
  bests: Candidate[];
  /** The steps of every best candidate's path, each once (a tie shares most of them). */
  steps: { step: PathStep; index: number }[];
  /** The result holds the path of its best answer. */
  explained: boolean;
  nodes: Map<string, PathNode>;
  field: (code: string) => string | null;
}

function contextOf(result: ConversionResult, vocabulary: Vocabulary, facts: EvidenceFacts): Context {
  const bests = result.candidates.filter((c) => c.best);
  const all = result.path?.steps ?? [];
  const seen = new Set<number>();
  const steps: { step: PathStep; index: number }[] = [];
  // One candidate of each distinct path to its gene (a gene's hundreds of targets share it; the marks read its steps).
  for (const candidate of distinctPaths(bests)) {
    for (const index of [...candidate.path, ...candidate.final_path]) {
      const step = all[index];
      if (step && !seen.has(index)) {
        seen.add(index);
        steps.push({ step, index });
      }
    }
  }
  return {
    result,
    vocabulary,
    facts,
    bests,
    steps,
    explained: result.path !== null && steps.length > 0,
    nodes: new Map((result.path?.nodes ?? []).map((n) => [n.id, n])),
    field: (name: string) => vocabulary.candidateFields.get(name) ?? null,
  };
}

/** A candidate's steps in the walk's order (its path to the gene, then its final path). */
function stepsOf(c: Context, candidate: Candidate): PathStep[] {
  return [...candidate.path, ...candidate.final_path].flatMap((i) => {
    const step = c.result.path?.steps[i];
    return step ? [step] : [];
  });
}

/** A history step in Ensembl's direction: the releases of its event and its earlier and later ids, whichever way the
 *  walk went. */
function eventText(step: PathStep, c: Context): string {
  const { earlier, later } = ensemblPair(step, historyDirection(step, c.nodes, c.result));
  return `releases ${step.old_release ?? "—"} → ${step.new_release ?? "—"} (\`${earlier ?? "—"}\` → \`${later ?? "—"}\`)`;
}

/** Releases as Ensembl writes a gene's life: "62–75", "115 on" (still active at the graph's last release). */
function activeText(active: readonly (readonly [number, number | null])[]): string {
  return active.map(([a, b]) => (b === null ? `${a} on` : a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** The first and last release at which both lives hold (`null` last: both still active), or null where they never
 *  meet. */
function sharedReleases(
  a: readonly (readonly [number, number | null])[],
  b: readonly (readonly [number, number | null])[],
): [number, number | null] | null {
  let first: number | null = null;
  let last: number | null = null;
  let open = false;
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1 ?? Number.POSITIVE_INFINITY, b1 ?? Number.POSITIVE_INFINITY);
      if (lo > hi) continue;
      first = first === null ? lo : Math.min(first, lo);
      if (Number.isFinite(hi)) last = last === null ? hi : Math.max(last, hi);
      else open = true;
    }
  if (first === null) return null;
  return [first, open ? null : last];
}

/** The bridges a candidate's path takes: the gene each leaves (its `bridge_near` step's source) and the gene it enters
 *  (the next `bridge_far` step's target), in the walk's order. */
export function bridgesTaken(result: ConversionResult, candidate: Candidate): { source: string; target: string }[] {
  const steps = [...candidate.path, ...candidate.final_path].map((i) => result.path?.steps[i]);
  const out: { source: string; target: string }[] = [];
  steps.forEach((near, i) => {
    if (near?.kind !== "bridge_near" || near.source === null) return;
    const far = steps.slice(i + 1).find((s) => s?.kind === "bridge_far");
    if (far) out.push({ source: near.source, target: far.target });
  });
  return out;
}

/** The candidates of distinct paths to their gene (the targets of one gene share it: a gene's hundreds of ids are one
 *  path), the first of each. */
function distinctPaths(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((x) => {
    const key = x.path.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The bridges the best answer's paths take, each pair of genes once (a tie shares them). */
function bestBridges(c: Context): { source: string; target: string }[] {
  const out: { source: string; target: string }[] = [];
  for (const candidate of distinctPaths(c.bests))
    for (const pair of bridgesTaken(c.result, candidate))
      if (!out.some((p) => p.source === pair.source && p.target === pair.target)) out.push(pair);
  return out;
}

type Rule = (c: Context) => EvidenceMark | EvidenceMark[] | null;

/** A bridge: the walk left a gene through an id it carries and entered another gene that carries it. */
const bridge: Rule = (c) => {
  const bridged = c.bests.filter((x) => x.bridges > 0);
  if (!bridged.length || c.result.no_target) return null;
  const most = Math.max(...bridged.map((x) => x.bridges));
  const through = [
    ...new Set(c.steps.filter(({ step }) => step.kind === "bridge_near").map(({ step }) => step.target)),
  ];
  return {
    kind: "bridge",
    tone: "caution",
    label: `through ${plural(most, "bridge")}`,
    detail:
      `The best answer is reached through ${plural(most, "bridge")}` +
      (through.length ? ` (through ${through.map(code).join(", ")})` : "") +
      ": where Ensembl's history gives a gene no successor, the walk leaves it through an id it carries and enters another gene that carries the same id. That is idtrack's inference; no record of Ensembl states it.",
    meaning: c.field("bridges"),
    code: "candidates[].bridges",
    limitation: limitationAt(LIMITATION_OF.bridge),
  };
};

/** A bridge that joins two genes alive at the same release: the gene it enters is no successor in time of the gene it
 *  leaves but a gene beside it (a host gene and the gene nested in it share ids so). */
const bridgeBeside: Rule = (c) => {
  if (!c.explained || c.result.no_target) return null;
  const beside: string[] = [];
  for (const { source, target } of bestBridges(c)) {
    const left = c.nodes.get(source);
    const right = c.nodes.get(target);
    const both = sharedReleases(left?.active ?? [], right?.active ?? []);
    if (!left || !right || !both) continue;
    const text = `\`${left.label}\` (releases ${activeText(left.active)}) and \`${right.label}\` (releases ${activeText(right.active)}) both exist at release${both[0] === both[1] ? ` ${both[0]}` : `s ${activeText([both])}`}`;
    if (!beside.includes(text)) beside.push(text);
  }
  if (!beside.length) return null;
  return {
    kind: "bridge_beside",
    tone: "caution",
    label:
      beside.length === 1
        ? "the bridge joins two genes of one time"
        : `${beside.length} bridges join genes of one time`,
    detail: `${beside.join("; ")}: the bridge joins two genes that lived side by side, so the gene it enters did not take the place of the gene it leaves in Ensembl's records; their shared ids are no sign of succession.`,
    meaning: c.field("bridges"),
    code: "path.nodes[].active",
    limitation: limitationAt(LIMITATION_OF.bridge),
  };
};

/** The bridge chose the gene nearest in releases, while another gene reached by a bridge from the same gene carries
 *  ids of it that the bridge taken does not: idtrack's documented class of a retired gene whose accession another gene
 *  holds. */
const bridgeRival: Rule = (c) => {
  const best = c.bests.find((x) => x.bridges > 0);
  if (!best || c.result.no_target || !c.explained || c.result.decided_by !== "bridge_gap") return null;
  const runner = c.result.candidates.find((x) => !x.best && x.bridges > 0);
  if (!runner) return null;
  const through = (candidate: Candidate) => {
    const pairs = bridgesTaken(c.result, candidate);
    return (c.result.path?.bridges ?? [])
      .filter((b) => b.taken && pairs.some((p) => p.source === b.source && p.target === b.target))
      .flatMap((b) => b.through.map(([id]) => id));
  };
  const taken = new Set(through(best));
  const label = (id: string) => c.nodes.get(id)?.label ?? id;
  const own = [...new Set(through(runner))].filter((id) => !taken.has(id));
  if (!own.length) return null;
  const to = c.result.to_release;
  // The way on: an id of another database first (an accession the gene that holds it today carries), else the first.
  const first = label(own.find((id) => c.nodes.get(id)?.kind === "external") ?? own[0] ?? "");
  return {
    kind: "bridge_rival",
    tone: "caution",
    alert: true,
    label: "another gene shares the bridged gene's ids",
    detail: `The bridge taken enters the gene nearest in releases. \`${runner.target}\` (rank ${c.result.candidates.indexOf(runner) + 1}), a gene at release ${to}, is reached by a bridge from the same gene through ids the bridge taken does not pass: ${own
      .slice(0, 6)
      .map((id) => code(label(id)))
      .join(
        ", ",
      )}${own.length > 6 ? ` and ${own.length - 6} more` : ""}. It ranks below only by the bridge's gap in releases (${runner.bridge_gap} against ${best.bridge_gap}); the criteria before it are equal. Ask by such an id at release ${to} to have the gene that holds it then.`,
    meaning: c.vocabulary.criteria.find((x) => x.code === "bridge_gap")?.meaning ?? c.field("bridge_gap"),
    code: "decided_by = bridge_gap",
    limitation: limitationAt(LIMITATION_OF.retired_accession),
    ask: { words: `Ask ${first} at release ${to}`, identifier: first, fromRelease: to, toRelease: to },
  };
};

/** A gene ranked below the best answer carries, at the target release, the name typed, and no gene of the best answer
 *  does: the name follows its gene from the release it was read at, and at the target release it is another gene's
 *  (read from the genes' symbols in the organism's name authority at that release). */
const runnerNamed: Rule = (c) => {
  const symbols = c.facts.symbols;
  if (!symbols || !c.bests.length || c.result.no_target || c.result.graph_id === null) return null;
  const typed = c.result.query_id.toLowerCase();
  const named = (gene: string) => (symbols.of.get(gene) ?? []).some((s) => s.toLowerCase() === typed);
  if (c.bests.some((x) => named(x.gene))) return null;
  const below = c.result.candidates.map((x, i) => ({ x, rank: i + 1 })).filter(({ x }) => !x.best && named(x.gene));
  const first = below[0];
  if (!first) return null;
  const to = c.result.to_release;
  const bestGenes = [...new Set(c.bests.map((x) => x.gene))];
  const bestNames = bestGenes.map((g) => {
    const own = symbols.of.get(g) ?? [];
    return own.length ? `${code(g)} carries ${own.map(code).join(", ")}` : `${code(g)} carries none`;
  });
  const genes = [...new Set(below.map(({ x }) => x.gene))];
  const atOwnRelease = c.result.from_release === to;
  const split = c.steps.some(
    ({ step }) => step.kind === "history" && ["split", "split_and_merge"].includes(step.reason),
  );
  return {
    kind: "runner_named",
    tone: "caution",
    alert: true,
    label: `a gene ranked below carries ${code(c.result.query_id)} at ${to}`,
    detail: `At release ${to}, ${listWords(genes.map(code))} (${rankWords(below.map((b) => b.rank))}) carr${genes.length === 1 ? "ies" : "y"} ${code(c.result.query_id)} as ${symbols.database}; of the best answer, ${listWords(bestNames)}. ${
      atOwnRelease
        ? "idtrack ranked the best answer first by the evidence of the candidates (Ensembl's display name, then the support of the name)."
        : `The name was read at release ${c.result.from_release ?? "—"} and followed through Ensembl's history to ${to}${split ? ", where its gene's successors are ranked by Ensembl's scores" : ""}; at ${to} the name is another gene's.`
    } Ask ${code(c.result.query_id)} at release ${to} to read the name as it is then.`,
    meaning: null,
    code: `${symbols.database} at ${to}`,
    limitation: limitationAt(
      atOwnRelease
        ? LIMITATION_OF.authority_other_gene
        : split
          ? LIMITATION_OF.split_place
          : LIMITATION_OF.other_release,
    ),
    ask: { words: `Ask ${c.result.query_id} at release ${to}`, fromRelease: to, toRelease: to },
  };
};

/** The name is read through several databases at the release read, but the best answer through some of them only, and
 *  no gene of it has the name from a name authority or as Ensembl's display name: the databases left out give the name
 *  to other genes (ranked below, or among the copies set apart). A synonym has its own mark. */
const nameElsewhere: Rule = (c) => {
  const r = c.result;
  if (!c.bests.length || r.no_target || !r.match || r.match.split(":").includes("synonym")) return null;
  if (c.bests.some((x) => x.authority || x.display_name)) return null;
  const reached = new Set(c.bests.flatMap((x) => x.entry_databases));
  if (!reached.size) return null;
  const left = r.from_databases.filter((d) => !reached.has(d));
  if (!left.length) return null;
  const below = r.candidates
    .map((x, i) => ({ x, rank: i + 1 }))
    .filter(({ x }) => !x.best && x.entry_databases.some((d) => left.includes(d)));
  const copies = r.alternative_locus_genes.length;
  const where = [
    below.length
      ? `${plural(new Set(below.map((b) => b.x.gene)).size, "gene")} ranked below (${rankWords(below.map((b) => b.rank))})`
      : "",
    copies
      ? `the ${plural(copies, "copy", "copies")} on haplotypes, patches or alternative loci the result sets apart`
      : "",
  ].filter(Boolean);
  // The database to name: the organism's name authority where the page knows it and it is among those left out.
  const authority = c.facts.symbolDatabases?.[0];
  const source = authority && left.includes(authority) ? authority : (left[0] ?? "");
  return {
    kind: "name_elsewhere",
    tone: "caution",
    alert: true,
    label: `the best answer is read only through ${listWords([...reached])}`,
    detail: `At release ${r.from_release ?? "—"}, ${code(r.query_id)} is read through ${listWords(r.from_databases)}, but the best answer through ${listWords([...reached])} alone: no gene of it has the name from a name authority or as Ensembl's display name. The genes to which ${listWords(left)} give${left.length === 1 ? "s" : ""} the name are not in the best answer${where.length ? `; they are among ${listWords(where)}` : ""}. Name the database to read the name in it alone.`,
    meaning: c.field("authority"),
    code: "candidates[].entry_databases, authority, display_name",
    limitation: limitationAt(LIMITATION_OF.other_sources),
    ask: { words: `Ask with ${source} as the source database`, fromDatabase: source },
  };
};

/** The best answer's path leaves the entry gene's stable id while the id itself lived on (a candidate ranked below
 *  follows it to a later version): a branch outranks the id's own continuation (forward in time only). */
const ownContinuation: Rule = (c) => {
  const r = c.result;
  if (!c.explained || r.no_target || r.from_release === null || r.to_release <= r.from_release) return null;
  const entry = c.bests[0]?.entry_gene ?? null;
  const own = stableOf(entry);
  if (!own || own === entry) return null;
  // The release at which a candidate's path leaves the id for another stable id (Ensembl's old release), if it does.
  const leaves = (candidate: Candidate) =>
    stepsOf(c, candidate).find(
      (s) => isHistory(s) && stableOf(s.source) === own && stableOf(s.target) !== own && s.old_release !== null,
    );
  // The last release to which a candidate's path follows the id itself (a version step of the id: its new release).
  const lives = (candidate: Candidate) =>
    Math.max(
      -1,
      ...stepsOf(c, candidate)
        .filter(
          (s) => isHistory(s) && s.source !== s.target && stableOf(s.source) === own && stableOf(s.target) === own,
        )
        .map((s) => s.new_release ?? -1),
    );
  const bests = distinctPaths(c.bests);
  const left = bests.map(leaves);
  if (left.some((s) => !s)) return null;
  const leftAt = Math.max(...left.map((s) => s?.old_release ?? -1));
  if (bests.some((x) => lives(x) > leftAt)) return null;
  const livesOf = new Map<string, number>();
  const continuing = r.candidates
    .map((x, i) => {
      const key = x.path.join(",");
      const at = livesOf.get(key) ?? lives(x);
      livesOf.set(key, at);
      return { x, rank: i + 1, at };
    })
    .filter(({ x, at }) => !x.best && at > leftAt);
  const first = left[0];
  if (!continuing.length || !first) return null;
  const step = continuing
    .flatMap(({ x }) => stepsOf(c, x))
    .find((s) => isHistory(s) && stableOf(s.source) === own && stableOf(s.target) === own && s.source !== s.target);
  return {
    kind: "own_continuation",
    tone: "caution",
    alert: true,
    label: "the id's own continuation ranks below a branch",
    detail: `The best answer's path leaves ${code(own)} at ${eventText(first, c)}, while the id itself lived on${step ? ` (${eventText(step, c)})` : ""}. The candidates that follow the id's own continuation rank ${rankWords(continuing.map((x) => x.rank)).replace(/^ranks? /, "")}: idtrack ranks a branch and the id's continuation by the product of Ensembl's scores.`,
    meaning: c.vocabulary.criteria.find((x) => x.code === "score")?.meaning ?? c.field("score"),
    code: "candidates[].path",
    limitation: limitationAt(LIMITATION_OF.own_continuation),
  };
};

/** A history step Ensembl recorded between genes that lie apart: the walk follows it, and the result does not say
 *  that the gene moved. */
const placesApart: Rule = (c) => {
  if (!c.explained) return null;
  const apart = c.steps.filter(({ step }) => isHistory(step) && step.places === "places_apart");
  const first = apart[0]?.step;
  if (!first) return null;
  return {
    kind: "places_apart",
    tone: "caution",
    label: apart.length === 1 ? "a step puts the gene elsewhere" : `${apart.length} steps put the gene elsewhere`,
    detail: `Ensembl's history at ${eventText(first, c)} joins two genes that do not lie at one place; the walk follows Ensembl's record${apart.length > 1 ? ` (${plural(apart.length, "such step")} on the path)` : ""}.`,
    meaning: c.vocabulary.placeRelations.get("places_apart") ?? null,
    code: "path.steps[].places = places_apart",
    limitation: limitationAt(LIMITATION_OF.places_apart),
  };
};

/** A step of the best answer's path between assemblies whose genes' places cannot be compared: a history step, or a
 *  bridge the path takes (the pair of genes it leaves and enters, as `path.bridges` records it). */
const placesUnknown: Rule = (c) => {
  if (!c.explained) return null;
  const history = c.steps.filter(
    ({ step }) => isHistory(step) && step.places === "other_assemblies" && step.old_assembly !== step.assembly,
  ).length;
  const records = c.result.path?.bridges ?? [];
  const bridges = bestBridges(c).filter(({ source, target }) =>
    records.some((b) => b.taken && b.source === source && b.target === target && b.places === "other_assemblies"),
  ).length;
  const n = history + bridges;
  if (!n) return null;
  const parts = [history ? plural(history, "history step") : "", bridges ? plural(bridges, "bridge") : ""].filter(
    Boolean,
  );
  return {
    kind: "places_unknown",
    tone: "caution",
    label: n === 1 ? "places not compared across assemblies" : `${n} steps across assemblies, places not compared`,
    detail: `${listWords(parts)} of the best answer's path join${n === 1 ? "s" : ""} genes that never lie on one assembly at the same time, and nothing tells them apart: where Ensembl publishes no mapping of the two assemblies, their places cannot be compared.`,
    meaning: c.vocabulary.placeRelations.get("other_assemblies") ?? null,
    code: bridges
      ? "path.steps[].places, path.bridges[].places = other_assemblies"
      : "path.steps[].places = other_assemblies",
    limitation: limitationAt(LIMITATION_OF.places_unknown),
  };
};

/** Every gene of the best answer lies outside the reference sequence at the target release (on a haplotype, a patch or
 *  an alternative locus): the answer holds no gene of the reference sequence. */
const outsideReference: Rule = (c) => {
  const r = c.result;
  if (!c.bests.length || r.no_target || !r.path) return null;
  const genes = [...new Set(c.bests.map((x) => x.gene))];
  const at = (ranges: readonly (readonly [number, number])[]) =>
    ranges.some(([a, b]) => a <= r.to_release && r.to_release <= b);
  const outside = genes.filter((g) => at(c.nodes.get(g)?.non_reference ?? []));
  if (!genes.length || outside.length !== genes.length) return null;
  const regions = [
    ...new Set(
      genes.flatMap((g) =>
        (c.nodes.get(g)?.places ?? []).filter((p) => !p.reference && at(p.releases)).map((p) => p.region),
      ),
    ),
  ];
  return {
    kind: "outside_reference",
    tone: "caution",
    label:
      genes.length === 1
        ? "the answer lies outside the reference sequence"
        : "every answer lies outside the reference sequence",
    detail: `At release ${r.to_release}, ${genes.length === 1 ? "the gene of the best answer lies" : `all ${genes.length} genes of the best answer lie`} outside the reference sequence${
      regions.length
        ? ` (${regions.slice(0, 4).map(code).join(", ")}${regions.length > 4 ? ` and ${regions.length - 4} more` : ""})`
        : ""
    }: on a haplotype, a patch or an alternative locus. The answer holds no gene of the reference sequence.`,
    meaning: null,
    code: "path.nodes[].non_reference",
    limitation: limitationAt(LIMITATION_OF.copies),
  };
};

/** The best answer is also listed among the copies idtrack sets apart (an LRG record's gene id of the GRCh37 releases
 *  does so): the answer is right; code that drops the copies would drop it. */
const listedAsCopy: Rule = (c) => {
  const listed = [...new Set(c.bests.map((x) => x.gene))].filter((g) => c.result.alternative_locus_genes.includes(g));
  if (!listed.length || c.result.no_target) return null;
  return {
    kind: "listed_as_copy",
    tone: "note",
    label: "the answer is also listed among the copies set apart",
    detail: `${listed.map(code).join(", ")}, the best answer, is also listed among the copies the result sets apart (\`alternative_locus_genes\`). The answer is the gene; code that drops the genes of that list from a result would drop it.`,
    meaning: null,
    code: "alternative_locus_genes",
    limitation: limitationAt(c.result.query_id.startsWith("LRG_") ? LIMITATION_OF.lrg_copy : LIMITATION_OF.copies),
  };
};

/** The readings of a number written with a version that the number rule names itself (the same digits without the
 *  version, read in another database), so that they are not marked twice. */
function numberReadings(c: Context) {
  return /^\d+\.\d+$/.test(c.result.query_id)
    ? c.result.other_readings.filter((o) => o.reason === "unversioned_database")
    : [];
}

/** A number (bare, or written with a version) is read in every database whose ids are numbers. Where the graph holds it
 *  only at an earlier release than the target (its release inferred), it was an id of a database of that time, which
 *  may not be the one meant; a number written with a version is read where its version exists, and its digits alone
 *  are reported as the other reading. */
const number: Rule = (c) => {
  const r = c.result;
  const form = /^(\d+)(?:\.(\d+))?$/.exec(r.query_id);
  if (!form || r.graph_id === null || r.from_release === null) return null;
  const read = r.from_databases.length ? r.from_databases.join(", ") : "a database";
  const old = r.from_release_inferred && r.from_release !== r.to_release;
  const version = form[2];
  const digits = form[1] ?? r.query_id;
  const others = numberReadings(c);
  const symbol = (gene: string) => {
    const own = c.facts.symbols?.of.get(gene) ?? [];
    return own.length ? ` (${own.join(", ")})` : "";
  };
  const otherText = others.length
    ? ` Read without its version, as ${code(digits)}, it answers ${others
        .flatMap((o) => o.genes)
        .map((g) => `${code(g)}${symbol(g)}`)
        .join(
          ", ",
        )}: another gene${others.some((o) => o.genes.length > 1) ? "s" : ""}, reported by idtrack beside the answer.`
    : "";
  const what = version
    ? `${code(r.query_id)} is a number written with the version ${version}`
    : `${code(r.query_id)} is a bare number`;
  return {
    kind: "bare_number",
    tone: old || others.length ? "caution" : "note",
    label: old ? `a number read as a ${read} id of release ${r.from_release}` : `a number read as a ${read} id`,
    detail: old
      ? `${what}, and a number is read in every database whose ids are numbers. The graph holds it last at release ${r.from_release}, as a ${read} id${version ? ` (version ${version})` : ""}, and read it there (the release was inferred: no database holds it at release ${r.to_release}). If it is another database's number (an NCBI gene id, for example), name that database as the source database${version ? ", or write it without the version" : ""}.${otherText}`
      : `${what}, read as a ${read} id at release ${r.from_release}. A number is read in every database whose ids are numbers; to read it in one database only, name it as the source database.${otherText}`,
    meaning: others[0] ? (c.vocabulary.readingReasons.get(others[0].reason) ?? null) : null,
    code: others.length ? "from_databases, other_readings[].reason = unversioned_database" : "from_databases",
    limitation: limitationAt(LIMITATION_OF.numbers),
    ...(version && others.length ? { ask: { words: `Ask ${digits} without the version`, identifier: digits } } : {}),
  };
};

/** Every target of the best answer is an id of one gene: idtrack follows an identifier through its gene, so in a
 *  database of transcripts or proteins the answer is every id the gene carries, not the counterpart of the identifier. */
const oneGene: Rule = (c) => {
  const genes = new Set(c.bests.map((x) => x.gene));
  const targets = new Set(c.bests.map((x) => x.target));
  if (genes.size !== 1 || targets.size <= 1 || c.result.no_target) return null;
  const [gene] = [...genes];
  return {
    kind: "one_gene",
    tone: "note",
    label: `all ${targets.size} ids of one gene`,
    detail: `The ${targets.size} targets are the ids \`${gene ?? ""}\` carries in ${c.result.final_database ?? "the database asked"} at release ${c.result.to_release}. idtrack converts at the level of the gene: the identifier is read as its gene and followed as a gene, and the answer in the database asked is every id of the best gene there, not the counterpart of \`${c.result.query_id}\` alone.`,
    meaning: null,
    code: "candidates[].gene",
    limitation: null,
  };
};

/** The best answer descends through a split of Ensembl's history and other successors were reached: idtrack ranks the
 *  successors by Ensembl's scores and the evidence of the candidates, not by which of them lies where the old gene lay. */
const splitRanked: Rule = (c) => {
  if (!c.explained || c.result.no_target) return null;
  const split = c.steps.find(
    ({ step }) => step.kind === "history" && ["split", "split_and_merge"].includes(step.reason),
  );
  const others = new Set(c.result.candidates.filter((x) => !x.best).map((x) => x.gene));
  if (!split || !others.size) return null;
  return {
    kind: "split_ranked",
    tone: "note",
    label: "a split: its successors ranked by score, not by place",
    detail: `The path of the best answer passes Ensembl's ${split.step.reason.replace(/_/g, " ")} at ${eventText(split.step, c)}, and ${plural(others.size, "other gene")} ${others.size === 1 ? "was" : "were"} reached. idtrack ranks the successors of a split by Ensembl's scores and the candidates' evidence, not by which of them lies where the old gene lay: the places of every gene of the path are in panel e, every candidate in the decision.`,
    meaning: c.vocabulary.stepReasons.get(split.step.reason) ?? null,
    code: "path.steps[].reason = split",
    limitation: limitationAt(LIMITATION_OF.split_place),
  };
};

/** Steps between two different ids without Ensembl's score: they rank below every path whose scores are measured. */
const unscored: Rule = (c) => {
  const n = Math.max(0, ...c.bests.map((x) => x.unscored_steps));
  if (n <= 0 || c.result.no_target) return null;
  return {
    kind: "unscored",
    tone: "caution",
    label: `${plural(n, "step")} without Ensembl's score`,
    detail: `The path of the best answer holds ${plural(n, "history step")} between two different stable ids to which Ensembl gave no score.`,
    meaning: c.field("unscored_steps"),
    code: "candidates[].unscored_steps",
    limitation: null,
  };
};

/** The target is attached to a transcript or translation the gene had at another release. */
const finalOtherRelease: Rule = (c) =>
  c.bests.some((x) => x.final_confidence === 1)
    ? {
        kind: "final_other_release",
        tone: "caution",
        label: "target attached at another release",
        detail:
          "The id in the database asked is attached, at the target release, to a transcript or translation that belonged to the gene at another release, not to the gene itself.",
        meaning: c.vocabulary.stepReasons.get("final_other_release") ?? c.field("final_confidence"),
        code: "candidates[].final_confidence = 1",
        limitation: null,
      }
    : null;

/** The identifier was read at another release than the one given. */
const readElsewhere: Rule = (c) => {
  const r = c.result;
  if (!r.reasons.includes("read_at_another_release") || r.from_release === null) return null;
  return {
    kind: "read_at_another_release",
    tone: "caution",
    label: `read at release ${r.from_release}, not ${r.from_release_given ?? "—"}`,
    detail: `The graph does not hold \`${r.query_id}\` at release ${r.from_release_given ?? "—"}, the release given; it was read at release ${r.from_release}, where the graph holds it. The answer is what the identifier meant there.`,
    meaning: c.vocabulary.reasons.get("read_at_another_release") ?? null,
    code: "reasons: read_at_another_release",
    limitation: null,
  };
};

/** How the identifier matched: anything but the identifier as written. */
const match: Rule = (c) => {
  const r = c.result;
  if (!r.match) return null;
  const parts = r.match.split(":");
  const step = parts.pop() ?? "";
  const synonym = parts.includes("synonym");
  const loose = step === "case" || step === "separator";
  const v = c.vocabulary;
  const found: { label: string; tone: EvidenceTone; meaning: string | null; code: string }[] = [];
  if (synonym)
    found.push({
      label: "read as a synonym",
      tone: "caution",
      meaning: v.matchPrefixes.get("synonym") ?? null,
      code: "synonym",
    });
  if (parts.includes("copy"))
    found.push({
      label: "read as a copy of another item",
      tone: "caution",
      meaning: v.matchPrefixes.get("copy") ?? null,
      code: "copy",
    });
  if (loose)
    found.push({
      label: step === "case" ? "read without letter case" : "read with separators taken as one",
      tone: "caution",
      meaning: v.matchSteps.get(step) ?? null,
      code: step,
    });
  if (step === "version_newer_than_graph")
    found.push({
      label: "version newer than the graph: read as its latest",
      tone: "caution",
      meaning: v.matchSteps.get(step) ?? null,
      code: step,
    });
  if (step === "version_not_judged")
    found.push({ label: "version not judged", tone: "note", meaning: v.matchSteps.get(step) ?? null, code: step });
  const notes: Record<string, string> = {
    unicode: "Unicode normalised",
    punctuation: "punctuation removed",
    par_y: "Y copy read as its gene",
    lrg: "LRG record read as its gene",
  };
  for (const [prefix, label] of Object.entries(notes))
    if (parts.includes(prefix))
      found.push({ label, tone: "note", meaning: v.matchPrefixes.get(prefix) ?? null, code: prefix });
  return found.map((m) => ({
    kind: "match" as const,
    tone: m.tone,
    label: m.label,
    detail: `\`${r.query_id}\` matched \`${r.graph_id ?? "—"}\` as \`${r.match ?? ""}\`.`,
    meaning: m.meaning,
    code: `match: ${m.code}`,
    limitation: synonym && loose && m.code === "synonym" ? limitationAt(LIMITATION_OF.case_synonym) : null,
  }));
};

/** What the string means at other releases, and the other readings idtrack reports (but those the number rule names). */
const readings: Rule = (c) => {
  const r = c.result;
  const named = new Set(numberReadings(c));
  return r.other_readings
    .filter((reading) => !named.has(reading))
    .map((reading): EvidenceMark => {
      const genes = reading.genes.length ? reading.genes.map(code).join(", ") : "no gene";
      if (reading.reason === "other_release" && reading.releases.length) {
        const readAt = reading.releases[reading.releases.length - 1];
        return {
          kind: "other_release",
          tone: "caution",
          label: `another meaning at releases ${releaseRanges(reading.releases)}`,
          detail: `At releases ${releaseRanges(reading.releases)}, \`${r.query_id}\` ${reading.graph_id === r.query_id ? "named another gene" : `was read as \`${reading.graph_id}\``}; read there, it answers ${genes} at release ${r.to_release}. Without a release it is read as it is at release ${r.from_release ?? "—"}; a list made at that other time means that gene.`,
          meaning: c.vocabulary.readingReasons.get("other_release") ?? null,
          code: "other_readings[].reason = other_release",
          limitation: limitationAt(LIMITATION_OF.other_release),
          ...(readAt !== undefined ? { readAt } : {}),
        };
      }
      return {
        kind: "other_reading",
        tone: reading.reason === "same_step" ? "note" : "caution",
        label:
          reading.reason === "same_step"
            ? `also read as \`${reading.graph_id}\``
            : `another reading: \`${reading.graph_id}\``,
        detail: `\`${r.query_id}\` is also read as \`${reading.graph_id}\` (matched as \`${reading.match}\`; its answer: ${genes}).`,
        meaning: c.vocabulary.readingReasons.get(reading.reason) ?? null,
        code: `other_readings[].reason = ${reading.reason}`,
        limitation: reading.reason === "make_unique_suffix" ? limitationAt(LIMITATION_OF.suffix) : null,
      };
    });
};

/** The database asked is a symbol database of the graph that is not the organism's name authority: its symbols are
 *  another authority's, projected onto the organism's genes (idtrack's documentation of databases). */
const projectedSymbols: Rule = (c) => {
  const order = c.facts.symbolDatabases;
  const asked = c.facts.asked ?? c.result.final_database;
  const authority = order?.[0];
  if (!order || !asked || !authority || asked === authority || !order.includes(asked)) return null;
  return {
    kind: "projected_symbols",
    tone: "note",
    label: `${asked} is not this organism's name authority`,
    detail: `${asked} is a symbol database of this graph, after ${authority} in idtrack's order of the organism's symbol databases: it holds another authority's symbols as Ensembl projects them onto this organism's genes. The organism's own name authority is ${authority}.`,
    meaning: null,
    code: "final_database; symbol_databases",
    limitation: null,
    ask: { words: `Ask in ${authority}`, finalDatabase: authority },
  };
};

/** The lowest of Ensembl's scores on the path of the best answer, where a step was scored below 1: stated exactly. */
const lowestScore: Rule = (c) => {
  if (!c.explained || c.result.no_target) return null;
  let low: PathStep | null = null;
  for (const { step } of c.steps)
    if (isHistory(step) && step.weight !== null && step.weight < 1 && (low === null || step.weight < (low.weight ?? 1)))
      low = step;
  if (low?.weight === null || low?.weight === undefined) return null;
  return {
    kind: "lowest_score",
    tone: "note",
    label: `lowest Ensembl score ${pythonFloat(low.weight)}`,
    detail: `The lowest of Ensembl's mapping scores on the path of the best answer is ${pythonFloat(low.weight)}, at ${eventText(low, c)}. The candidate's score is the product of the scores along its path.`,
    meaning: c.vocabulary.stepReasons.get(low.reason) ?? null,
    code: "path.steps[].weight",
    limitation: null,
  };
};

/** Every class of evidence, in the order a reader meets them: what the answer may be instead first, then the path. */
const RULES: readonly Rule[] = [
  bridge,
  bridgeBeside,
  bridgeRival,
  runnerNamed,
  nameElsewhere,
  ownContinuation,
  placesApart,
  placesUnknown,
  outsideReference,
  listedAsCopy,
  number,
  oneGene,
  splitRanked,
  unscored,
  finalOtherRelease,
  readElsewhere,
  match,
  readings,
  projectedSymbols,
  lowestScore,
];

/** Every mark of the result's best answer, cautions first, each class once. */
export function evidenceOf(
  result: ConversionResult,
  vocabulary: Vocabulary = NO_VOCABULARY,
  facts: EvidenceFacts = {},
): EvidenceMark[] {
  const c = contextOf(result, vocabulary, facts);
  const marks = RULES.flatMap((rule) => {
    const out = rule(c);
    return out === null ? [] : Array.isArray(out) ? out : [out];
  });
  // Cautions first; within a tone, in the order of the rules.
  return [...marks.filter((m) => m.tone === "caution"), ...marks.filter((m) => m.tone === "note")];
}

/** The number of cautions: an answer without any is shown as plainly converted. */
export function cautionCount(marks: readonly EvidenceMark[]): number {
  return marks.filter((m) => m.tone === "caution").length;
}
