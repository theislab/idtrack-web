// Explore's stories, the page's first tab, for the organism chosen with the chips above them (`?organism=`), from the
// server's showcase of that graph (`GET /organisms/{organism}/showcase`, one answer computed when the server started:
// the page converts nothing itself): the journeys of the graph (the first figure), what can happen to a gene id (the
// cases, each drawn from its answer) and one journey up close with its replay. The three stand in their final order
// from the first paint, each in the room it will take, so that nothing the reader sees moves when the showcase and the
// gallery's code arrive.
import { Suspense } from "react";
import type { GraphDescription } from "../../api/types";
import { caseQueryOf } from "../../lib/home/links";
import { lazyPart } from "../../lib/lazyPart";
import { chipName } from "../../lib/explore/chips";
import { organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useShowcase } from "../../lib/showcase";
import { ErrorBoundary } from "../ErrorBoundary";
import { Segmented } from "../v2/Segmented";
import { JourneysStory } from "./Journeys";
import { JourneyUpClose } from "./JourneyUpClose";
import "../../styles/home.css";

// The cases (with the evidence marks' code) are their own chunk, asked for as soon as this module is, beside the
// showcase: neither waits for the other.
const CaseGallery = lazyPart(() => import("./CaseGallery").then((m) => ({ default: m.CaseGallery })));
void CaseGallery.preload();

/** The organism whose stories are told: one chip per graph, one chosen (a radio group; the arrow keys move). */
export function StoriesOrganism() {
  const { organisms, current, choose } = useOrganisms();
  if (!current || organisms.length < 2) return null;
  return (
    <Segmented
      className="stories-organism"
      label="Stories of the graph"
      value={current.organism}
      options={organisms.map((o) => ({
        value: o.organism,
        label: (
          <span title={organismName(o.organism)}>
            {chipName(o.organism)}
            <span className="visually-hidden"> ({organismName(o.organism)})</span>
          </span>
        ),
      }))}
      onChange={choose}
    />
  );
}

/** The room of the stories while the showcase or the gallery's code come: at least the window's height, so that what
 *  stands below it is out of view until it is drawn. */
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
  // A showcase the server did not give is said once, in the journeys' place (with its wait and Try again).
  if (answer.state === "failed")
    return (
      <div className="stories">
        <JourneysStory graph={graph} />
      </div>
    );
  const showcase = answer.state === "done" ? answer.answer.data : null;
  const lineage = showcase?.cases.find((c) => c.kind === "lineage" && c.result) ?? null;
  const cases = showcase?.cases.filter((c) => c.kind !== "lineage") ?? [];
  return (
    <div className="home stories">
      <JourneysStory graph={graph} />
      {!showcase ? (
        <GalleryReserve />
      ) : (
        <>
          {cases.length ? (
            <ErrorBoundary part="The cases" resetKey={graph.organism}>
              <Suspense fallback={<GalleryReserve />}>
                <CaseGallery graph={graph} cases={cases} />
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
        </>
      )}
    </div>
  );
}
