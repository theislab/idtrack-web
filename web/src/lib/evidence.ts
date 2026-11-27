// The evidence of an answer that a reader should weigh before trusting it, read from the fields the api already
// returns and nothing else: where the answer rests on an inference no record of Ensembl states (a bridge), on a step
// that puts the gene elsewhere, on a step across assemblies whose places cannot be compared, on steps without Ensembl's
// score, on a match that is not the identifier as written (a synonym, letter case, a version newer than the graph), on
// a reading at another release than the one given, or where the string has another meaning at other releases.
//
// Each mark is a short label (the page's words), a sentence with the result's own values, the meaning of the code it is
// read from (idtrack's text, from `/vocabulary`), the field or code it comes from (shown on focus, for programmers),
// and, where idtrack's documentation states a limitation of that class, that limitation (its lead sentence and the
// anchor of its section, from `src/generated/limitations.json`). A "caution" changes how far an answer can be trusted;
// a "note" says something exact about it that is not a fault (the lowest of Ensembl's scores on the path, a Unicode
// form normalised). No threshold of the page's own is applied: a score is stated, not judged.
//
// The marks are about the best answer (the candidates marked best, and their paths where the result has them); a
// result without the path (`explain` off, a batch) gives the marks its candidates' fields support.
import type { ConversionResult, PathStep } from "../api/types";
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

export interface EvidenceMark {
  /** A stable key of the class of evidence (one mark per class and value). */
  kind:
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
    | "split_ranked";
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
} as const satisfies Record<string, readonly string[]>;

