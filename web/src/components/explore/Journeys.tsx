// The first figure of Explore's stories: the journeys of the graph in view, real identifiers each drawn as its journey
// through the releases over the assembly bands, as this server answered them when it started
// (`GET /organisms/{organism}/showcase`: the page converts nothing itself), the most convoluted first. The figure fills
// a room of its own (the window less the page's head, within bounds), its caption's claim under it with its key one
// press away (a hover card), then a quiet filter and "Draw all"; how to read it, and every journey in words, one press
// away.
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StepGlyph } from "../figure/glyphs";
import { HoverCard } from "../v2/HoverCard";
import { Segmented } from "../v2/Segmented";
import type { GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { isEnsembl } from "../../lib/home/journeyModel";
import {
  bridgesOf,
  journeyList,
  journeySets,
  legendMarks,
  readDatabases,
  type Journey,
  type LegendMark,
} from "../../lib/home/journeys";
import { filteredSets, rankedSets, setDatabases, type JourneyFilter } from "../../lib/home/useJourneys";
import { CONVOLUTION_WORDS, journeyStepsText } from "../../lib/path/steps";
import { lazyPart } from "../../lib/lazyPart";
import { organismName } from "../../lib/organismNames";
import { useShowcase } from "../../lib/showcase";
import { ErrorBoundary } from "../ErrorBoundary";
import { ErrorPanel } from "../ErrorPanel";
import { FigureLegend, type LegendEntry } from "../figure/Legend";
import { CaptionMore } from "../v2/CaptionMore";
import { Mono } from "../ui";
import type { JourneysDrawn } from "./JourneysFigure";

// The drawing is its own chunk, asked for at once (beside the showcase), so that its frame stands before the journeys
// arrive.
const JourneysFigure = lazyPart(() => import("./JourneysFigure").then((m) => ({ default: m.JourneysFigure })));
void JourneysFigure.preload();

/** The key of the journeys: the line of a journey, then each kind of mark the journeys drawn hold (only those). */
function legendEntries(marks: readonly LegendMark[]): LegendEntry[] {
  const swatch = (content: ReactNode) => (
    <svg className="fig-swatch" width={30} height={16} viewBox="0 0 30 16" aria-hidden="true">
      {content}
    </svg>
  );
  const of: Record<LegendMark, LegendEntry> = {
    idchange: {
      key: "idchange",
      swatch: swatch(
        <>
          <line x1={2} x2={15} y1={8} y2={8} className="jr-line" />
          <line x1={15} x2={28} y1={8} y2={8} className="jr-line jr-line--b" />
        </>,
      ),
      text: "a change of stable id (the line's tone changes)",
    },
    version: { key: "version", glyph: "version", text: "new version or replacement" },
    event: { key: "event", glyph: "event", text: "split or merge" },
    fork: {
      key: "fork",
      swatch: swatch(
        <>
          <line x1={4} x2={26} y1={8} y2={8} className="jr-line" />
          <line x1={17} y1={6.5} x2={22} y2={4} className="jr-fork" />
          <line x1={17} y1={6.5} x2={22} y2={1.8} className="jr-fork" />
          <line x1={8} y1={12} x2={13} y2={9.5} className="jr-fork" />
        </>,
      ),
      text: "a stub for each other id a split passed to (above) or a merge received (below), four at most",
    },
    loop: { key: "loop", glyph: "loop", text: "re-mapped to itself" },
    handoff: { key: "handoff", glyph: "handoff", text: "step at an assembly change" },
    handoffEvent: {
      key: "handoffEvent",
      swatch: swatch(<StepGlyph glyph="handoff" x={15} y={8} size="thin" event />),
      text: "a step at an assembly change that is also a split or merge",
    },
    cross: { key: "cross", glyph: "cross", text: "another database" },
    bridge: { key: "bridge", glyph: "bridge", text: "bridge (IDTrack's inference)" },
    back: {
      key: "back",
      swatch: swatch(
        <text x={15} y={12} textAnchor="middle" className="jr-legend-back">
          ←
        </text>,
      ),
      text: "back in time",
    },
    same: { key: "same", swatch: swatch(<path d="M13,2h4V14h-4" className="jr-same" />), text: "same answer" },
  };
  return [{ key: "gene", glyph: "gene-thin", text: "read (○) to answer (■)" }, ...marks.map((m) => of[m])];
}

/** The filter's choices: every journey, or those of one kind (read from each answer's own fields). */
const FILTERS: { value: JourneyFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "events", label: "Splits and merges" },
  { value: "bridges", label: "Bridges" },
  { value: "back", label: "Back in time" },
  { value: "databases", label: "Other databases" },
];

