// Where a list comes from, before it is converted: idtrack's source inference of the pasted identifiers (`POST
// …/source-inference`, mode `release`), drawn as a column per release of the graph (as tall as the distinct
// identifiers found there) on the release axis with the assemblies behind, the band of releases the list cannot tell
// apart from the best in ink, the best named, and a button that reads the list at the best release. The assemblies'
// releases are stated beside, from the graph, for a list whose release is known by its genome build.
import { useMemo } from "react";
import { api } from "../api/client";
import type { GraphDescription } from "../api/types";
import { bandWords, readInference } from "../lib/batchInference";
import type { InferredRelease } from "../lib/batchExport";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { useAction } from "../lib/useRequest";
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
                (<Mono>{groupedInteger(inference.notFound)}</Mono> are in the graph at no release)
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
                . Where you know the release of its annotation, give that one.
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
          <div className="infer__use">
            <Button
              variant="primary"
              disabled={current.trim() === String(best)}
              onClick={() => {
                onUse({
                  release: best,
                  band: inference.band,
                  margin: inference.margin,
                  identifiers: inference.identifiers,
                  notFound: inference.notFound,
                  requestId: answer.requestId,
                });
              }}
            >
              {current.trim() === String(best) ? `Read at ${String(best)}` : `Read the list at ${String(best)}`}
            </Button>
          </div>
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
