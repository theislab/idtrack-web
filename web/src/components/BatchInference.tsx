// Where a list comes from, by IDTrack's source inference of its distinct identifiers (`POST …/source-inference`, mode
// `release`), read by IDTrack's own rule: the band and the margin decide (lib/batchInference.ts, `verdictOf`). In the
// form, *Infer it from the list* draws a column per release of the graph (as tall as the distinct identifiers found
// there) on the release axis with the assemblies behind, the band in ink, the best named, and fills *From release*
// with the best where the list dates itself. Under the answer of a list converted without a release, one quiet line
// says what the inference gives and, where the list dates itself, reads it at the best release in one press. The
// assemblies' releases are stated beside, from the graph, for a list whose release is known by its genome build.
import { useEffect, useMemo, useRef } from "react";
import { api } from "../api/client";
import type { GraphDescription } from "../api/types";
import { bandWords, readInference, verdictOf, type ReleaseInference } from "../lib/batchInference";
import type { InferredRelease } from "../lib/batchExport";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { useAction, useRequest } from "../lib/useRequest";
import { axisOf, bandsOf } from "./figure/releases";
import { ErrorPanel } from "./ErrorPanel";
import { BandBackdrop, ReleaseScale } from "./ReleaseScale";
import { Button, Mono } from "./ui";

export function BatchInference({
  description,
  identifiers,
  bound,
  current,
  onUse,
}: {
  description: GraphDescription;
  /** The list's identifiers as typed now. */
  identifiers: readonly string[];
  /** The server's bound of identifiers per request (`batch_max`). */
  bound: number;
  /** The release read at in the form now. */
  current: string;
  onUse: (inferred: InferredRelease) => void;
}) {
  const organism = description.organism;
  const asking = useAction((signal, ids: string[]) =>
    api.sourceInference(organism, { identifiers: ids, mode: "release" }, signal),
  );
  const distinct = useMemo(() => [...new Set(identifiers.map((id) => id.trim()).filter(Boolean))], [identifiers]);
  const sent = distinct.slice(0, bound);
  const axis = useMemo(() => axisOf(description.releases), [description]);
  const bands = useMemo(() => bandsOf(axis, description), [axis, description]);
  const answer = asking.state === "done" ? asking.answer : null;
  const inference = answer ? readInference(answer.data) : null;
  const best = inference?.band[0] ?? null;
  const verdict = inference ? verdictOf(inference, description.releases) : null;
  // The list dates itself: its best release fills From release, once per answer (the person may change it after).
  const filled = useRef<unknown>(null);
  const use = useRef(onUse);
  useEffect(() => {
    use.current = onUse;
  });
  useEffect(() => {
    if (!answer || !inference || verdict !== "dated" || best === null || filled.current === answer) return;
    filled.current = answer;
    use.current(inferredOf(inference, answer.requestId));
  }, [answer, inference, verdict, best]);
  const assemblies = description.assemblies
    .filter((a) => a.serves.length)
    .map((a) => `${a.name ?? String(a.assembly)} ${releaseRanges(a.serves)}`);
  return (
    <div className="infer">
      <div className="infer__ask">
        <Button
          onClick={() => {
            void asking.start(sent);
          }}
          disabled={!sent.length || asking.state === "loading"}
        >
          {asking.state === "loading" ? "Reading the list…" : "Infer it from the list"}
        </Button>
        <span className="infer__assemblies">The graph&rsquo;s assemblies serve releases: {assemblies.join("; ")}.</span>
      </div>
      {asking.state === "failed" ? <ErrorPanel error={asking.error} context="The inference" level={3} /> : null}
      {answer && !inference ? (
        <p className="infer__words">The server answered with origins that are not releases.</p>
      ) : null}
      {answer && inference && best !== null ? (
        <figure className="infer__figure" aria-labelledby="infer-words">
          <p className="infer__words" id="infer-words">
            Most identifiers are found at release <Mono>{best}</Mono>:{" "}
            <Mono>{groupedInteger(inference.counts.get(best) ?? 0)}</Mono> of the{" "}
            <Mono>{groupedInteger(inference.identifiers)}</Mono> distinct identifiers found
            {inference.notFound ? (
              <>
                {" "}
                (<Mono>{groupedInteger(inference.notFound)}</Mono> {inference.notFound === 1 ? "was" : "were"} not
                found)
              </>
            ) : null}
            .{" "}
            {inference.band.length > 1 ? (
              <>
                The list cannot tell releases <Mono>{bandWords(inference.band)}</Mono> apart from it
                {inference.margin !== null ? (
                  <>
                    ; the best release outside them finds <Mono>{groupedInteger(inference.margin)}</Mono> fewer
                  </>
                ) : null}
                .{" "}
                {verdict === "undated"
                  ? "Every release of the graph finds it alike: the list does not date itself, so From release stays empty."
                  : verdict === "band"
                    ? "No release outside them finds any of it, so From release stays empty."
                    : ""}{" "}
                Where you know the release of its annotation, give that one.
              </>
            ) : inference.margin !== null ? (
              <>
                No other release comes as close: the next finds <Mono>{groupedInteger(inference.margin)}</Mono> fewer.
              </>
            ) : null}
            {distinct.length > sent.length ? (
              <>
                {" "}
                Read from the first <Mono>{groupedInteger(sent.length)}</Mono> distinct identifiers (the server&rsquo;s
                bound).
              </>
            ) : null}
          </p>
          <InferenceColumns
            axis={axis}
            bands={bands}
            counts={inference.counts}
            band={new Set(inference.band)}
            best={best}
          />
          <ReleaseScale
            position="below"
            axis={axis}
            bands={bands}
            marks={[{ release: best, label: `best ${String(best)}`, kind: "target" }]}
          />
          <figcaption className="fig-caption">
            The list&rsquo;s distinct identifiers found at each release, on the assembly that serves it (the tallest
            column <Mono>{groupedInteger(Math.max(...inference.counts.values()))}</Mono>); in ink, the releases it
            cannot tell apart from the best. <Mono>POST …/source-inference</Mono>
            {answer.requestId ? (
              <>
                , request <Mono>{answer.requestId}</Mono>
              </>
            ) : null}
            .
          </figcaption>
          {verdict === "dated" ? (
            <div className="infer__use" role="status">
              {current.trim() === String(best) ? (
                <p className="infer__words">
                  <em>From release</em> holds <Mono>{best}</Mono>, the list&rsquo;s best release.
                </p>
              ) : (
                <Button
                  onClick={() => {
                    onUse(inferredOf(inference, answer.requestId));
                  }}
                >
                  {`Read the list at ${String(best)}`}
                </Button>
              )}
            </div>
          ) : null}
        </figure>
      ) : null}
    </div>
  );
}

