// One conversion's answer (DIRECTION.md, "The answer"): the verdict first (the query, the answer, its status, the
// cautions, and the actions), then the rest behind tabs kept in the address (`?tab=`): the path (drawn, or in words),
// the decision and every candidate, how the identifier was read, the evidence to weigh, and the record (the facts, how
// the answer was reached, the api's answer as sent). Only the tab shown is drawn, so that the largest answer opens
// with its verdict and its path alone.
import { memo, useEffect, useId, useMemo, useState, useTransition } from "react";
import type { ConversionResult, GraphDescription } from "../api/types";
import { anatomyOf } from "../lib/anatomy";
import { assemblyBands } from "./figure/releases";
import { evidenceOf } from "../lib/evidence";
import { createHighlight } from "../lib/highlight";
import { indentJson } from "../lib/jsonView";
import { groupedInteger } from "../lib/numbers";
import { atOneRelease, buildModel, type PathModel } from "../lib/pathModel";
import { CrossingView } from "./CrossingView";
import { useSymbols } from "../lib/symbols";
import { assemblyNames } from "../lib/pathReading";
import { useVocabulary } from "../lib/vocabularyContext";
import { BridgesConsidered, RefusedSteps } from "./PathChecks";
import { FigureCaption } from "./figure/Legend";
import { LIMIT_WIDE, PathView } from "./PathView";
import { AnswerPanel, AnswerRecord, DecisionSentence } from "./ResultAnswer";
import { DecisionPanelBody } from "./ResultDecision";
import { FigurePanel } from "./ResultParts";
import { Details, GenePlaces, OtherReadings, ReadingPanel } from "./ResultReading";
import type { IdContext } from "./IdMenu";
import { Button, CopyButton } from "./ui";
import { CaptionMore } from "./home/CaptionMore";
import { Evidence } from "./Evidence";
import { Expandable } from "./v2/Expandable";
import { Segmented } from "./v2/Segmented";
import { Tabs, type TabItem } from "./v2/Tabs";
import { convertHref, plainConversion } from "../lib/convertParameters";
import "../styles/result.css";
import "../styles/answer.css";

export { DecisionText } from "./ResultDecision";
export { ResultSkeleton } from "./ResultSkeleton";

/** The caption of the drawing: what is drawn and how to read it, with this path's own releases and assemblies. */
function PathCaption({ model, description }: { model: PathModel; description: GraphDescription }) {
  const r = model.result;
  const span = model.span;
  const bands = assemblyBands(description).filter((b) => !span || (b.last >= span[0] && b.first <= span[1]));
  const others = model.candidates.length - model.candidates.filter((c) => c.best).length;
  return (
    <FigureCaption wide>
      <CaptionMore
        lead={
          <strong className="fig-caption__lead">
            The path of <span className="mono">{r.query_id}</span> from release{" "}
            <span className="mono">{r.from_release ?? "—"}</span> to <span className="mono">{r.to_release}</span>.
          </strong>
        }
      >
        Time runs along Ensembl&apos;s releases (down the page on a narrow screen), over the assemblies that serve them
        {bands.length ? ` (${bands.map((b) => `${b.name} ${b.first}–${b.last}`).join("; ")})` : ""}. Each bar is an
        Ensembl gene over the releases the path holds it; each step is the mark of its kind (key above). The chosen path
        is strong
        {others
          ? `, the ${others} other candidate${others === 1 ? "" : "s"} light${others > LIMIT_WIDE ? " (the next in rank drawn, the rest on request)" : ""}`
          : ""}
        ; under the lanes, Ensembl&apos;s score of each of its steps, a stem down from 1.0.
        <span className="fig-caption__how">
          Every element holds its exact values: tab to the drawing, then the arrow keys, or point at it. “In words” says
          every step.
        </span>
      </CaptionMore>
    </FigureCaption>
  );
}

/** The text of the api's answer shown at first; a longer answer is shown whole on a press (it is copied and saved
 *  whole), so that opening it never lays out hundreds of kilobytes in one task. */
export const RAW_SHOWN = 40_000;

