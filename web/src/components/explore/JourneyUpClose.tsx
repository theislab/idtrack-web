// One journey up close: the showcase's case of kind `lineage` (a path over every assembly of the graph), drawn as its
// gene versions over the releases with Ensembl's scores under them, with a replay that walks the path step by step.
// The answer's cautions stand under the title, as on the answer's verdict (they never fold); a step that is not
// Ensembl's history (a reading through another id, a bridge: IDTrack's inference) is named in the key. Every value is
// the case's answer, as the server's showcase gives it.
import { Suspense, useId, useMemo } from "react";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { figureHeight, figureModel, reasonCounts } from "../../lib/explore/figureModel";
import { apiAddress, caseHref } from "../../lib/home/links";
import type { CaseQuery } from "../../lib/home/cases";
import { lazyPart } from "../../lib/lazyPart";
import { allStepsText, journeyStepsText } from "../../lib/path/steps";
import { pythonFloat } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { evidenceOf } from "../../lib/evidence";
import { Evidence } from "../Evidence";
import { FigureLegend, type LegendEntry } from "../figure/Legend";
import { CaptionMore } from "../v2/CaptionMore";
import { FigureReserve } from "./FigureReserve";
import { Link, Mono } from "../ui";

const HistoryFigure = lazyPart(() => import("./HistoryFigure").then((m) => ({ default: m.HistoryFigure })));

