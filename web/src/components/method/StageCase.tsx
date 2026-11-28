// A stage of the method seen on a real answer of this server. The walk's case is the showcase's answer of the graph in
// view chosen by a stated measure (lib/method/cases.ts, `walkCase`: the showcase is asked when the panel comes into
// view); every other stage's case is converted when the panel comes into view (with the path, as the Convert page asks
// it). The head names the query and opens it on the Convert page; the answer, its line and the figure the stage gives
// stand in the body, whose height is held while the answer comes (styles/method.css, by stage), so nothing above or
// beside it moves; the caption says
// its claim and the rest on a press, with the endpoint. A server that does not hold the graph a case was checked on
// shows no case rather than a claim nobody checked.
import { useId, type ReactNode } from "react";
import { api } from "../../api/client";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { apiAddress, apiQuery, caseHref, caseQueryOf } from "../../lib/home/links";
import type { CaseQuery } from "../../lib/home/cases";
import { holdsStage, stageCase, walkCase, type Stage } from "../../lib/method/cases";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useShowcase } from "../../lib/showcase";
import { useInView } from "../../lib/useInView";
import { useRequest } from "../../lib/useRequest";
import { databaseLabel } from "../../lib/databases";
import { Button, Link, Mono } from "../ui";
import { CaptionMore } from "../v2/CaptionMore";

export interface StageFigureProps {
  result: ConversionResult;
  graph: GraphDescription;
}

/** The answer a stage draws: its query, the graph, and the state of its answer. */
interface Asked {
  query: CaseQuery | null;
  result: ConversionResult | null;
  failed: { message: string; retry: () => void } | null;
  /** The showcase was read and holds no answer of what the stage draws. */
  none?: boolean;
}

/** The walk's case, from the showcase of the graph in view (asked once the panel is in view). */
function useWalk(organism: string | null, seen: boolean): Asked {
  const showcase = useShowcase(seen ? organism : null);
  if (!organism) return { query: null, result: null, failed: null };
  if (showcase.state === "failed")
    return { query: null, result: null, failed: { message: showcase.error.message, retry: showcase.retry } };
  if (showcase.state !== "done") return { query: null, result: null, failed: null };
  const found = walkCase(showcase.answer.data);
  return found
    ? { query: caseQueryOf(organism, found.query), result: found.result, failed: null }
    : { query: null, result: null, failed: null, none: true };
}

/** Another stage's case, converted once the panel is in view. */
function useConverted(stage: Stage, digests: ReadonlyMap<string, string | null>, seen: boolean): Asked {
  const chosen = stage === "walk" ? null : stageCase(stage, digests);
  const key = chosen && seen ? `method|${JSON.stringify(chosen.query)}` : null;
  const answer = useRequest(key, (signal, fresh) => {
    // The key is null, and nothing is asked, without a case.
    if (!chosen) throw new Error("No case of this stage on this server.");
    return api.convert(chosen.query.organism, apiQuery(chosen.query), { signal, fresh });
  });
  if (!chosen) return { query: null, result: null, failed: null };
  if (answer.state === "failed")
    return { query: chosen.query, result: null, failed: { message: answer.error.message, retry: answer.retry } };
  return { query: chosen.query, result: answer.state === "done" ? answer.answer.data : null, failed: null };
}

/** The answer's line: what the query is answered by, at which release (a tie said as one). */
function AnswerLine({ result, readAt }: { result: ConversionResult; readAt: boolean }) {
  const best = result.candidates.find((c) => c.best) ?? null;
  const targets = [...new Set(result.candidates.filter((c) => c.best).map((c) => c.target))];
  const genes = [...new Set(result.candidates.filter((c) => c.best).map((c) => c.gene))];
  if (!best) return null;
  return (
    <p className="stage-case__answer">
      {readAt ? (
        <span className="stage-case__at">
          read at release <Mono>{result.from_release ?? "—"}</Mono>{" "}
        </span>
      ) : null}
      <span className="stage-case__arrow" aria-hidden="true">
        →{" "}
      </span>
      {targets.length > 1 ? (
        // A tie is never said as one answer: the count of equal best ids, and of whose gene they are.
        <>
          <span className="visually-hidden"> answered by </span>
          {targets.length} {genes.length === 1 ? "ids of " : `ids of ${genes.length} genes, equal best`}
          {genes.length === 1 ? <Mono strong>{genes[0]}</Mono> : null}
        </>
      ) : (
        <>
          <span className="visually-hidden"> converted to </span>
          <Mono strong>{best.target}</Mono>
        </>
      )}
      <span className="stage-case__at">
        {" "}
        at release <Mono>{result.to_release}</Mono>
        {result.final_database !== null && result.final_database !== "ensembl_gene" ? (
          <> in {databaseLabel(result.final_database)}</>
        ) : null}
        {targets.length > 1 ? " (a tie)" : null}
      </span>
    </p>
  );
}

