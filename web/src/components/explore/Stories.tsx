// Explore's stories, the page's first tab, for the organism chosen with the chips above them (`?organism=`), from the
// server's showcase of that graph (`GET /organisms/{organism}/showcase`, one answer computed when the server started:
// the page converts nothing itself): a folded primer for a reader new to gene ids, the journeys of the graph (the
// first figure), what can happen to a gene id (the cases, each drawn from its answer: lib/explore/gallery.ts) and one
// journey up close with its replay, then a quiet way on to every id of the graph drawn as a line. The parts stand in
// their final order from the first paint, each in the room it will take, so that nothing the reader sees moves when
// the showcase and the gallery's code arrive.
import { Suspense } from "react";
import type { GraphDescription } from "../../api/types";
import { caseQueryOf } from "../../lib/home/links";
import { docsPage } from "../../lib/links";
import { storiesOf } from "../../lib/explore/gallery";
import { href } from "../../lib/router";
import { Expandable } from "../v2/Expandable";
import { Link } from "../ui";
import { lazyPart } from "../../lib/lazyPart";
import { chipName } from "../../lib/explore/chips";
import { organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { usePhone } from "../../lib/usePhone";
import { useShowcase } from "../../lib/showcase";
import { ErrorBoundary } from "../ErrorBoundary";
import { OrganismChoice } from "../v2/OrganismChoice";
import { JourneysStory } from "./Journeys";
import { JourneyUpClose } from "./JourneyUpClose";
import "../../styles/home.css";

// The cases (with the evidence marks' code) are their own chunk, asked for as soon as this module is, beside the
// showcase: neither waits for the other.
const CaseGallery = lazyPart(() => import("./CaseGallery").then((m) => ({ default: m.CaseGallery })));
void CaseGallery.preload();

/** The organism whose stories are told: one chip per graph, one chosen (a radio group; the arrow keys move); on a
 *  phone, one menu of the graphs (a select), so that the first screen holds one control for it, not five. */
export function StoriesOrganism() {
  const { organisms, current, choose } = useOrganisms();
  const phone = usePhone();
  if (!current || organisms.length < 2) return null;
  if (phone)
    return (
      <label className="stories-organism stories-organism--select">
        <span className="visually-hidden">Stories of the graph</span>
        <select
          className="input"
          value={current.organism}
          onChange={(event) => {
            choose(event.target.value);
          }}
        >
          {organisms.map((o) => (
            <option key={o.organism} value={o.organism}>
              {chipName(o.organism)} ({organismName(o.organism)})
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <OrganismChoice
      className="stories-organism"
      label="Stories of the graph"
      value={current.organism}
      onChange={choose}
    />
  );
}

/** The room of the stories while the showcase or the gallery's code come: at least the window's height, so that what
 *  stands below it is out of view until it is drawn. */
function GalleryReserve() {
  return <div className="stories-reserve stories-reserve--cases" aria-hidden="true" />;
}

/** For a reader new to gene ids: what an id is, what Ensembl's releases record of it and what IDTrack does with that,
 *  folded under one line (IDTrack's documentation says it in full). */
function GeneIdPrimer() {
  return (
    <Expandable className="stories-primer" summary="New to gene ids?">
      <p>
        Ensembl names every gene with a stable id, such as <span className="mono">ENSG00000141510</span>, and a version
        after its dot that changes when the gene&apos;s model changes. Each release of Ensembl records what became of
        every id since the release before: kept with a new version, replaced by another id, split into several or merged
        into one, or retired; and a gene&apos;s names and the ids other databases give it change too.
      </p>
      <p>
        IDTrack follows those records, release by release, to say what an identifier read at one release is at another,
        and answers with the path that led there. The stories below are real answers of this server.{" "}
        <a href={docsPage("concepts.html")}>How IDTrack answers</a>, in its documentation.
      </p>
    </Expandable>
  );
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
  const told = showcase ? storiesOf(showcase) : null;
  const lineage = told?.upClose ?? null;
  const cases = told?.cases ?? [];
  return (
    <div className="home stories">
      <JourneysStory graph={graph} />
      <GeneIdPrimer />
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
                longest={told?.longest ?? null}
              />
            </ErrorBoundary>
          ) : null}
          <p className="stories-onward">
            <Link to={`${href(`/organisms/${graph.organism}`, { tab: "history" })}#history`}>
              Every id of the <em>{organismName(graph.organism)}</em> graph, a line: point at one
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
