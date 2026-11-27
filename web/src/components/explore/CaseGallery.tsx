// Cases of Ensembl's history in the graph in view, from the server's showcase: each card names the phenomenon, says the
// concept in plain words (after idtrack's documentation, linked), draws the case's own answer as a small figure, and
// says the answer in one line with its numbers and its evidence marks (components/Evidence.tsx). Every value on a card
// is read from the case's answer; a card opens the full answer, where a strip steps through the cases.
import { docsPage } from "../../lib/links";
import { useId, type CSSProperties } from "react";
import type { Candidate, ConversionResult, GraphDescription, PathStep, ShowcaseResponse } from "../../api/types";
import { bestSteps, isCaseKind, type CaseKind } from "../../lib/home/caseKinds";
import { KIND_TEXT } from "../../lib/home/cases";
import { isEnsembl } from "../../lib/home/journeyModel";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { databaseLabel } from "../../lib/databases";
import { pythonFloat, releaseRanges } from "../../lib/numbers";
import { prose } from "../../lib/values";
import { spaced, type Vocabulary } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Evidence } from "../Evidence";
import { useShowcaseSymbols } from "../../lib/explore/useShowcaseSymbols";
import { api } from "../../api/client";
import { authorityOf } from "../../lib/symbols";
import { useRequest } from "../../lib/useRequest";
import { Link, Mono } from "../ui";
import { CaseSketch } from "./CaseSketch";

