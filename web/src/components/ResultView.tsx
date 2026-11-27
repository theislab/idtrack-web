// One conversion's answer, as a figure of lettered panels: (a) the answer and its anatomy, (b) the path through the
// releases, (c) the path in words, (d) the decision and every candidate, (e) how the identifier was read; then the
// api's answer as sent. Panels without content for this answer are left out and the letters run on.
import { memo, startTransition, useEffect, useId, useMemo, useState, useTransition } from "react";
import type { ConversionResult, GraphDescription } from "../api/types";
import { anatomyOf, type Anatomy } from "../lib/anatomy";
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
import { AnswerPanel } from "./ResultAnswer";
import { DecisionPanelBody } from "./ResultDecision";
import { FigurePanel } from "./ResultParts";
import { Details, GenePlaces, OtherReadings, ReadingPanel } from "./ResultReading";
import type { IdContext } from "./IdMenu";
import { Button, CopyButton, Disclosure } from "./ui";
import "../styles/result.css";

export { DecisionText } from "./ResultDecision";
export { ResultSkeleton } from "./ResultSkeleton";

/** The caption of the drawing: what is drawn and how to read it, with this path's own releases and assemblies. */
function PathCaption({
  model,
  description,
  letter,
}: {
  model: PathModel;
  description: GraphDescription;
  letter: string;
}) {
  const r = model.result;
  const span = model.span;
  const bands = assemblyBands(description).filter((b) => !span || (b.last >= span[0] && b.first <= span[1]));
  const others = model.candidates.length - model.candidates.filter((c) => c.best).length;
  return (
    <FigureCaption letter={letter} wide>
      <strong className="fig-caption__lead">
        The path of <span className="mono">{r.query_id}</span> from release{" "}
        <span className="mono">{r.from_release ?? "—"}</span> to <span className="mono">{r.to_release}</span>.
      </strong>{" "}
      Time runs along Ensembl&apos;s releases (down the page on a narrow screen), over the assemblies that serve them
      {bands.length ? ` (${bands.map((b) => `${b.name} ${b.first}–${b.last}`).join("; ")})` : ""}. Each bar is an
      Ensembl gene over the releases the path holds it; each step is the mark of its kind (key above). The chosen path
      is strong
      {others
        ? `, the ${others} other candidate${others === 1 ? "" : "s"} light${others > LIMIT_WIDE ? " (the next in rank drawn, the rest on request)" : ""}`
        : ""}
      ; under the lanes, Ensembl&apos;s score of each of its steps, a stem down from 1.0.
      <span className="fig-caption__how">
        Every element holds its exact values: tab to the drawing, then the arrow keys, or point at it. The next panel
        says every step in words.
      </span>
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

/** The panels of a large answer are drawn in stages, one task each, the answer and its path first: an answer of
 *  hundreds of candidates never holds the page in one long task, and what is read first is drawn first. An answer of
 *  less than `STAGED_FROM` characters of text is drawn at once. */
const STAGES = 4;
export const STAGED_FROM = 150_000;

function useStages(key: unknown, staged: boolean): number {
  const [stage, setStage] = useState({ key, n: staged ? 1 : STAGES });
  const n = stage.key === key ? stage.n : staged ? 1 : STAGES;
  if (stage.key !== key) setStage({ key, n });
  useEffect(() => {
    if (n >= STAGES) return;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setStage((s) => (s.key === key ? { key, n: s.n + 1 } : s));
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, n]);
  return n;
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
  const stage = useStages(result, raw.length >= STAGED_FROM);
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

  // The panels this answer has, lettered in order.
  const order: string[] = ["answer"];
  if (hasPath) order.push("path", "words");
  if (hasCandidates) order.push("decision");
  order.push("read");
  const letter = (panel: string) => String.fromCharCode(97 + order.indexOf(panel));
  const id = (panel: string) => `${base}-${panel}`;
  const readingId = id("words");
  const links: Record<keyof Anatomy, string | null> = {
    read: id("read"),
    walked: hasPath ? id("path") : null,
    ranked: hasCandidates ? id("decision") : null,
    answered: hasCandidates ? `${id("decision")}-list` : null,
  };

  return (
    <article className="result" aria-label={`The conversion of ${result.query_id}`}>
      <AnswerPanel
        result={result}
        model={model}
        description={description}
        requestedDatabase={requestedDatabase}
        anatomy={anatomy}
        names={names}
        links={links}
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
      {hasPath ? (
        <FigurePanel
          letter={letter("path")}
          title={oneRelease !== null ? `The reading at release ${oneRelease}` : "The path through the releases"}
          id={id("path")}
          className="result__path"
          aside={
            <span className="muted">
              {model.candidates.length > 1
                ? `all ${groupedInteger(model.candidates.length)} candidates: ${groupedInteger(model.steps.length)} steps, ${groupedInteger(model.nodes.length)} identifiers`
                : `${model.steps.length} step${model.steps.length === 1 ? "" : "s"}, ${model.nodes.length} identifiers`}
            </span>
          }
        >
          {oneRelease !== null ? (
            <figure className="pv-figure">
              <CrossingView model={model} release={oneRelease} readingId={readingId} context={context} />
              <FigureCaption letter={letter("path")} wide>
                <strong className="fig-caption__lead">
                  The reading of <span className="mono">{result.query_id}</span> at release{" "}
                  <span className="mono">{oneRelease}</span>.
                </strong>{" "}
                No step of Ensembl&apos;s history: every step holds at this release, so the drawing shows the databases
                crossed, not a time axis: the identifier, each database or form it is read through (an open square, an
                open circle), the gene it is read as (a bar) and the answer&apos;s id in the database asked (a filled
                square).
                <span className="fig-caption__how">
                  Every id opens a menu of where to go from it; the next panel says every step in words.
                </span>
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
              <PathCaption model={model} description={description} letter={letter("path")} />
            </figure>
          )}
        </FigurePanel>
      ) : hasCandidates ? (
        <p className="result__no-path muted">
          The path was not asked for (Show the path is off): panels of the path and its words are left out.
        </p>
      ) : null}
      {hasPath && stage >= 2 ? (
        <ReadingPanel
          model={model}
          names={names}
          id={readingId}
          letter={letter("words")}
          highlight={highlight}
          context={context}
        />
      ) : null}
      {hasCandidates && stage >= 3 ? (
        <FigurePanel
          letter={letter("decision")}
          title="The decision"
          id={id("decision")}
          className="result__candidates"
          aside={
            <span className="muted">
              {result.candidates.length} candidate{result.candidates.length === 1 ? "" : "s"}, ranked
            </span>
          }
        >
          <DecisionPanelBody
            result={result}
            decision={model.decision}
            highlight={highlight}
            requestedDatabase={requestedDatabase}
            listId={`${id("decision")}-list`}
            context={context}
          />
        </FigurePanel>
      ) : null}
      {stage >= 4 ? (
        <>
          <FigurePanel
            letter={letter("read")}
            title="How the identifier was read"
            id={id("read")}
            className="result__details"
          >
            <Details result={result} />
            <OtherReadings result={result} context={context} />
            {hasPath ? <GenePlaces model={model} names={names} /> : null}
            {result.path ? <BridgesConsidered path={result.path} model={model} id={base} /> : null}
            {result.path ? <RefusedSteps path={result.path} model={model} names={names} id={base} /> : null}
          </FigurePanel>
          <Disclosure summary="The api's answer, as sent">
            <RawAnswer raw={raw} apiUrl={apiUrl} />
          </Disclosure>
        </>
      ) : null}
    </article>
  );
});