export function StageCase({
  stage,
  claim,
  caption,
  children,
}: {
  stage: Stage;
  /** The caption's claim: what the figure draws, in one sentence (always shown). */
  claim: string;
  /** How to read the figure: the rest of its caption, one press away. */
  caption: ReactNode;
  children: (props: StageFigureProps) => ReactNode;
}) {
  const { organisms, current } = useOrganisms();
  const digests = new Map(organisms.map((o) => [o.organism, o.content_digest]));
  const { ref, seen } = useInView();
  const headId = useId();
  const walk = useWalk(stage === "walk" ? (current?.organism ?? null) : null, seen);
  const converted = useConverted(stage, digests, seen);
  const asked = stage === "walk" ? walk : converted;
  // The walk's query is known once the showcase is read; the head holds the graph's name until then.
  const organism = stage === "walk" ? (current?.organism ?? null) : asked.query?.organism;
  const graph = organisms.find((o) => o.organism === organism) ?? null;
  // Before the server's graphs are known (the page's frame, drawn before its code runs), the figure's place is held as
  // tall as it will be while its answer comes, so the page does not move when it arrives.
  if (!organisms.length)
    return (
      <figure className={`stage-case stage-case--${stage}`} aria-hidden="true">
        <div className="stage-case__head">
          <p className="stage-case__query">
            <span className="stage-case__pending">A real answer</span>
          </p>
        </div>
        <div className="stage-case__body stage-case__body--waiting" />
      </figure>
    );
  if (!graph || (stage !== "walk" && !asked.query)) return null;
  const result = asked.result;
  // An answer that no longer shows what the stage is drawn for (another graph under the same digest cannot be; a
  // changed engine can) is not drawn as if it did.
  const holds = result ? holdsStage(stage, result) : null;
  const q = asked.query;
  return (
    <figure className={`stage-case stage-case--${stage}`} ref={ref} aria-labelledby={headId}>
      <div className="stage-case__head">
        <p className="stage-case__query" id={headId}>
          {q ? <Mono strong>{q.identifier}</Mono> : <span className="stage-case__pending">A real answer</span>}
          <span className="stage-case__at">
            {" "}
            · <em>{organismName(graph.organism)}</em>
            {commonName(graph.organism) ? ` (${commonName(graph.organism) ?? ""})` : ""}
          </span>
        </p>
        {q ? (
          <Link to={caseHref(q)} className="stage-case__open">
            Open this answer
          </Link>
        ) : null}
      </div>
      <div className={`stage-case__body${result && holds ? "" : " stage-case__body--waiting"}`}>
        {asked.failed ? (
          <p className="stage-case__failed">
            The server did not answer this case: {asked.failed.message}{" "}
            <Button variant="quiet" onClick={asked.failed.retry}>
              Try again
            </Button>
          </p>
        ) : asked.none ? (
          <p className="stage-case__failed">
            The showcase of this graph holds no answer whose best path walks through a split without a bridge.
          </p>
        ) : result && holds === false ? (
          <p className="stage-case__failed">
            This server&apos;s answer no longer shows what this stage is drawn for; it is not drawn here.
          </p>
        ) : result ? (
          <>
            {/* The reading stage draws the release read itself. */}
            <AnswerLine result={result} readAt={stage !== "read"} />
            {children({ result, graph })}
          </>
        ) : (
          <p className="stage-case__loading" aria-hidden="true">
            Asking the server…
          </p>
        )}
      </div>
      <figcaption className="stage-case__caption fig-caption">
        <CaptionMore lead={claim}>
          {caption} The answer this server gave when the panel came into view. Source:{" "}
          <span className="mono stage-case__source">
            GET {stage === "walk" ? `/api/v1/organisms/${graph.organism}/showcase` : q ? apiAddress(q) : ""}
          </span>
        </CaptionMore>
      </figcaption>
    </figure>
  );
}