type ShowcaseCase = ShowcaseResponse["cases"][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function targetsOf(result: ConversionResult): string[] {
  return [...new Set(result.candidates.filter((c) => c.best).map((c) => c.target))];
}

/** The symbols of the genes a card names (an Ensembl gene id at the release it is named at), by id. */
type CaseSymbols = ReadonlyMap<string, readonly string[]> | null;

/** An Ensembl gene id with its symbol, where the name authority gives one. */
function Gene({ id, symbols }: { id: string; symbols: CaseSymbols }) {
  const sym = symbols?.get(id) ?? [];
  return (
    <>
      <Mono>{id}</Mono>
      {sym.length ? <span className="case__symbol"> ({sym.join(", ")})</span> : null}
    </>
  );
}

/** A list of ids at display size: the first few, then "and N more". */
function few(ids: readonly string[], shown = 2, symbols: CaseSymbols = null) {
  return (
    <>
      {ids.slice(0, shown).map((id, i) => (
        <span key={id}>
          {i ? ", " : ""}
          <Gene id={id} symbols={symbols} />
        </span>
      ))}
      {ids.length > shown ? ` and ${ids.length - shown} more` : ""}
    </>
  );
}

/** The step of a candidate's own path with one of `reasons` (the first). */
function candidateStep(result: ConversionResult, candidate: Candidate | undefined, reasons: readonly string[]) {
  if (!candidate) return undefined;
  const steps = result.path?.steps ?? [];
  return [...candidate.path, ...candidate.final_path].map((i) => steps[i]).find((x) => x && reasons.includes(x.reason));
}

const stepOf = (result: ConversionResult, reasons: readonly string[]): PathStep | undefined =>
  bestSteps(result).find((s) => reasons.includes(s.reason));

/** The facts of a case's answer, in one or two sentences, every value the api's. */
function CaseStory({
  kind,
  result,
  graph,
  vocabulary,
  symbols = null,
  authority = null,
}: {
  kind: CaseKind;
  result: ConversionResult;
  graph: GraphDescription;
  vocabulary: Vocabulary;
  symbols?: CaseSymbols;
  /** The organism's name authority at the release asked, where the database asked is a symbol database that is not it
   *  (a symbol Ensembl projects from another organism's authority): said beside the database. */
  authority?: string | null;
}) {
  const targets = targetsOf(result);
  const asm = (key: number | null) =>
    key === null ? "—" : (graph.assemblies.find((a) => a.assembly === key)?.name ?? String(key));
  const db =
    result.final_database === null || isEnsembl(result.final_database) ? null : databaseLabel(result.final_database);
  const read = (
    <>
      <Mono>{result.query_id}</Mono> read at {result.from_release}
    </>
  );
  const answer = (
    <>
      {few(targets, 2, db ? null : symbols)} at {result.to_release}
      {db ? ` in ${db}` : ""}
      {db && authority ? ` (not this organism's name authority, which is ${databaseLabel(authority)})` : ""}
    </>
  );
  const best = result.candidates.find((c) => c.best);
  const runnerUp = result.candidates.find((c) => !c.best);
  switch (kind) {
    case "renamed":
    case "final":
      return (
        <>
          {read}
          {result.from_databases.length ? ` (${result.from_databases.map(databaseLabel).join(", ")})` : ""} is {answer}.
        </>
      );
    case "new_version": {
      const n = bestSteps(result).filter((s) => s.reason === "new_version").length;
      return (
        <>
          {read} is {answer}: {plural(n, "new version")}, the product of Ensembl&apos;s scores{" "}
          <Mono>{best ? pythonFloat(best.score) : "—"}</Mono>.
        </>
      );
    }
    case "replaced": {
      const s = stepOf(result, ["replaced"]);
      return (
        <>
          {read} is {answer}: at releases {s?.old_release}→{s?.new_release} Ensembl replaced{" "}
          <Mono>{s?.source ?? "—"}</Mono> by <Mono>{s?.target ?? "—"}</Mono>, with its score{" "}
          <Mono>{s?.weight === null || s?.weight === undefined ? "—" : pythonFloat(s.weight)}</Mono>.
        </>
      );
    }
    case "split": {
      const s = stepOf(result, ["split", "split_and_merge"]);
      const decided = result.decided_by;
      const runner = runnerUp ? (candidateStep(result, runnerUp, ["split", "split_and_merge"]) ?? null) : null;
      const own = best ? (candidateStep(result, best, ["split", "split_and_merge"]) ?? null) : null;
      const place = (step: PathStep | null) => (step?.places ? ` (${spaced(step.places)})` : "");
      const weight = (step: PathStep | null) =>
        step?.weight === null || step?.weight === undefined ? "no score" : pythonFloat(step.weight);
      const same = own !== null && runner !== null && own.weight === runner.weight;
      return (
        <>
          {read}: at releases {s?.old_release}→{s?.new_release} Ensembl&apos;s history records a{" "}
          {spaced(s?.reason ?? "split")}; {plural(new Set(result.candidates.map((c) => c.gene)).size, "gene")} descend
          from it at {result.to_release}. The best is {few(targets, 1, symbols)}
          {runnerUp ? (
            <>
              , the next <Gene id={runnerUp.target} symbols={symbols} />
            </>
          ) : null}
          .{" "}
          {own && runner ? (
            same ? (
              <>
                The split itself scores both <Mono>{weight(own)}</Mono>
                {place(own) || place(runner) ? (
                  <>
                    {" "}
                    ({spaced(own.places ?? "—")}; {spaced(runner.places ?? "—")})
                  </>
                ) : null}
                ; the steps after it decide: the products of Ensembl&apos;s scores along each path are{" "}
                <Mono>{best ? pythonFloat(best.score) : "—"}</Mono> and <Mono>{pythonFloat(runnerUp?.score ?? 0)}</Mono>
              </>
            ) : (
              <>
                The split itself scores <Mono>{weight(own)}</Mono>
                {place(own)} and <Mono>{weight(runner)}</Mono>
                {place(runner)}; the products of Ensembl&apos;s scores along each path,{" "}
                <Mono>{best ? pythonFloat(best.score) : "—"}</Mono> and <Mono>{pythonFloat(runnerUp?.score ?? 0)}</Mono>
                , rank them
              </>
            )
          ) : (
            <>
              The product of Ensembl&apos;s scores along its path is <Mono>{best ? pythonFloat(best.score) : "—"}</Mono>
            </>
          )}
          {decided ? `; decided by ${spaced(decided)}` : ""}.
        </>
      );
    }
    case "merge": {
      const s = stepOf(result, ["merge", "split_and_merge"]);
      return (
        <>
          {read} is {answer}: at releases {s?.old_release}→{s?.new_release} Ensembl merged it with{" "}
          {plural(s?.merges ?? 0, "other gene")} into <Mono>{s?.target ?? "—"}</Mono>
          {s?.places ? ` (${spaced(s.places)})` : ""}.
        </>
      );
    }
    case "handoff":
    case "lineage": {
      const hand = bestSteps(result).filter(
        (s) =>
          (s.kind === "history" || s.kind === "self_loop") &&
          s.old_assembly !== null &&
          s.assembly !== null &&
          s.old_assembly !== s.assembly,
      );
      return (
        <>
          {read} is {answer}, across{" "}
          {hand.map((s, i) => (
            <span key={i}>
              {i ? ", " : ""}
              {asm(s.old_assembly)} → {asm(s.assembly)} at {s.old_release}→{s.new_release}
            </span>
          ))}
          .
        </>
      );
    }
    case "bridge": {
      const near = stepOf(result, ["bridge_near"]);
      const far = stepOf(result, ["bridge_far"]);
      return (
        <>
          {read} is {answer}: Ensembl&apos;s history of <Mono>{near?.source ?? "—"}</Mono> ends, and a bridge passes
          through{" "}
          {near ? (
            <>
              <Mono>{near.target}</Mono> ({near.databases.map(databaseLabel).join(", ")})
            </>
          ) : (
            "an external id"
          )}{" "}
          to <Gene id={far?.target ?? "—"} symbols={symbols} />
          {far?.places ? ` (${spaced(far.places)})` : ""}: idtrack&apos;s inference, marked as one.
        </>
      );
    }
    case "other_release": {
      const other = result.other_readings.find((r) => r.reason === "other_release");
      return (
        <>
          {read} is {answer}; at releases {other ? releaseRanges(other.releases) : "—"} the string meant{" "}
          {other?.genes.length ? few(other.genes, 1) : "another gene"}, reported beside the answer.
        </>
      );
    }
    case "tie":
      return (
        <>
          {read}: {plural(targets.length, "gene")} are equal in all the evidence that decides, and all are the answer:{" "}
          {few(targets)}.
        </>
      );
    case "retired": {
      const reason = result.reasons[0];
      const text = reason ? (vocabulary.reasons.get(reason) ?? null) : null;
      return (
        <>
          {read}: no answer at {result.to_release}. {text ? prose(text) : ""} Bridges were allowed, and none reaches
          another gene.
        </>
      );
    }
    case "refused": {
      const s = (result.path?.refused ?? []).find((x) => x.reason === "mitochondrial_genome");
      const near = stepOf(result, ["bridge_near"]);
      const far = stepOf(result, ["bridge_far"]);
      return (
        <>
          {read}: Ensembl&apos;s step <Mono>{s?.source ?? "—"}</Mono> → <Mono>{s?.target ?? "—"}</Mono> at releases{" "}
          {s?.old_release}→{s?.new_release} ({asm(s?.old_assembly ?? null)} → {asm(s?.assembly ?? null)}) is refused
          {targets.length ? <>; the answer is {answer}</> : "; no gene answers"}
          {near && far ? (
            <>
              , reached through a bridge (<Mono>{near.target}</Mono>, {near.databases.map(databaseLabel).join(", ")}
              {far.places ? `; ${spaced(far.places)}` : ""}): idtrack&apos;s inference
            </>
          ) : null}
          .
        </>
      );
    }
  }
}

/** What a sketch shows, for its accessible name. */
function sketchLabel(kind: CaseKind, result: ConversionResult): string {
  const targets = targetsOf(result);
  return `The answer drawn on the releases: ${result.query_id} from release ${result.from_release ?? "—"} to ${
    targets.length ? targets.join(", ") : "no gene"
  } at release ${result.to_release} (${KIND_TEXT[kind].title.toLowerCase()}).`;
}

export function CaseGallery({
  graph,
  cases,
  letter = "d",
  level = 2,
}: {
  graph: GraphDescription;
  cases: readonly ShowcaseCase[];
  /** The panel's letter in the page it stands on (none: no letter). */
  letter?: string | null;
  /** The level of the gallery's heading (its cards one below). */
  level?: 2 | 3;
}) {
  const vocabulary = useVocabulary();
  // The organism's name authority at each release (idtrack's symbol databases, the first a conversion can end in).
  const matrix = useRequest(`databases|${graph.organism}`, (signal, fresh) =>
    api.databases(graph.organism, { signal, fresh }),
  );
  const authorityFor = (result: ConversionResult): string | null => {
    if (matrix.state !== "done" || result.final_database === null) return null;
    const { symbol_databases: symbolDatabases, databases } = matrix.answer.data;
    if (!symbolDatabases.includes(result.final_database)) return null;
    const authority = authorityOf(symbolDatabases, databases, result.to_release);
    return authority !== null && authority !== result.final_database ? authority : null;
  };
  const H = level === 2 ? "h2" : "h3";
  const Card = level === 2 ? "h3" : "h4";
  const id = useId();
  const shown = cases.filter(
    (c): c is ShowcaseCase & { kind: CaseKind; result: ConversionResult } => Boolean(c.result) && isCaseKind(c.kind),
  );
  // The symbols of the Ensembl genes the cards name: the answers and the genes next to them, at the release asked.
  const named = shown.flatMap(({ result }) => {
    if (result.final_database !== null && !isEnsembl(result.final_database)) return [];
    const genes = new Set(result.candidates.slice(0, 3).map((c) => c.target));
    for (const s of bestSteps(result)) if (s.kind === "bridge_far") genes.add(s.target);
    return [...genes].filter((g) => /^ENS[A-Z]*G\d/.test(g)).map((gene) => ({ gene, release: result.to_release }));
  });
  const symbols = useShowcaseSymbols(graph.organism, named);
  if (!shown.length) return null;
  const rest3 = shown.length % 3 ? 3 - (shown.length % 3) : 3;
  const rest2 = shown.length % 2 ? 1 : 2;
  return (
    <section className="home-cases" aria-labelledby={`${id}-title`}>
      <div className="home-section-head">
        {letter ? (
          <span className="panel-letter" aria-hidden="true">
            {letter}
          </span>
        ) : null}
        <H id={`${id}-title`}>What can happen to a gene id</H>
        <p className="home-section-head__aside">
          {plural(shown.length, "case")} of this graph, each drawn from its answer (
          <span className="mono">GET /api/v1/organisms/{graph.organism}/showcase</span>)
        </p>
      </div>
      <ol className="cases">
        {shown.map((item, i) => {
          const text = KIND_TEXT[item.kind];
          const query = caseQueryOf(graph.organism, item.query);
          return (
            <li key={`${item.kind}-${i}`} className="case" data-kind={item.kind}>
              <CaseSketch result={item.result} graph={graph} label={sketchLabel(item.kind, item.result)} />
              <Card className="case__title">
                <Link
                  to={caseHref(query)}
                  className="case__link"
                  label={`${text.title}: open the answer to ${query.identifier}`}
                >
                  {text.title}
                </Link>
              </Card>
              <p className="case__concept">
                {text.concept}{" "}
                <a href={docsPage(text.href)} className="case__docs">
                  idtrack&apos;s documentation<span className="visually-hidden"> on {text.title.toLowerCase()}</span>
                </a>
              </p>
              <p className="case__story">
                <CaseStory
                  kind={item.kind}
                  result={item.result}
                  graph={graph}
                  vocabulary={vocabulary}
                  symbols={symbols}
                  authority={authorityFor(item.result)}
                />
              </p>
              <div className="case__evidence">
                <Evidence result={item.result} compact max={2} label={`Evidence of ${query.identifier}'s answer`} />
              </div>
              <p className="case__open" aria-hidden="true">
                Open the answer
              </p>
            </li>
          );
        })}
        <li className="case case--key" style={{ "--rest3": rest3, "--rest2": rest2 } as CSSProperties}>
          <Card className="case__title">Reading the sketches</Card>
          <p className="case__concept">
            Each sketch draws its case&apos;s answer on the stretch of releases it spans, zoomed: the strip above it is
            the graph&apos;s whole axis ({graph.releases[0]}–{graph.snapshot_release}, a tick at each change of
            assembly) with the stretch marked, and two hairlines open from it to the view. The glyphs are those of
            figure a: the release read (open circle, or an open square where it is read in an external database), the
            answer (a square), a new version (a tick), a split or merge (a dot), a re-mapping (an arc), an assembly
            change (a diamond), a bridge (a square with a dot). A split&apos;s or a tie&apos;s other genes branch off
            below, lighter; a refused step is a line that stops; another meaning of a name is a pale lane at its
            releases.
          </p>
        </li>
      </ol>
    </section>
  );
}
