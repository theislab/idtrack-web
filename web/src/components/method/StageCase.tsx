// A stage of the method seen on a real answer of this server: the stage's case (lib/method/cases.ts) is converted when
// the panel comes into view (with the path, as the Convert page asks it), and drawn by the figure the stage gives; the
// header names the query and its answer and opens it on the Convert page; the figure's endpoint is named under it. A
// server that does not hold the graph the case was checked on shows no case rather than a claim nobody checked.
import { useId, type ReactNode } from "react";
import { api } from "../../api/client";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { apiAddress, apiQuery, caseHref } from "../../lib/home/links";
import { holdsStage, stageCase, type Stage } from "../../lib/method/cases";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useInView } from "../../lib/useInView";
import { useRequest } from "../../lib/useRequest";
import { Button, Link, Mono } from "../ui";

export interface StageFigureProps {
  result: ConversionResult;
  graph: GraphDescription;
}

export function StageCase({
  stage,
  title,
  reserve,
  caption,
  children,
}: {
  stage: Stage;
  /** What the case shows, in a few words. */
  title: string;
  /** The height held for the figure while the answer comes. */
  reserve: number;
  /** What the figure draws and how to read it, a journal's caption. */
  caption: ReactNode;
  children: (props: StageFigureProps) => ReactNode;
}) {
  const { organisms } = useOrganisms();
  const digests = new Map(organisms.map((o) => [o.organism, o.content_digest]));
  const chosen = stageCase(stage, digests);
  const graph = organisms.find((o) => o.organism === chosen?.query.organism) ?? null;
  const { ref, seen } = useInView();
  const headId = useId();
  const key = chosen && seen ? `method|${JSON.stringify(chosen.query)}` : null;
  const answer = useRequest(key, (signal, fresh) => {
    // The key is null, and nothing is asked, without a case.
    if (!chosen) throw new Error("No case of this stage on this server.");
    return api.convert(chosen.query.organism, apiQuery(chosen.query), { signal, fresh });
  });
  if (!chosen || !graph) return null;
  const result = answer.state === "done" ? answer.answer.data : null;
  // An answer that no longer shows what the stage is drawn for (another graph under the same digest cannot be; a
  // changed engine can) is not drawn as if it did.
  const holds = result ? holdsStage(stage, result) : null;
  const best = result?.candidates.find((c) => c.best) ?? null;
  const q = chosen.query;
  return (
    <figure className="stage-case" ref={ref} aria-labelledby={headId}>
      <div className="stage-case__head">
        <p className="stage-case__eyebrow eyebrow" id={headId}>
          Seen on this server: {title}
        </p>
        <p className="stage-case__query">
          <Mono strong>{q.identifier}</Mono>
          <span className="stage-case__at">
            {" "}
            · <em>{organismName(q.organism)}</em>
            {commonName(q.organism) ? ` (${commonName(q.organism) ?? ""})` : ""}
            {result ? (
              <>
                {" "}
                · read at release <Mono>{result.from_release ?? "—"}</Mono>
              </>
            ) : null}
          </span>
          {result && best ? (
            <>
              <span className="stage-case__arrow" aria-hidden="true">
                {" "}
                →{" "}
              </span>
              <span className="visually-hidden"> converted to </span>
              <Mono strong>{best.target}</Mono>
              <span className="stage-case__at">
                {" "}
                at release <Mono>{result.to_release}</Mono>
                {result.final_database !== "ensembl_gene" ? <> in {result.final_database}</> : null}
              </span>
            </>
          ) : null}
        </p>
        <Link to={caseHref(q)} className="stage-case__open">
          Open this answer
        </Link>
      </div>
      <div className="stage-case__body" style={result && holds ? undefined : { minHeight: reserve }}>
        {answer.state === "failed" ? (
          <p className="stage-case__failed">
            The server did not answer this case: {answer.error.message}{" "}
            <Button variant="quiet" onClick={answer.retry}>
              Try again
            </Button>
          </p>
        ) : result && holds === false ? (
          <p className="stage-case__failed">
            This server&apos;s answer no longer shows what this stage is drawn for; it is not drawn here.
          </p>
        ) : result ? (
          children({ result, graph })
        ) : (
          <p className="stage-case__loading" aria-hidden="true">
            Asking the server…
          </p>
        )}
      </div>
      <figcaption className="stage-case__caption fig-caption">
        {caption} The answer this server gave when the panel came into view. Source:{" "}
        <span className="mono stage-case__source">GET {apiAddress(q)}</span>
      </figcaption>
    </figure>
  );
}
