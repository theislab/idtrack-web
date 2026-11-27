// The Convert page before a conversion: one screen, the hero. On one side what idtrack does, in a line and a sentence,
// the form (the identifier, the organism, Convert; the releases and the database folded in one line that says them;
// examples to try) and the ways on; on the other the figure: real identifiers of the graph in view, each drawn as its
// journey through the releases over the assembly bands, travelling once as the page appears, as this server answered
// them when it started (`GET /organisms/{organism}/showcase`: the page converts nothing itself). The head paints first,
// before the server's organisms are known; the figure's room is held before it is drawn, so nothing moves. The longer
// stories of the showcase (the cases, one journey up close, the server's facts) are on Explore
// (components/explore/Stories.tsx).
import { Suspense, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphDescription } from "../api/types";
import { databaseLabel } from "../lib/databases";
import { drawnEvents, releaseEvents } from "../lib/home/journeyModel";
import { journeyList, journeySets } from "../lib/home/journeys";
import { releasesOf } from "../lib/home/links";
import { setsThatFit, STILL_FIGURE } from "../lib/home/useJourneys";
import { lazyPart } from "../lib/lazyPart";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import { useShowcase } from "../lib/showcase";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErrorPanel } from "./ErrorPanel";
import { FigureLegend } from "./figure/Legend";
import { CaptionMore } from "./home/CaptionMore";
import { Link, Mono } from "./ui";
import "../styles/home.css";

// The drawing is its own chunk: the head and the form paint first; the showcase is asked for meanwhile.
const JourneysFigure = lazyPart(() => import("./home/JourneysFigure").then((m) => ({ default: m.JourneysFigure })));

/** The hero's line: what idtrack does, in its documentation's terms. */
const HERO_TITLE = "Follow a gene\u00a0id through Ensembl's history";

export function ConvertEmpty({ description, form }: { description: GraphDescription | null; form: ReactNode }) {
  const id = useId();
  const { organisms } = useOrganisms();
  const releases = releasesOf(organisms);
  return (
    <section className="hero" aria-labelledby={`${id}-title`}>
      <div className="hero__text">
        <p className="hero__eyebrow">
          {organisms.length ? (
            <>
              {groupedInteger(organisms.length)} {organisms.length === 1 ? "organism" : "organisms"}{" "}
              <span aria-hidden="true">·</span> Ensembl releases <span className="mono">{releaseRanges(releases)}</span>
            </>
          ) : (
            "idtrack"
          )}
        </p>
        <h1 id={`${id}-title`} className="hero__title">
          {HERO_TITLE}
        </h1>
        <p className="hero__lede">
          Give a gene id or symbol of any release: idtrack follows it through Ensembl&apos;s own records to the release
          and database you ask, with the evidence for every step, within one organism.
        </p>
        <div className="hero__form">{form}</div>
        <nav className="hero__ways" aria-label="More of idtrack">
          <Link to="/organisms" className="hero__way hero__way--first">
            Explore Ensembl&apos;s history
          </Link>
          <Link to="/method" className="hero__way">
            How idtrack answers
          </Link>
          <Link to={description ? href("/batch", { organism: description.organism }) : "/batch"} className="hero__way">
            Convert a list
          </Link>
        </nav>
      </div>
      {description ? (
        <ErrorBoundary part="The figure of journeys" resetKey={description.organism}>
          <HeroFigure graph={description} />
        </ErrorBoundary>
      ) : (
        <div className="hero__figure" aria-hidden="true">
          <div className="hero__plot" />
        </div>
      )}
    </section>
  );
}

/** The size of an element's box, measured before paint and kept current (the figure fills the hero's room). */
function useBoxHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const set = (width: number, height: number) => {
      const w = Math.floor(width);
      const h = Math.floor(height);
      if (w > 0 && h > 0)
        setSize((s) =>
          s !== null && Math.abs(s.height - h) < 2 && Math.abs(s.width - w) < 2 ? s : { width: w, height: h },
        );
    };
    set(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) set(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, height: size?.height ?? null, width: size?.width ?? null };
}

