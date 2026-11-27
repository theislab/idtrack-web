// Cases of Ensembl's history in the graph in view, from the server's showcase: each card names the phenomenon, says the
// concept in plain words (after idtrack's documentation, linked), draws the case's own answer as a small figure, and
// says the answer in one line with its numbers and its evidence marks (components/Evidence.tsx). Every value on a card
// is read from the case's answer; a card opens the full answer, where a strip steps through the cases.
import { docsPage } from "../../lib/links";
import { useEffect, useId, useState, type ReactNode } from "react";
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
import { CaseSketch, type SketchLife } from "./CaseSketch";
import { GeneBar, GlyphSwatch } from "../figure/glyphs";
import { keyMarks, lastRelease, type KeyMark } from "../../lib/explore/sketch";

type ShowcaseCase = ShowcaseResponse["cases"][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rangeOf = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** How long the gallery waits for the symbols, the organism's databases and the lives of genes that answer nothing,
 *  which change the cards' words, before it draws the cards without what has not come (ms): within it nothing moves. */
const SETTLE_MS = 2500;

/** The lives of the genes the gallery's answers that reach nothing name where they are read: each such identifier
 *  converted at the release it is read at, with its path (the gene's `active` releases), as the answer page asks it
 *  (the same request, held for the page session). */
function useLives(organism: string, cases: readonly { kind: string; result: ConversionResult }[]) {
  const ended = cases.filter(
    (c) => c.kind === "retired" && c.result.graph_id !== null && c.result.from_release !== null,
  );
  const key = ended.length
    ? `lives|${organism}|${ended.map((c) => `${c.result.graph_id ?? ""}@${c.result.from_release ?? ""}`).join(",")}`
    : null;
  return useRequest(key, async (signal, fresh) => {
    const answers = await Promise.all(
      ended.map(({ result }) =>
        api.convert(
          organism,
          {
            identifier: result.graph_id ?? "",
            from_release: result.from_release,
            to_release: result.from_release,
            explain: true,
            allow_bridges: false,
          },
          { signal, fresh },
        ),
      ),
    );
    const lives = new Map<ConversionResult, SketchLife | null>();
    ended.forEach(({ result }, i) => {
      const at = answers[i]?.data;
      const nodes = new Map((at?.path?.nodes ?? []).map((n) => [n.id, n]));
      const gene = at?.candidates.map((c) => nodes.get(c.gene)).find((n) => n?.active.length);
      lives.set(result, gene ? { gene: gene.id, active: gene.active.map(([a, b]) => [a, b]) } : null);
    });
    const first = answers[0];
    if (!first) throw new Error("no answer");
    return { ...first, data: lives };
  });
}

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
  life = null,
}: {
  kind: CaseKind;
  result: ConversionResult;
  graph: GraphDescription;
  vocabulary: Vocabulary;
  symbols?: CaseSymbols;
  /** The organism's name authority at the release asked, where the database asked is a symbol database that is not it
   *  (a symbol Ensembl projects from another organism's authority): said beside the database. */
  authority?: string | null;
  /** For an answer that reaches nothing: the life of the gene the identifier names where it is read. */
  life?: SketchLife | null;
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
      const last = life ? lastRelease(life.active) : null;
      return (
        <>
          {read}
          {life ? (
            <>
              : it names <Mono>{life.gene}</Mono> there, which exists at releases{" "}
              {releaseRanges(life.active.flatMap(([a, b]) => (b === null ? [a] : rangeOf(a, b))))}
              {last !== null ? <>, the last {last}</> : null}
            </>
          ) : null}
          ; no answer at {result.to_release}. {text ? prose(text) : ""} Bridges were allowed, and none reaches another
          gene.
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
function sketchLabel(kind: CaseKind, result: ConversionResult, life: SketchLife | null = null): string {
  const targets = targetsOf(result);
  const last = life ? lastRelease(life.active) : null;
  const lived = life && last !== null ? `; ${life.gene} exists until release ${last}` : "";
  return `The answer drawn on the releases: ${result.query_id} from release ${result.from_release ?? "—"} to ${
    targets.length ? targets.join(", ") : "no gene"
  } at release ${result.to_release}${lived} (${KIND_TEXT[kind].title.toLowerCase()}).`;
}

/** A swatch of a mark the sketches draw that is not one glyph of the grammar, with the sketches' own classes. */
function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg className="fig-swatch" width={30} height={16} viewBox="0 0 30 16" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The key of the sketches: each mark beside its word, drawn by the same components and classes as the sketches. */
const KEY: [KeyMark, ReactNode, string][] = [
  ["form", <GlyphSwatch key="form" glyph="form" />, "the release read"],
  ["read", <GlyphSwatch key="read" glyph="read" />, "read in an external database"],
  [
    "answer",
    <Swatch key="answer">
      <rect x={12} y={5} width={6} height={6} className="jr-end" />
    </Swatch>,
    "the answer",
  ],
  ["final", <GlyphSwatch key="final" glyph="final" />, "the answer in an external database"],
  ["version", <GlyphSwatch key="version" glyph="version" />, "a new version or a replacement"],
  ["event", <GlyphSwatch key="event" glyph="event" />, "a split or a merge"],
  ["loop", <GlyphSwatch key="loop" glyph="loop" />, "a re-mapping of a gene to itself"],
  ["handoff", <GlyphSwatch key="handoff" glyph="handoff" />, "a step across an assembly change"],
  ["bridge", <GlyphSwatch key="bridge" glyph="bridge" />, "a bridge through an id two genes carried"],
  [
    "branch",
    <Swatch key="branch">
      <line x1={6} x2={6} y1={3} y2={12} className="case-sketch__branch" />
      <GeneBar x0={6} x1={26} y={12} size="thin" strong={false} />
    </Swatch>,
    "another gene of a split or a tie",
  ],
  [
    "ended",
    <Swatch key="ended">
      <line x1={2} x2={12} y1={8} y2={8} className="case-sketch__stop" />
      <line x1={12} x2={12} y1={3} y2={13} className="case-sketch__cap" />
      <line x1={15} x2={22} y1={8} y2={8} className="jr-wait" />
      <rect x={23} y={5} width={6} height={6} className="case-sketch__empty" />
    </Swatch>,
    "a gene's last release, and no answer",
  ],
  [
    "other",
    <Swatch key="other">
      <rect x={3} y={5} width={24} height={6} className="case-sketch__other" />
    </Swatch>,
    "the releases a name meant another gene",
  ],
];

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
  const { symbols, settled } = useShowcaseSymbols(graph.organism, named);
  const lives = useLives(graph.organism, shown);
  // The cards are drawn once what changes their words has come (or after SETTLE_MS), in the room held for them, so
  // that no card grows under the reader's eyes.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWaited(true);
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  const ready = waited || (settled && matrix.state !== "loading" && lives.state !== "loading");
  const lifeOf = (result: ConversionResult) =>
    lives.state === "done" ? (lives.answer.data.get(result) ?? null) : null;
  const drawn = keyMarks(shown.map((c) => c.result));
  if (!shown.length) return null;
  if (!ready) return <div className="stories-reserve stories-reserve--cases" aria-busy="true" />;
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
              <CaseSketch
                result={item.result}
                graph={graph}
                label={sketchLabel(item.kind, item.result, lifeOf(item.result))}
                life={lifeOf(item.result)}
                symbols={symbols}
              />
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
                  life={lifeOf(item.result)}
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
        <li className="case case--key">
          <Card className="case__title">Reading the sketches</Card>
          <p className="case__concept">
            Each sketch draws its case&apos;s answer on the stretch of releases it spans, zoomed: the line above it is
            the graph&apos;s whole axis ({graph.releases[0]}–{graph.snapshot_release}, a tick at each change of
            assembly) with the stretch marked, two hairlines opening from it to the view.
          </p>
          <ul className="case-key" aria-label="The marks of the sketches">
            {KEY.filter(([key]) => drawn.has(key)).map(([key, swatch, words]) => (
              <li key={key}>
                {swatch}
                <span>{words}</span>
              </li>
            ))}
          </ul>
        </li>
      </ol>
    </section>
  );
}