export function limitationAt(anchors: string | readonly string[]): Limitation | null {
  for (const anchor of typeof anchors === "string" ? [anchors] : anchors) {
    const section = SECTIONS.get(anchor);
    if (section) return { title: section.title, lead: section.lead, href: `${PAGE}#${section.anchor}` };
  }
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The steps of every best candidate's path, each once (a tie shares most of them). */
function bestSteps(result: ConversionResult): { step: PathStep; index: number }[] {
  const steps = result.path?.steps ?? [];
  const seen = new Set<number>();
  const out: { step: PathStep; index: number }[] = [];
  for (const candidate of result.candidates.filter((c) => c.best)) {
    for (const index of [...candidate.path, ...candidate.final_path]) {
      const step = steps[index];
      if (step && !seen.has(index)) {
        seen.add(index);
        out.push({ step, index });
      }
    }
  }
  return out;
}

const isHistory = (s: PathStep) => s.kind === "history" || s.kind === "self_loop";

/** A history step in Ensembl's direction: the releases of its event and its earlier and later ids, whichever way the
 *  walk went. */
function eventText(step: PathStep, result: ConversionResult): string {
  const nodes = new Map((result.path?.nodes ?? []).map((n) => [n.id, n]));
  const { earlier, later } = ensemblPair(step, historyDirection(step, nodes, result));
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

/** Every mark of the result's best answer, cautions first, each class once. */
export function evidenceOf(result: ConversionResult, vocabulary: Vocabulary = NO_VOCABULARY): EvidenceMark[] {
  const marks: EvidenceMark[] = [];
  const bests = result.candidates.filter((c) => c.best);
  const steps = bestSteps(result);
  const explained = result.path !== null && steps.length > 0;
  const field = (code: string) => vocabulary.candidateFields.get(code) ?? null;

  // A bridge: the walk left a gene through an id it carries and entered another gene that carries it.
  const bridged = bests.filter((c) => c.bridges > 0);
  if (bridged.length && !result.no_target) {
    const most = Math.max(...bridged.map((c) => c.bridges));
    const near = steps.filter(({ step }) => step.kind === "bridge_near").map(({ step }) => step.target);
    const through = [...new Set(near)];
    marks.push({
      kind: "bridge",
      tone: "caution",
      label: `through ${plural(most, "bridge")}`,
      detail:
        `The best answer is reached through ${plural(most, "bridge")}` +
        (through.length ? ` (through ${through.map((id) => `\`${id}\``).join(", ")})` : "") +
        ": where Ensembl's history gives a gene no successor, the walk leaves it through an id it carries and enters another gene that carries the same id. That is idtrack's inference; no record of Ensembl states it.",
      meaning: field("bridges"),
      code: "candidates[].bridges",
      limitation: limitationAt(LIMITATION_OF.bridge),
    });
  }

  if (bridged.length && !result.no_target && explained) {
    const nodes = new Map((result.path?.nodes ?? []).map((n) => [n.id, n]));
    // A bridge that joins two genes alive at the same release: the gene it enters is no successor in time of the gene
    // it leaves but a gene beside it (a host gene and the gene nested in it share ids so).
    const beside: string[] = [];
    for (const candidate of bridged) {
      const order = [...candidate.path, ...candidate.final_path];
      order.forEach((index, i) => {
        const near = result.path?.steps[index];
        if (near?.kind !== "bridge_near" || near.source === null) return;
        const far = order
          .slice(i + 1)
          .map((j) => result.path?.steps[j])
          .find((s) => s?.kind === "bridge_far");
        if (!far) return;
        const left = nodes.get(near.source);
        const right = nodes.get(far.target);
        const both = sharedReleases(left?.active ?? [], right?.active ?? []);
        if (!left || !right || !both) return;
        const text = `\`${left.label}\` (releases ${activeText(left.active)}) and \`${right.label}\` (releases ${activeText(right.active)}) both exist at release${both[0] === both[1] ? ` ${both[0]}` : `s ${activeText([both])}`}`;
        if (!beside.includes(text)) beside.push(text);
      });
    }
    if (beside.length) {
      marks.push({
        kind: "bridge_beside",
        tone: "caution",
        label:
          beside.length === 1
            ? "the bridge joins two genes of one time"
            : `${beside.length} bridges join genes of one time`,
        detail: `${beside.join("; ")}: the bridge joins two genes that lived side by side, so the gene it enters did not take the place of the gene it leaves in Ensembl's records; their shared ids are no sign of succession.`,
        meaning: field("bridges"),
        code: "path.nodes[].active",
        limitation: limitationAt(LIMITATION_OF.bridge),
      });
    }
    // The bridge chose the gene nearest in releases, while another gene reached by a bridge from the same gene carries
    // ids of it that the bridge taken does not: idtrack's documented class of a retired gene whose accession another
    // gene holds.
    if (result.decided_by === "bridge_gap") {
      const runner = result.candidates.find((c) => !c.best && c.bridges > 0);
      const best = bridged[0];
      if (runner && best) {
        const through = (candidate: typeof best) => {
          const genes = new Set(
            [...candidate.path, ...candidate.final_path].flatMap((i) => {
              const step = result.path?.steps[i];
              return step ? [step.source, step.target] : [];
            }),
          );
          return (result.path?.bridges ?? [])
            .filter((b) => b.taken && genes.has(b.target) && genes.has(b.source))
            .flatMap((b) => b.through.map(([id]) => id));
        };
        const taken = new Set(through(best));
        const label = (id: string) => nodes.get(id)?.label ?? id;
        const own = [...new Set(through(runner))].filter((id) => !taken.has(id));
        if (own.length) {
          marks.push({
            kind: "bridge_rival",
            tone: "caution",
            label: "another gene shares the bridged gene's ids",
            detail: `The bridge taken enters the gene nearest in releases. \`${runner.target}\` (rank ${result.candidates.indexOf(runner) + 1}), a gene at release ${result.to_release}, is reached by a bridge from the same gene through ids the bridge taken does not pass: ${own
              .slice(0, 6)
              .map((id) => `\`${label(id)}\``)
              .join(
                ", ",
              )}${own.length > 6 ? ` and ${own.length - 6} more` : ""}. It ranks below only by the bridge's gap in releases (${runner.bridge_gap} against ${best.bridge_gap}); the criteria before it are equal. Ask by such an id at release ${result.to_release} to have the gene that holds it then.`,
            meaning: vocabulary.criteria.find((c) => c.code === "bridge_gap")?.meaning ?? field("bridge_gap"),
            code: "decided_by = bridge_gap",
            limitation: limitationAt(LIMITATION_OF.retired_accession),
          });
        }
      }
    }
  }

  if (explained) {
    // A history step Ensembl recorded between genes that lie apart: the walk follows it, and the result does not say
    // that the gene moved.
    const apart = steps.filter(({ step }) => isHistory(step) && step.places === "places_apart");
    if (apart.length) {
      const first = apart[0]?.step;
      marks.push({
        kind: "places_apart",
        tone: "caution",
        label: apart.length === 1 ? "a step puts the gene elsewhere" : `${apart.length} steps put the gene elsewhere`,
        detail: first
          ? `Ensembl's history at ${eventText(first, result)} joins two genes that do not lie at one place; the walk follows Ensembl's record${apart.length > 1 ? ` (${plural(apart.length, "such step")} on the path)` : ""}.`
          : "",
        meaning: vocabulary.placeRelations.get("places_apart") ?? null,
        code: "path.steps[].places = places_apart",
        limitation: limitationAt(LIMITATION_OF.places_apart),
      });
    }
    // A step between assemblies (a history step, or a bridge taken) whose genes' places cannot be compared.
    const unknown = steps.filter(
      ({ step }) => isHistory(step) && step.places === "other_assemblies" && step.old_assembly !== step.assembly,
    );
    const bridgesUnknown = (result.path?.bridges ?? []).filter(
      (b) => b.taken && b.places === "other_assemblies" && steps.some(({ step }) => step.target === b.target),
    );
    if (unknown.length || bridgesUnknown.length) {
      const n = unknown.length + bridgesUnknown.length;
      marks.push({
        kind: "places_unknown",
        tone: "caution",
        label: n === 1 ? "places not compared across assemblies" : `${n} steps across assemblies, places not compared`,
        detail: `${plural(n, "step")} of the path join${n === 1 ? "s" : ""} genes that never lie on one assembly at the same time, and nothing tells them apart: where Ensembl publishes no mapping of the two assemblies, their places cannot be compared.`,
        meaning: vocabulary.placeRelations.get("other_assemblies") ?? null,
        code: "path.steps[].places = other_assemblies",
        limitation: limitationAt(LIMITATION_OF.places_unknown),
      });
    }
  }

  // Every gene of the best answer lies outside the reference sequence at the target release (on a haplotype, a patch
  // or an alternative locus): the answer holds no gene of the reference sequence.
  if (bests.length && !result.no_target && result.path) {
    const nodes = new Map(result.path.nodes.map((n) => [n.id, n]));
    const genes = [...new Set(bests.map((c) => c.gene))];
    const outside = genes.filter((g) =>
      (nodes.get(g)?.non_reference ?? []).some(([a, b]) => a <= result.to_release && result.to_release <= b),
    );
    if (genes.length && outside.length === genes.length) {
      const regions = [
        ...new Set(
          genes.flatMap((g) =>
            (nodes.get(g)?.places ?? [])
              .filter(
                (p) => !p.reference && p.releases.some(([a, b]) => a <= result.to_release && result.to_release <= b),
              )
              .map((p) => p.region),
          ),
        ),
      ];
      marks.push({
        kind: "outside_reference",
        tone: "caution",
        label:
          genes.length === 1
            ? "the answer lies outside the reference sequence"
            : "every answer lies outside the reference sequence",
        detail: `At release ${result.to_release}, ${genes.length === 1 ? "the gene of the best answer lies" : `all ${genes.length} genes of the best answer lie`} outside the reference sequence${
          regions.length
            ? ` (${regions
                .slice(0, 4)
                .map((r) => `\`${r}\``)
                .join(", ")}${regions.length > 4 ? ` and ${regions.length - 4} more` : ""})`
            : ""
        }: on a haplotype, a patch or an alternative locus. The answer holds no gene of the reference sequence.`,
        meaning: null,
        code: "path.nodes[].non_reference",
        limitation: limitationAt(LIMITATION_OF.copies),
      });
    }
  }

  // The best answer is also listed among the copies idtrack sets apart (an LRG record's gene id of the GRCh37
  // releases does so): the answer is right; code that drops the copies would drop it.
  const listed = [...new Set(bests.map((c) => c.gene))].filter((g) => result.alternative_locus_genes.includes(g));
  if (listed.length && !result.no_target) {
    marks.push({
      kind: "listed_as_copy",
      tone: "note",
      label: "the answer is also listed among the copies set apart",
      detail: `${listed.map((g) => `\`${g}\``).join(", ")}, the best answer, is also listed among the copies the result sets apart (\`alternative_locus_genes\`). The answer is the gene; code that drops the genes of that list from a result would drop it.`,
      meaning: null,
      code: "alternative_locus_genes",
      limitation: limitationAt(result.query_id.startsWith("LRG_") ? LIMITATION_OF.lrg_copy : LIMITATION_OF.copies),
    });
  }

  // A bare number is read in every database whose ids are numbers. Where the graph holds it only at an earlier release
  // than the target (its release inferred), it was an id of a database of that time, which may not be the one meant.
  if (/^\d+$/.test(result.query_id) && result.graph_id !== null && result.from_release !== null) {
    const read = result.from_databases.length ? result.from_databases.join(", ") : "a database";
    const old = result.from_release_inferred && result.from_release !== result.to_release;
    marks.push({
      kind: "bare_number",
      tone: old ? "caution" : "note",
      label: old ? `a number read as a ${read} id of release ${result.from_release}` : `a number read as a ${read} id`,
      detail: old
        ? `\`${result.query_id}\` is a bare number, and a number is read in every database whose ids are numbers. The graph holds it last at release ${result.from_release}, as a ${read} id, and read it there (the release was inferred: no database holds it at release ${result.to_release}). If it is another database's number (an NCBI gene id, for example), name that database as the source database.`
        : `\`${result.query_id}\` is a bare number, read as a ${read} id at release ${result.from_release}. A number is read in every database whose ids are numbers; to read it in one database only, name it as the source database.`,
      meaning: null,
      code: "from_databases",
      limitation: limitationAt(LIMITATION_OF.numbers),
    });
  }

  // Every target of the best answer is an id of one gene: idtrack follows an identifier through its gene, so in a
  // database of transcripts or proteins the answer is every id the gene carries, not the counterpart of the identifier.
  const bestGenes = new Set(bests.map((c) => c.gene));
  const bestTargets = new Set(bests.map((c) => c.target));
  if (bestGenes.size === 1 && bestTargets.size > 1 && !result.no_target) {
    const [gene] = [...bestGenes];
    marks.push({
      kind: "one_gene",
      tone: "note",
      label: `all ${bestTargets.size} ids of one gene`,
      detail: `The ${bestTargets.size} targets are the ids \`${gene ?? ""}\` carries in ${result.final_database ?? "the database asked"} at release ${result.to_release}. idtrack converts at the level of the gene: the identifier is read as its gene and followed as a gene, and the answer in the database asked is every id of the best gene there, not the counterpart of \`${result.query_id}\` alone.`,
      meaning: null,
      code: "candidates[].gene",
      limitation: null,
    });
  }

  // The best answer descends through a split of Ensembl's history and other successors were reached: idtrack ranks the
  // successors by Ensembl's scores and the evidence of the candidates, not by which of them lies where the old gene lay.
  if (explained && !result.no_target) {
    const split = steps.find(
      ({ step }) => step.kind === "history" && ["split", "split_and_merge"].includes(step.reason),
    );
    const others = new Set(result.candidates.filter((c) => !c.best).map((c) => c.gene));
    if (split && others.size) {
      marks.push({
        kind: "split_ranked",
        tone: "note",
        label: "a split: its successors ranked by score, not by place",
        detail: `The path of the best answer passes Ensembl's ${split.step.reason.replace(/_/g, " ")} at ${eventText(split.step, result)}, and ${plural(others.size, "other gene")} ${others.size === 1 ? "was" : "were"} reached. idtrack ranks the successors of a split by Ensembl's scores and the candidates' evidence, not by which of them lies where the old gene lay: the places of every gene of the path are in panel e, every candidate in the decision.`,
        meaning: vocabulary.stepReasons.get(split.step.reason) ?? null,
        code: "path.steps[].reason = split",
        limitation: limitationAt(LIMITATION_OF.split_place),
      });
    }
  }

  // Steps between two different ids without Ensembl's score: they rank below every path whose scores are measured.
  const unscored = Math.max(0, ...bests.map((c) => c.unscored_steps));
  if (unscored > 0 && !result.no_target) {
    marks.push({
      kind: "unscored",
      tone: "caution",
      label: `${plural(unscored, "step")} without Ensembl's score`,
      detail: `The path of the best answer holds ${plural(unscored, "history step")} between two different stable ids to which Ensembl gave no score.`,
      meaning: field("unscored_steps"),
      code: "candidates[].unscored_steps",
      limitation: null,
    });
  }

  // The target is attached to a transcript or translation the gene had at another release.
  if (bests.some((c) => c.final_confidence === 1)) {
    marks.push({
      kind: "final_other_release",
      tone: "caution",
      label: "target attached at another release",
      detail:
        "The id in the database asked is attached, at the target release, to a transcript or translation that belonged to the gene at another release, not to the gene itself.",
      meaning: vocabulary.stepReasons.get("final_other_release") ?? field("final_confidence"),
      code: "candidates[].final_confidence = 1",
      limitation: null,
    });
  }

  // The identifier was read at another release than the one given.
  if (result.reasons.includes("read_at_another_release") && result.from_release !== null) {
    marks.push({
      kind: "read_at_another_release",
      tone: "caution",
      label: `read at release ${result.from_release}, not ${result.from_release_given ?? "—"}`,
      detail: `The graph does not hold \`${result.query_id}\` at release ${result.from_release_given ?? "—"}, the release given; it was read at release ${result.from_release}, where the graph holds it. The answer is what the identifier meant there.`,
      meaning: vocabulary.reasons.get("read_at_another_release") ?? null,
      code: "reasons: read_at_another_release",
      limitation: null,
    });
  }

  // How the identifier matched: anything but the identifier as written.
  if (result.match) {
    const parts = result.match.split(":");
    const step = parts.pop() ?? "";
    const synonym = parts.includes("synonym");
    const loose = step === "case" || step === "separator";
    const matchMarks: { label: string; tone: EvidenceTone; meaning: string | null; code: string }[] = [];
    if (synonym)
      matchMarks.push({
        label: "read as a synonym",
        tone: "caution",
        meaning: vocabulary.matchPrefixes.get("synonym") ?? null,
        code: "synonym",
      });
    if (parts.includes("copy"))
      matchMarks.push({
        label: "read as a copy of another item",
        tone: "caution",
        meaning: vocabulary.matchPrefixes.get("copy") ?? null,
        code: "copy",
      });
    if (loose)
      matchMarks.push({
        label: step === "case" ? "read without letter case" : "read with separators taken as one",
        tone: "caution",
        meaning: vocabulary.matchSteps.get(step) ?? null,
        code: step,
      });
    if (step === "version_newer_than_graph")
      matchMarks.push({
        label: "version newer than the graph: read as its latest",
        tone: "caution",
        meaning: vocabulary.matchSteps.get(step) ?? null,
        code: step,
      });
    if (step === "version_not_judged")
      matchMarks.push({
        label: "version not judged",
        tone: "note",
        meaning: vocabulary.matchSteps.get(step) ?? null,
        code: step,
      });
    for (const prefix of ["unicode", "punctuation", "par_y", "lrg"]) {
      if (parts.includes(prefix))
        matchMarks.push({
          label:
            prefix === "unicode"
              ? "Unicode normalised"
              : prefix === "punctuation"
                ? "punctuation removed"
                : prefix === "par_y"
                  ? "Y copy read as its gene"
                  : "LRG record read as its gene",
          tone: "note",
          meaning: vocabulary.matchPrefixes.get(prefix) ?? null,
          code: prefix,
        });
    }
    for (const m of matchMarks) {
      marks.push({
        kind: "match",
        tone: m.tone,
        label: m.label,
        detail: `\`${result.query_id}\` matched \`${result.graph_id ?? "—"}\` as \`${result.match}\`.`,
        meaning: m.meaning,
        code: `match: ${m.code}`,
        limitation: synonym && loose && m.code === "synonym" ? limitationAt(LIMITATION_OF.case_synonym) : null,
      });
    }
  }

  // What the string means at other releases, and the other readings idtrack reports.
  for (const reading of result.other_readings) {
    const genes = reading.genes.length ? reading.genes.map((g) => `\`${g}\``).join(", ") : "no gene";
    if (reading.reason === "other_release" && reading.releases.length) {
      const readAt = reading.releases[reading.releases.length - 1];
      marks.push({
        kind: "other_release",
        tone: "caution",
        label: `another meaning at releases ${releaseRanges(reading.releases)}`,
        detail: `At releases ${releaseRanges(reading.releases)}, \`${result.query_id}\` ${reading.graph_id === result.query_id ? "named another gene" : `was read as \`${reading.graph_id}\``}; read there, it answers ${genes} at release ${result.to_release}. Without a release it is read as it is at release ${result.from_release ?? "—"}; a list made at that other time means that gene.`,
        meaning: vocabulary.readingReasons.get("other_release") ?? null,
        code: "other_readings[].reason = other_release",
        limitation: limitationAt(LIMITATION_OF.other_release),
        ...(readAt !== undefined ? { readAt } : {}),
      });
    } else {
      marks.push({
        kind: "other_reading",
        tone: reading.reason === "same_step" ? "note" : "caution",
        label:
          reading.reason === "same_step"
            ? `also read as \`${reading.graph_id}\``
            : `another reading: \`${reading.graph_id}\``,
        detail: `\`${result.query_id}\` is also read as \`${reading.graph_id}\` (matched as \`${reading.match}\`; its answer: ${genes}).`,
        meaning: vocabulary.readingReasons.get(reading.reason) ?? null,
        code: `other_readings[].reason = ${reading.reason}`,
        limitation: reading.reason === "make_unique_suffix" ? limitationAt(LIMITATION_OF.suffix) : null,
      });
    }
  }

  // The lowest of Ensembl's scores on the path of the best answer, where a step was scored below 1: stated exactly.
  if (explained && !result.no_target) {
    const scored = steps.filter(({ step }) => isHistory(step) && step.weight !== null && step.weight < 1);
    if (scored.length) {
      let low = scored[0];
      for (const s of scored) if ((s.step.weight ?? 1) < (low?.step.weight ?? 1)) low = s;
      const weight = low?.step.weight;
      if (low && typeof weight === "number") {
        marks.push({
          kind: "lowest_score",
          tone: "note",
          label: `lowest Ensembl score ${pythonFloat(weight)}`,
          detail: `The lowest of Ensembl's mapping scores on the path of the best answer is ${pythonFloat(weight)}, at ${eventText(low.step, result)}. The candidate's score is the product of the scores along its path.`,
          meaning: vocabulary.stepReasons.get(low.step.reason) ?? null,
          code: "path.steps[].weight",
          limitation: null,
        });
      }
    }
  }

  // Cautions first; within a tone, in the order above (the order in which a reader meets them on the path).
  return [...marks.filter((m) => m.tone === "caution"), ...marks.filter((m) => m.tone === "note")];
}

/** The number of cautions: an answer without any is shown as plainly converted. */
export function cautionCount(marks: readonly EvidenceMark[]): number {
  return marks.filter((m) => m.tone === "caution").length;
}