export function JourneyUpClose({
  query,
  result: answer,
  graph,
  letter = "b",
  level = 2,
  longest = null,
}: {
  query: CaseQuery;
  result: ConversionResult;
  graph: GraphDescription;
  /** The panel's letter in the page it stands on (none: no letter). */
  letter?: string | null;
  level?: 2 | 3;
  /** The most steps of Ensembl's history any answer of the graph's showcase takes (said where it is one). */
  longest?: number | null;
}) {
  const H = level === 2 ? "h2" : "h3";
  const vocabulary = useVocabulary();
  const captionId = useId();
  const model = useMemo(() => figureModel(answer), [answer]);
  // A figure that cannot be drawn (the answer has no path) is left out, not shown broken.
  if (!model) return null;
  const result = model.result;
  const order = [...vocabulary.stepReasons.keys()];
  const history = model.steps.filter((st) => st.family !== "cross");
  const reading = model.steps.filter((st) => st.family === "cross");
  const bridged = reading.some((st) => st.step.kind === "bridge_near" || st.step.kind === "bridge_far");
  const readThrough = reading.some((st) => st.step.kind !== "bridge_near" && st.step.kind !== "bridge_far");
  const cautions = evidenceOf(result, vocabulary).filter((m) => m.tone === "caution");
  const counts = reasonCounts(history, order);
  const readingCounts = reasonCounts(reading, order);
  const handoffs = model.steps.filter((s) => s.handoff).length;
  const scoreMeaning = vocabulary.candidateFields.get("score") ?? null;
  const assemblies = [...new Set(model.genes.flatMap((g) => g.node.assemblies))]
    .map((a) => graph.assemblies.find((x) => x.assembly === a)?.name ?? String(a))
    .join(", ");
  return (
    <figure className="panel hero-figure" aria-describedby={captionId}>
      <div className={`hero-figure__head${letter ? "" : " hero-figure__head--plain"}`}>
        {letter ? (
          <span className="panel-letter" aria-hidden="true">
            {letter}
          </span>
        ) : null}
        <div className="hero-figure__title">
          <H>One journey up close, with Ensembl&apos;s scores</H>
          <p className="hero-figure__query" aria-live="polite">
            <Mono strong>{result.query_id}</Mono>
            <span className="hero-figure__at"> at release {result.from_release}</span>
            <span className="hero-figure__arrow" aria-hidden="true">
              {" "}
              →{" "}
            </span>
            <span className="visually-hidden"> converted to </span>
            <Mono strong>{model.answer.target}</Mono>
            <span className="hero-figure__at"> at release {result.to_release}</span>
          </p>
        </div>
        <Link to={caseHref(query)} className="hero-figure__open">
          Open this answer
        </Link>
      </div>
      {cautions.length ? (
        <div className="hero-figure__cautions">
          <Evidence
            result={result}
            marks={cautions}
            compact
            max={cautions.length}
            label={`Cautions of ${result.query_id}'s answer`}
          />
        </div>
      ) : null}
      <Suspense fallback={<FigureReserve height={() => figureHeight(model.lanes, history.length > 0)} />}>
        <HistoryFigure model={model} description={graph} />
      </Suspense>
      <FigureLegend
        entries={[
          { key: "gene", glyph: "gene", text: "A gene version, over the releases the path holds it" },
          { key: "version", glyph: "version", text: "A new version or a replacement" },
          { key: "event", glyph: "event", text: "A split or a merge" },
          { key: "loop", glyph: "loop", text: "A re-mapping of a gene to itself" },
          { key: "handoff", glyph: "handoff", text: "A step across an assembly change" },
          ...(readThrough
            ? [
                {
                  key: "read",
                  glyph: "read",
                  text: "A reading through another id of the gene, not Ensembl's history",
                } as LegendEntry,
              ]
            : []),
          ...(bridged
            ? [
                {
                  key: "bridge",
                  glyph: "bridge",
                  text: "A bridge, IDTrack's inference (no Ensembl score)",
                } as LegendEntry,
              ]
            : []),
          ...(history.length
            ? [
                {
                  key: "product",
                  swatch: (
                    <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
                      <path className="fig-product__line" d="M2,3H10V8H20V13H28" />
                    </svg>
                  ),
                  text: "The product of the scores so far, the candidate's score at the end",
                },
              ]
            : []),
          {
            key: "score",
            swatch: (
              <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
                <line className="fig-score__line" x1={2} x2={28} y1={3} y2={3} />
                <g className="fig-score__stem fig-hue--history">
                  <line x1={10} x2={10} y1={3} y2={12} />
                  <circle cx={10} cy={12} r={2.4} />
                </g>
                <circle className="fig-score__none" cx={21} cy={3} r={2.6} />
              </svg>
            ),
            text: "Ensembl's mapping score of the step (open: no score)",
          },
        ]}
      />
      <figcaption id={captionId} className="fig-caption">
        <CaptionMore
          lead={
            <>
              {letter ? <strong>{letter}</strong> : null} The best answer of this server to{" "}
              <Mono>{result.query_id}</Mono> read at release {result.from_release} of the{" "}
              <em>{organismName(graph.organism)}</em> graph and converted to release {result.to_release}:{" "}
              <Mono>{model.answer.target}</Mono>, each gene version over the releases the path holds it, Ensembl&apos;s
              score of each step under them.
              {longest !== null && longest <= 1 ? (
                <>
                  {" "}
                  No answer of this graph&apos;s showcase takes more than {longest === 1 ? "one step" : "a step"} of
                  Ensembl&apos;s history.
                </>
              ) : null}
            </>
          }
        >
          Answered once when the server started; the answer&apos;s explained path, every candidate&apos;s, holds{" "}
          {allStepsText(result)}, of which the best answer&apos;s path takes {journeyStepsText(result)}. Each bar is a
          gene version over the releases at which the path holds it ({model.genes.length} versions on assemblies{" "}
          {assemblies}); between the versions, {history.length} steps of Ensembl&apos;s id history (
          {counts.map(([reason, n], i) => (
            <span key={reason}>
              {i ? ", " : ""}
              {n} {spaced(reason)}
            </span>
          ))}
          ), {handoffs === 0 ? "none" : handoffs} of them across an assembly change, drawn over the bands of the
          assemblies that serve each release
          {reading.length ? (
            <>
              ; before and after them, {plural(reading.length, "step")} of reading (
              {readingCounts.map(([reason, n], i) => (
                <span key={reason}>
                  {i ? ", " : ""}
                  {n} {spaced(reason)}
                </span>
              ))}
              ), which are not Ensembl&apos;s history
            </>
          ) : null}
          . Below, Ensembl&apos;s mapping score of each step, on an axis from {pythonFloat(1)} down to the value marked;
          under it, the product of the scores so far, stepping down at each scored step to the candidate&apos;s score,{" "}
          <Mono>{pythonFloat(model.answer.score)}</Mono>, which is{" "}
          {scoreMeaning ? lowerFirst(prose(scoreMeaning)) : "its score"}. Replay walks the path step by step and writes
          each step&apos;s score and the product so far (the page&apos;s own product, cut after six decimals: the
          candidate&apos;s score is IDTrack&apos;s; the exact value, one press away). Focus the figure and use the arrow
          keys for each element&apos;s exact values (on a touch screen, tap a mark). Source:{" "}
          <Mono>GET /api/v1/organisms/{graph.organism}/showcase</Mono>, the answer{" "}
          <a href={apiAddress(query)}>
            <Mono>GET {apiAddress(query).replace(/\?.*/, "")}</Mono>
          </a>{" "}
          gives.
        </CaptionMore>
      </figcaption>
    </figure>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, "");
}