/** The hero's figure: the showcase's journeys of the graph in view, filling the room the hero gives it. */
function HeroFigure({ graph }: { graph: GraphDescription }) {
  const id = useId();
  const answer = useShowcase(graph.organism);
  const { ref: boxRef, height: boxHeight, width: boxWidth } = useBoxHeight<HTMLDivElement>();
  const showcase = answer.state === "done" ? answer.answer.data : null;
  const allSets = useMemo(() => (showcase ? journeySets(showcase) : []), [showcase]);
  const all = journeyList(allSets);
  // A narrow hero (a phone) draws a still image of the sets it holds whole; the caption says how many.
  const still = boxWidth !== null && boxWidth < STILL_FIGURE;
  const sets = useMemo(
    () => (still && boxHeight !== null ? setsThatFit(allSets, boxHeight) : allSets),
    [allSets, still, boxHeight],
  );
  const list = journeyList(sets);
  const drawn = useMemo(() => journeyList(sets).flatMap((j) => (j.model ? [j.model] : [])), [sets]);
  const events = useMemo(() => drawnEvents(releaseEvents(drawn, 0.5), 3), [drawn]);
  const name = organismName(graph.organism);
  const endpoint = `GET /api/v1/organisms/${graph.organism}/showcase`;
  const first = graph.releases[0];
  const last = graph.snapshot_release;
  return (
    <figure className="hero__figure" aria-describedby={`${id}-caption`}>
      <div className="hero__plot" ref={boxRef}>
        {answer.state === "failed" ? (
          <div className="hero__failed">
            <ErrorPanel error={answer.error} onRetry={answer.retry} context="The journeys" level={2} />
          </div>
        ) : showcase && boxHeight !== null && list.length ? (
          <Suspense fallback={null}>
            <JourneysFigure
              graph={graph}
              sets={sets}
              events={events}
              symbols={null}
              named={false}
              fit={boxHeight}
              label={`${id}-caption`}
            />
          </Suspense>
        ) : null}
      </div>
      <FigureLegend
        entries={[
          { key: "gene", glyph: "gene-thin", text: "a journey, read (circle) to answer (square)" },
          { key: "version", glyph: "version", text: "new version" },
          { key: "event", glyph: "event", text: "split or merge" },
          { key: "loop", glyph: "loop", text: "re-mapped to itself" },
          { key: "handoff", glyph: "handoff", text: "assembly change" },
          { key: "cross", glyph: "cross", text: "another database" },
        ]}
      />
      <figcaption id={`${id}-caption`} className="fig-caption hero__caption">
        {showcase && list.length ? (
          <CaptionMore
            lead={
              <>
                {list.length === all.length ? list.length : `The first ${list.length} of ${all.length}`} identifiers of
                the <em>{name}</em> graph{list.length === all.length ? "" : " (every one on a wider screen)"}, each
                drawn as its best answer&apos;s path through the releases.
              </>
            }
          >
            Each runs from the release it is read at to the release asked, over the assemblies of releases {first}–
            {last}; answered once when the server started (<Mono>{endpoint}</Mono>). Point at a journey for its steps;
            Enter opens it.
          </CaptionMore>
        ) : answer.state === "failed" ? (
          <>
            The journeys of the <em>{name}</em> graph, from <Mono>{endpoint}</Mono>: not drawn, since the server did not
            give them.
          </>
        ) : showcase ? (
          <>
            This server holds no chosen journeys for the <em>{name}</em> graph (<Mono>{endpoint}</Mono> answered none).
          </>
        ) : (
          <>
            The journeys of the <em>{name}</em> graph through releases {first}–{last}, from <Mono>{endpoint}</Mono>,
            drawn when they arrive.
          </>
        )}
      </figcaption>
      {showcase ? (
        <ul className="visually-hidden" aria-label="The journeys in words">
          {all.map((j) => (
            <li key={`${j.set}-${j.identifier}`}>
              {j.model
                ? `${j.model.result.query_id}, read at release ${j.model.result.from_release}${
                    j.model.result.from_databases.filter((d) => !/^(base_)?ensembl_/.test(d)).length
                      ? ` in ${j.model.result.from_databases
                          .filter((d) => !/^(base_)?ensembl_/.test(d))
                          .map(databaseLabel)
                          .join(", ")}`
                      : ""
                  }: ${[...new Set(j.model.best.map((c) => c.target))].join(", ")} at release ${j.model.result.to_release}, ${j.model.marks.length} steps`
                : `${j.identifier}: no best answer to draw`}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
