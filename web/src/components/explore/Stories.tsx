// Explore's stories, the page's first part: what can happen to a gene id (the cases, each drawn from its answer) and one
// journey up close with its replay, for the organism chosen in the page's head (`?organism=`), from the server's showcase
// of that graph (`GET /organisms/{organism}/showcase`, one answer computed when the server started: the page converts
// nothing itself). The two sections stand in their final order from the first paint, each in the room it will take, so
// that nothing the reader sees moves when the showcase and the gallery's code arrive.
import { Suspense, useId } from "react";
import type { GraphDescription } from "../../api/types";
import { caseQueryOf } from "../../lib/home/links";
import { lazyPart } from "../../lib/lazyPart";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useShowcase } from "../../lib/showcase";
import { ErrorBoundary } from "../ErrorBoundary";
import { ErrorPanel } from "../ErrorPanel";
import { JourneyUpClose } from "./JourneyUpClose";
import "../../styles/home.css";

// The cases (with the evidence marks' code) are their own chunk, asked for as soon as this module is, beside the
// showcase: neither waits for the other.
const CaseGallery = lazyPart(() => import("./CaseGallery").then((m) => ({ default: m.CaseGallery })));
CaseGallery.preload();

/** The organism whose stories are told: the select of the page's head (the other panels show every graph at once). */
export function StoriesOrganism() {
  const { organisms, current, choose } = useOrganisms();
  const id = useId();
  if (!current || organisms.length < 2) return null;
  return (
    <div className="stories-organism">
      <label className="field__label" htmlFor={id}>
        Stories of the graph
      </label>
      <span className="select">
        <select
          id={id}
          className="select__control"
          value={current.organism}
          onChange={(e) => {
            choose(e.target.value);
          }}
        >
          {organisms.map((o) => (
            <option key={o.organism} value={o.organism}>
              {organismName(o.organism)}
              {commonName(o.organism) ? ` (${commonName(o.organism)})` : ""}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** The room of the gallery while its cases or its code come: at least the window's height, so that what stands below
 *  it is out of view until it is drawn. */
function GalleryReserve() {
  return <div className="stories-reserve stories-reserve--cases" aria-hidden="true" />;
}

export function ExploreStories() {
  const { organisms, current } = useOrganisms();
  if (!current || !organisms.length) return <GalleryReserve />;
  return (
    <ErrorBoundary part="The stories" resetKey={current.organism}>
      <StoriesOf graph={current} />
    </ErrorBoundary>
  );
}

function StoriesOf({ graph }: { graph: GraphDescription }) {
  const answer = useShowcase(graph.organism);
  if (answer.state === "failed")
    return (
      <div className="stories">
        <ErrorPanel error={answer.error} onRetry={answer.retry} context="The stories of this graph" level={2} />
      </div>
    );
  if (answer.state !== "done")
    return (
      <div className="stories" aria-busy="true">
        <GalleryReserve />
      </div>
    );
  const showcase = answer.answer.data;
  const lineage = showcase.cases.find((c) => c.kind === "lineage" && c.result) ?? null;
  const cases = showcase.cases.filter((c) => c.kind !== "lineage");
  return (
    <div className="home stories">
      {cases.length ? (
        <ErrorBoundary part="The cases" resetKey={graph.organism}>
          <Suspense fallback={<GalleryReserve />}>
            <CaseGallery graph={graph} cases={cases} letter={null} level={2} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      {lineage?.result ? (
        <ErrorBoundary part="The journey up close" resetKey={graph.organism}>
          <JourneyUpClose
            query={caseQueryOf(graph.organism, lineage.query)}
            result={lineage.result}
            graph={graph}
            letter={null}
            level={2}
          />
        </ErrorBoundary>
      ) : null}
    </div>
  );
}