/** The api's answer as sent, or indented for reading with every value's text kept (lib/jsonView.ts). */
function RawAnswer({ raw, apiUrl }: { raw: string; apiUrl: string | null }) {
  const [indented, setIndented] = useState(false);
  const [whole, setWhole] = useState(false);
  // A long answer is indented or shown whole in a transition: the press is answered at once, the text follows.
  const [pending, startShowing] = useTransition();
  const text = useMemo(() => {
    if (!indented) return raw;
    const tokens = indentJson(raw);
    return tokens ? tokens.map((t) => t.text).join("") : raw;
  }, [indented, raw]);
  // Cut at a line's end (indented) or a value's end (as sent), never inside a value.
  const cut =
    whole || text.length <= RAW_SHOWN ? text.length : Math.max(text.lastIndexOf(indented ? "\n" : ",", RAW_SHOWN), 1);
  return (
    <>
      <div className="raw__head">
        {apiUrl ? (
          <a className="raw__link mono" href={apiUrl} target="_blank" rel="noreferrer">
            GET {apiUrl}
          </a>
        ) : null}
        <Button
          variant="quiet"
          aria-pressed={indented}
          onClick={() => {
            startShowing(() => {
              setIndented((v) => !v);
            });
          }}
        >
          {indented ? "As sent" : "Indented"}
        </Button>
        <CopyButton text={raw} what="the api's answer" />
      </div>
      <pre className="raw" role="region" aria-label="The api's answer" tabIndex={0}>
        {cut < text.length ? `${text.slice(0, cut + 1)} …` : text}
      </pre>
      {cut < text.length ? (
        <p className="raw__more">
          <span className="muted">
            The first {groupedInteger(cut + 1)} of {groupedInteger(text.length)} characters.{" "}
          </span>
          <Button
            variant="quiet"
            onClick={() => {
              startShowing(() => {
                setWhole(true);
              });
            }}
          >
            {pending ? "Showing…" : "Show the whole answer"}
          </Button>
        </p>
      ) : null}
    </>
  );
}