/** A column per release, as tall as the identifiers found there, over the assembly bands. */
function InferenceColumns({
  axis,
  bands,
  counts,
  band,
  best,
}: {
  axis: ReturnType<typeof axisOf>;
  bands: ReturnType<typeof bandsOf>;
  counts: ReadonlyMap<number, number>;
  band: ReadonlySet<number>;
  best: number;
}) {
  const n = axis.releases.length;
  const max = Math.max(1, ...counts.values());
  return (
    <div className="infer__plot" aria-hidden="true">
      <span className="infer__bands">
        <BandBackdrop bands={bands} />
      </span>
      {axis.releases.map((release, i) => {
        const count = counts.get(release) ?? 0;
        if (!count) return null;
        return (
          <span
            key={release}
            className={`infer__column ${band.has(release) ? "is-band" : ""} ${release === best ? "is-best" : ""}`}
            style={{
              left: `${((i / n) * 100).toFixed(4)}%`,
              width: `${(100 / n).toFixed(4)}%`,
              height: `${((count / max) * 100).toFixed(2)}%`,
            }}
            title={`Release ${String(release)}: ${groupedInteger(count)}`}
          />
        );
      })}
    </div>
  );
}

/** The release the list is read at, with what the inference said of it (the exports record it). */
function inferredOf(inference: ReleaseInference, requestId: string | null): InferredRelease {
  return {
    release: inference.band[0] ?? 0,
    band: inference.band,
    margin: inference.margin,
    identifiers: inference.identifiers,
    not_found: inference.notFound,
    request_id: requestId,
  };
}

/** A list of at least this many distinct identifiers converted without a release is also asked where it comes from. */
export const DATED_FROM = 10;

/** Under the answer of a list converted without a release: one quiet line of what IDTrack's source inference of the
 *  list gives, and, where the list dates itself, a press that reads it at the best release. */
export function ListRelease({
  description,
  identifiers,
  bound,
  onReadAt,
}: {
  description: GraphDescription;
  identifiers: readonly string[];
  bound: number;
  onReadAt: (inferred: InferredRelease) => void;
}) {
  const organism = description.organism;
  const sent = useMemo(() => [...new Set(identifiers)].slice(0, bound), [identifiers, bound]);
  const asked = sent.length >= DATED_FROM ? `${organism}|source-inference|${sent.join("\n")}` : null;
  const answer = useRequest(asked, (signal) =>
    api.sourceInference(organism, { identifiers: sent, mode: "release" }, signal),
  );
  if (asked === null) return null;
  if (answer.state === "failed")
    return (
      <p className="list-release">
        IDTrack&rsquo;s source inference of the list could not be asked.{" "}
        <Button variant="quiet" className="list-release__press" onClick={answer.retry}>
          Ask again
        </Button>
      </p>
    );
  if (answer.state !== "done")
    return (
      <p className="list-release list-release--waiting" aria-busy="true">
        Asking IDTrack where the list comes from…
      </p>
    );
  const inference = readInference(answer.answer.data);
  const best = inference?.band[0];
  if (!inference || best === undefined) return null;
  const verdict = verdictOf(inference, description.releases);
  const found = inference.counts.get(best) ?? 0;
  return (
    <p className="list-release">
      {verdict === "undated" ? (
        <>
          The list does not date itself: IDTrack&rsquo;s source inference finds it alike at every release, so each
          identifier is read at its own release.
        </>
      ) : (
        <>
          {verdict === "dated"
            ? "These identifiers look like release"
            : "These identifiers are found alike at releases"}{" "}
          <Mono>{verdict === "dated" ? String(best) : bandWords(inference.band)}</Mono>:{" "}
          <Mono>{groupedInteger(found)}</Mono> of the <Mono>{groupedInteger(inference.identifiers)}</Mono> found
          {verdict === "dated" && inference.band.length > 1 ? (
            <>
              , and <Mono>{bandWords(inference.band)}</Mono> cannot be told apart
            </>
          ) : null}
          {verdict === "band" ? ", which cannot be told apart; give the release of its annotation" : ""}.{" "}
          {verdict === "dated" ? (
            <Button
              variant="quiet"
              className="list-release__press"
              onClick={() => {
                onReadAt(inferredOf(inference, answer.answer.requestId));
              }}
            >
              Read the list at {best}
            </Button>
          ) : null}
        </>
      )}
    </p>
  );
}