/** The height of an element's box, measured before paint and kept current. */
function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const set = (h: number) => {
      const next = Math.floor(h);
      setHeight((s) => (s !== null && Math.abs(s - next) < 2 ? s : next));
    };
    set(element.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) set(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, height] as const;
}

/** A journey in words: its identifier, where it is read, its answer, its steps and its bridges (the figure's text
 *  alternative, and the list a reader can open). */
function journeyWords(j: Journey): string {
  const m = j.model;
  if (!m)
    return `${j.identifier}: ${j.error ? `not answered when the server started (${j.error.message})` : "no best answer to draw"}`;
  const r = m.result;
  const read = r.from_databases.filter((d) => !isEnsembl(d));
  const bridges = bridgesOf(j);
  return `${r.query_id}, read at release ${r.from_release}${read.length ? ` in ${read.map(databaseLabel).join(", ")}` : ""}: ${[
    ...new Set(m.best.map((c) => c.target)),
  ].join(", ")} at release ${r.to_release}${m.backward ? ", walked back in time" : ""}, ${journeyStepsText(r)}${
    bridges.length
      ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), IDTrack's inference`
      : ""
  }`;
}

/** The journeys of a graph, filling the room the stories give them. */
export function JourneysStory({ graph }: { graph: GraphDescription }) {
  return (
    <section className="journeys-story" aria-label="Journeys of this graph">
      <ErrorBoundary part="The figure of journeys" resetKey={graph.organism}>
        <JourneysOf graph={graph} />
      </ErrorBoundary>
    </section>
  );
}

function JourneysOf({ graph }: { graph: GraphDescription }) {
  const id = useId();
  const answer = useShowcase(graph.organism);
  const [roomRef, roomHeight] = useHeight<HTMLDivElement>();
  const [captionRef, captionHeight] = useHeight<HTMLElement>();
  const [drawn, setDrawn] = useState<JourneysDrawn | null>(null);
  const [listed, setListed] = useState(false);
  const [filter, setFilter] = useState<JourneyFilter>("all");
  const [drawAll, setDrawAll] = useState(false);
  // How a reader reaches a journey: by touch where the primary pointer cannot hover (the caption says so).
  const [touch] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches);
  const onDrawn = useCallback((d: JourneysDrawn) => {
    setDrawn((p) =>
      p?.drawn === d.drawn && p.of === d.of && p.narrow === d.narrow && p.marks.join() === d.marks.join() ? p : d,
    );
  }, []);
  const showcase = answer.state === "done" ? answer.answer.data : null;
  // The sets ranked (the most convoluted journey of each first, the most branched set first), then filtered.
  const ranked = showcase ? rankedSets(journeySets(showcase)) : null;
  const sets = ranked ? filteredSets(ranked, filter) : null;
  const all = ranked ? journeyList(ranked) : [];
  const kept = sets ? journeyList(sets) : [];
  const name = organismName(graph.organism);
  const endpoint = `GET /api/v1/organisms/${graph.organism}/showcase`;
  const first = graph.releases[0];
  const last = graph.snapshot_release;
  // The figure fills the room less its caption and the air between them (its tools stand under the room).
  const fit = roomHeight !== null && captionHeight !== null ? Math.max(160, roomHeight - captionHeight - 12 - 2) : null;
  const listId = `${id}-list`;
  const some = drawn !== null && drawn.drawn < drawn.of;
  const filtered = filter !== "all";
  const keyEntries = legendEntries(drawn?.marks ?? legendMarks(kept));
  return (
    <>
      <figure
        className={`journeys-story__figure${drawAll ? " journeys-story__figure--all" : ""}`}
        aria-describedby={`${id}-caption`}
      >
        <div className="journeys-story__frame" ref={roomRef}>
          <div className="journeys-story__plot">
            {answer.state === "failed" ? (
              <div className="journeys-story__failed" style={fit !== null ? { minHeight: fit } : undefined}>
                <ErrorPanel
                  error={answer.error}
                  onRetry={answer.retry}
                  context="The request for the journeys"
                  level={2}
                />
              </div>
            ) : fit !== null && (sets === null || kept.length) ? (
              <JourneysFigure graph={graph} sets={sets} fit={fit} all={drawAll} onDrawn={onDrawn} />
            ) : null}
          </div>
          <figcaption id={`${id}-caption`} className="fig-caption journeys-story__caption" ref={captionRef}>
            {showcase && all.length ? (
              <>
                <CaptionMore
                  lead={
                    <>
                      {drawn && some
                        ? `${drawn.drawn} of the ${filtered ? `${kept.length} kept` : all.length}`
                        : `The ${filtered ? `${kept.length} kept of the ${all.length}` : all.length}`}{" "}
                      journeys of the <em>{name}</em> graph{some ? ", the most convoluted first" : ""}.
                    </>
                  }
                >
                  Each is drawn along its best answer&apos;s path through releases {first}–{last}, as this server
                  answered it when it started (<Mono>{endpoint}</Mono>). The journeys of a set share their
                  request&apos;s parameters; {CONVOLUTION_WORDS}, and the sets by their most convoluted journey. A
                  journey&apos;s steps are those of its best answer&apos;s path, as the answer&apos;s &quot;In
                  words&quot; lists them. At rest the rows are drawn without their ids:{" "}
                  {touch
                    ? "tap a journey for its ids and steps, again to open it. "
                    : "point at a journey for its ids and steps; Enter or a click opens it. "}
                  <button
                    type="button"
                    className="journeys-story__list-toggle"
                    aria-expanded={listed}
                    aria-controls={listId}
                    onClick={() => {
                      setListed((o) => !o);
                    }}
                  >
                    {listed ? "Hide the list" : `Every one of the ${all.length} in words`}
                  </button>
                </CaptionMore>{" "}
                <HoverCard
                  className="cases-key journeys-story__key"
                  triggerClassName="cases-key__button"
                  label="Key: reading the journeys"
                  trigger={<>Key</>}
                >
                  <FigureLegend entries={keyEntries} label="The marks of the journeys" />
                  {ranked?.length ? (
                    <>
                      <p className="cases-key__lead">The sets, with the databases each reads and answers in:</p>
                      <ul className="journeys-story__sets">
                        {ranked.map((set, s) => (
                          <li key={s}>
                            {setDatabases(set, graph.snapshot_release, readDatabases(set).map(databaseLabel))}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </HoverCard>
              </>
            ) : answer.state === "failed" ? (
              <>
                The journeys of the <em>{name}</em> graph, from <Mono>{endpoint}</Mono>: not drawn, since the server did
                not give them.
              </>
            ) : showcase ? (
              <>
                This server holds no chosen journeys for the <em>{name}</em> graph (<Mono>{endpoint}</Mono> answered
                none).
              </>
            ) : (
              <>
                The journeys of the <em>{name}</em> graph through releases {first}–{last}, from <Mono>{endpoint}</Mono>,
                drawn when they arrive.
              </>
            )}
          </figcaption>
        </div>
      </figure>
      <div className="journeys-story__tools" hidden={answer.state === "failed" || (showcase !== null && !all.length)}>
        <Segmented
          className="journeys-story__filter"
          label="Journeys drawn"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
        <button
          type="button"
          className="journeys-story__all"
          aria-pressed={drawAll}
          onClick={() => {
            setDrawAll((d) => !d);
          }}
        >
          {drawAll ? "Fit to the screen" : `Draw all ${kept.length}`}
        </button>
      </div>
      {showcase ? (
        <ol
          id={listId}
          className={`journeys-story__list${listed ? "" : " visually-hidden"}`}
          aria-label="The journeys in words"
        >
          {all.map((j) => (
            <li key={`${j.set}-${j.identifier}`}>{journeyWords(j)}</li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