export const ResultView = memo(function ResultView({
  result,
  raw,
  description,
  requestedDatabase,
  apiUrl = null,
  serverTiming = null,
  requestId = null,
}: {
  result: ConversionResult;
  raw: string;
  description: GraphDescription;
  /** The database the conversion asked for (`null`: Ensembl genes), named when the best answer has no id in it. */
  requestedDatabase: string | null;
  /** The api's address of this conversion, for the link to its answer as sent. */
  apiUrl?: string | null;
  /** The answer's `Server-Timing` header as sent (the server's own time on it). */
  serverTiming?: string | null;
  /** The answer's request id (`X-Request-ID`), for its provenance. */
  requestId?: string | null;
}) {
  // When the page received this answer, for its provenance.
  const [received, setReceived] = useState(() => ({ result, at: new Date().toISOString() }));
  if (received.result !== result) setReceived({ result, at: new Date().toISOString() });
  const receivedAt = received.at;
  const vocabulary = useVocabulary();
  const model = useMemo(() => buildModel(result), [result]);
  const names = useMemo(() => assemblyNames(description.assemblies), [description]);
  const anatomy = useMemo(
    () =>
      anatomyOf(
        result,
        model,
        vocabulary.criteria.map((c) => c.code),
      ),
    [result, model, vocabulary],
  );
  // What the reader points at (a candidate, a step), shared by the views without re-rendering the others.
  const [highlight] = useState(createHighlight);
  useEffect(() => {
    // A new answer: nothing of it is pointed at yet.
    highlight.setCandidate(null);
    highlight.setStep(null);
  }, [result, highlight]);
  // The symbol of each gene the answer names, at its target release: one batch request (lib/symbols.ts); none where
  // the targets are a name authority's symbols already (they are the symbols).
  const genes = useMemo(
    () => [
      ...new Set([
        ...result.candidates.map((c) => c.gene),
        ...result.other_readings.flatMap((r) => r.genes),
        ...result.no_target_genes,
      ]),
    ],
    [result],
  );
  const fetched = useSymbols(description.organism, result.to_release, genes, requestedDatabase ?? null);
  const symbols = useMemo(() => {
    if (!fetched?.fromTargets || !requestedDatabase) return fetched;
    // The targets are the authority's symbols at the target release: each gene's are its targets (a gene without one is
    // its own target, `no_target`: it has no symbol, and none is shown).
    const of = new Map<string, string[]>();
    for (const c of result.candidates)
      of.set(c.gene, [...new Set([...(of.get(c.gene) ?? []), ...(c.target === c.gene ? [] : [c.target])])]);
    return { database: requestedDatabase, release: result.to_release, of };
  }, [fetched, requestedDatabase, result]);
  // The evidence to weigh, as the api states it on the result (`cautions`).
  const marks = useMemo(() => evidenceOf(result, vocabulary), [result, vocabulary]);
  const context: IdContext = useMemo(
    () => ({
      organism: description.organism,
      toRelease: result.to_release,
      finalDatabase: requestedDatabase,
      symbols,
    }),
    [description.organism, result.to_release, requestedDatabase, symbols],
  );
  const base = useId().replace(/:/g, "");
  const hasPath = model.steps.length > 0;
  const oneRelease = atOneRelease(model);
  const hasCandidates = result.candidates.length > 0;
  const [view, setView] = useState<"drawing" | "words">("drawing");
  const id = (panel: string) => `${base}-${panel}`;
  const readingId = id("words");
  const steps = model.steps.length;
  const readAtHref = (release: number) =>
    convertHref(description.organism, {
      ...plainConversion(result.query_id),
      fromRelease: release,
      toRelease: result.to_release,
      finalDatabase: requestedDatabase,
    });

  const items: TabItem[] = [];
  if (hasPath)
    items.push({
      id: "path",
      label: "Path",
      count: `${groupedInteger(steps)} step${steps === 1 ? "" : "s"}`,
      panel: () => (
        <FigurePanel
          title={oneRelease !== null ? `The reading at release ${oneRelease}` : "The path through the releases"}
          id={id("path")}
          className="result__path"
          aside={
            <Segmented
              label="The path"
              value={view}
              onChange={setView}
              options={[
                { value: "drawing", label: "Drawing" },
                { value: "words", label: "In words" },
              ]}
            />
          }
        >
          {view === "words" ? (
            <ReadingPanel model={model} names={names} id={readingId} highlight={highlight} context={context} />
          ) : oneRelease !== null ? (
            <figure className="pv-figure">
              <CrossingView model={model} release={oneRelease} readingId={readingId} context={context} />
              <FigureCaption wide>
                <CaptionMore
                  lead={
                    <strong className="fig-caption__lead">
                      The reading of <span className="mono">{result.query_id}</span> at release{" "}
                      <span className="mono">{oneRelease}</span>.
                    </strong>
                  }
                >
                  No step of Ensembl&apos;s history: every step holds at this release, so the drawing shows the
                  databases crossed, not a time axis: the identifier, each database or form it is read through (an open
                  square, an open circle), the gene it is read as (a bar) and the answer&apos;s id in the database asked
                  (a filled square).
                  <span className="fig-caption__how">
                    Every id opens a menu of where to go from it; “In words” says every step.
                  </span>
                </CaptionMore>
              </FigureCaption>
            </figure>
          ) : (
            <figure className="pv-figure">
              <PathView
                model={model}
                description={description}
                names={names}
                highlight={highlight}
                readingId={readingId}
                requestedDatabase={requestedDatabase}
                symbols={symbols}
              />
              <PathCaption model={model} description={description} />
            </figure>
          )}
        </FigurePanel>
      ),
    });
  if (hasCandidates)
    items.push({
      id: "decision",
      label: "Decision",
      count: `${groupedInteger(result.candidates.length)} candidate${result.candidates.length === 1 ? "" : "s"}`,
      panel: () => (
        <FigurePanel title="The decision" id={id("decision")} className="result__candidates">
          <DecisionSentence model={model} context={context} />
          <DecisionPanelBody
            result={result}
            decision={model.decision}
            highlight={highlight}
            requestedDatabase={requestedDatabase}
            listId={`${id("decision")}-list`}
            context={context}
          />
        </FigurePanel>
      ),
    });
  items.push({
    id: "reading",
    label: "Reading",
    panel: () => (
      <FigurePanel title="How the identifier was read" id={id("read")} className="result__details">
        <Details result={result} />
        <OtherReadings result={result} context={context} />
        {hasPath ? (
          <Expandable summary="Where the genes lie" meta="places on their assemblies">
            <GenePlaces model={model} names={names} />
          </Expandable>
        ) : null}
        {result.path ? (
          <Expandable summary="The bridges the search considered" meta={`${result.path.bridges.length}`}>
            <BridgesConsidered path={result.path} model={model} id={base} />
          </Expandable>
        ) : null}
        {result.path?.refused.length ? (
          <Expandable summary="Steps not followed" meta={`${result.path.refused.length}`}>
            <RefusedSteps path={result.path} model={model} names={names} id={base} />
          </Expandable>
        ) : null}
      </FigurePanel>
    ),
  });
  if (marks.length)
    items.push({
      id: "evidence",
      label: "Evidence",
      count: groupedInteger(marks.length),
      panel: () => (
        <FigurePanel title="The evidence to weigh" id={id("evidence")} className="result__evidence">
          <Evidence result={result} marks={marks} readAtHref={readAtHref} label="Evidence to weigh" />
        </FigurePanel>
      ),
    });
  items.push({
    id: "record",
    label: "Record",
    panel: () => (
      <FigurePanel title="The record of this answer" id={id("record")} className="result__record">
        <AnswerRecord
          result={result}
          description={description}
          requestedDatabase={requestedDatabase}
          serverTiming={serverTiming}
          context={context}
          anatomy={anatomy}
          names={names}
        />
        <Expandable summary="The api's answer, as sent" meta={`${groupedInteger(raw.length)} characters`}>
          <RawAnswer raw={raw} apiUrl={apiUrl} />
        </Expandable>
      </FigurePanel>
    ),
  });

  return (
    <article className="result result--v2" aria-label={`The conversion of ${result.query_id}`}>
      <AnswerPanel
        result={result}
        model={model}
        description={description}
        requestedDatabase={requestedDatabase}
        apiUrl={apiUrl}
        serverTiming={serverTiming}
        raw={raw}
        marks={marks}
        context={context}
        id={id("answer")}
        requestId={requestId}
        receivedAt={receivedAt}
      />
      {model.problems.length ? (
        <div className="notice notice--danger" role="alert">
          <p className="notice__title">The path the api sent is not consistent</p>
          <ul>
            {model.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasCandidates && !hasPath ? (
        <p className="result__no-path muted">The path was not asked for (Show the path is off): no path is drawn.</p>
      ) : null}
      <Tabs items={items} label="The answer in detail" param="tab" className="result__tabs" />
    </article>
  );
});
