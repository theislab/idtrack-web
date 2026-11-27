// The place of Explore's stories, above the graphs side by side: what can happen to a gene id (the cases, each drawn from
// its answer), one journey up close with its replay, and what the server holds, built by the home's components
// (components/home/) from the server's showcase of the organism chosen here (`GET /organisms/{organism}/showcase`, one
// answer computed when the server started: the page converts nothing itself). The organism is the address's
// (`?organism=`), chosen with the control beside the title; the page's other panels show every graph at once.
import { Suspense, useId } from "react";
import type { GraphDescription } from "../../api/types";
import { caseQueryOf } from "../../lib/home/links";
import { lazyPart } from "../../lib/lazyPart";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { useShowcase } from "../../lib/showcase";
import { ErrorBoundary } from "../ErrorBoundary";
import { ErrorPanel } from "../ErrorPanel";
import { FactsStrip } from "../home/FactsStrip";
import { JourneyUpClose } from "../home/JourneyUpClose";
import "../../styles/home.css";

// The cases (with the evidence marks' code) are their own chunk, fetched once the page has drawn.
const CaseGallery = lazyPart(() => import("../home/CaseGallery").then((m) => ({ default: m.CaseGallery })));

export function ExploreStories() {
  const { organisms, current, choose } = useOrganisms();
  const id = useId();
  if (!current || !organisms.length) return null;
  return (
    <section className="stories" aria-labelledby={`${id}-title`}>
      <header className="stories__head">
        <h2 id={`${id}-title`} className="stories__title">
          Stories from Ensembl&apos;s history
        </h2>
        <p className="stories__lede">
          Real identifiers of one graph, answered by this server when it started: what can happen to a gene id, one
          journey through every assembly with Ensembl&apos;s scores, and what the server holds.
        </p>
        {organisms.length > 1 ? (
          <label className="stories__organism">
            <span className="field__label">Organism</span>
            <span className="select">
              <select
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
          </label>
        ) : null}
      </header>
      <ErrorBoundary part="The stories" resetKey={current.organism}>
        <StoriesOf graph={current} />
      </ErrorBoundary>
    </section>
  );
}

function StoriesOf({ graph }: { graph: GraphDescription }) {
  const { organisms } = useOrganisms();
  const answer = useShowcase(graph.organism);
  if (answer.state === "failed")
    return <ErrorPanel error={answer.error} onRetry={answer.retry} context="The stories of this graph" level={3} />;
  const showcase = answer.state === "done" ? answer.answer.data : null;
  const lineage = showcase?.cases.find((c) => c.kind === "lineage" && c.result) ?? null;
  const cases = showcase?.cases.filter((c) => c.kind !== "lineage") ?? [];
  return (
    <div className="home stories__body">
      {cases.length ? (
        <ErrorBoundary part="The cases" resetKey={graph.organism}>
          <Suspense fallback={null}>
            <CaseGallery graph={graph} cases={cases} letter={null} level={3} />
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
            level={3}
          />
        </ErrorBoundary>
      ) : null}
      <FactsStrip organisms={organisms} letter={null} level={3} />
    </div>
  );
}
