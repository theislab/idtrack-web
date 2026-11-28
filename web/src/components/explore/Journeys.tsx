// The first figure of Explore's stories: the journeys of the graph in view, real identifiers each drawn as its journey
// through the releases over the assembly bands, as this server answered them when it started
// (`GET /organisms/{organism}/showcase`: the page converts nothing itself). The figure fills a room of its own (the
// window less the page's head, within bounds), its legend under it and its caption's claim under that; how to read it,
// and every journey in words, one press away.
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { isEnsembl } from "../../lib/home/journeyModel";
import {
  bridgesOf,
  journeyList,
  journeySets,
  legendMarks,
  type Journey,
  type LegendMark,
} from "../../lib/home/journeys";
import { plural } from "../../lib/home/stepWords";
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

/** The legend of the journeys: the line of a journey, then each kind of mark the journeys hold (only those). */
function legendEntries(marks: readonly LegendMark[]): LegendEntry[] {
  const swatch = (content: ReactNode) => (
    <svg className="fig-swatch" width={30} height={16} viewBox="0 0 30 16" aria-hidden="true">
      {content}
    </svg>
  );
  const of: Record<LegendMark, LegendEntry> = {
    version: { key: "version", glyph: "version", text: "new version or replacement" },
    event: { key: "event", glyph: "event", text: "split or merge" },
    loop: { key: "loop", glyph: "loop", text: "re-mapped to itself" },
    handoff: { key: "handoff", glyph: "handoff", text: "step at an assembly change" },
    cross: { key: "cross", glyph: "cross", text: "another database" },
    bridge: { key: "bridge", glyph: "bridge", text: "bridge (inferred)" },
    back: {
      key: "back",
      swatch: swatch(
        <text x={15} y={12} textAnchor="middle" className="jr-legend-back">
          ←
        </text>,
      ),
      text: "back in time",
    },
    changed: { key: "changed", swatch: <b className="jr-legend-bold mono">Ab</b>, text: "answer other than the id" },
    same: { key: "same", swatch: swatch(<path d="M13,2h4V14h-4" className="jr-same" />), text: "same answer" },
  };
  return [{ key: "gene", glyph: "gene-thin", text: "read (○) to answer (■)" }, ...marks.map((m) => of[m])];
}

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
  ].join(
    ", ",
  )} at release ${r.to_release}${m.backward ? ", walked back in time" : ""}, ${plural(m.marks.length, "step")}${
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
  const [legendRef, legendHeight] = useHeight<HTMLDivElement>();
  const [captionRef, captionHeight] = useHeight<HTMLElement>();
  const [drawn, setDrawn] = useState<JourneysDrawn | null>(null);
  const [listed, setListed] = useState(false);
  // How a reader reaches a journey: by touch where the primary pointer cannot hover (the caption says so).
  const [touch] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches);
  const onDrawn = useCallback((d: JourneysDrawn) => {
    setDrawn((p) =>
      p?.drawn === d.drawn && p.of === d.of && p.narrow === d.narrow && p.marks.join() === d.marks.join() ? p : d,
    );
  }, []);
  const showcase = answer.state === "done" ? answer.answer.data : null;
  const sets = showcase ? journeySets(showcase) : null;
  const all = sets ? journeyList(sets) : [];
  const name = organismName(graph.organism);
  const endpoint = `GET /api/v1/organisms/${graph.organism}/showcase`;
  const first = graph.releases[0];
  const last = graph.snapshot_release;
  // The figure fills the room less its legend, its caption and the air between them.
  const fit =
    roomHeight !== null && legendHeight !== null && captionHeight !== null
      ? Math.max(160, roomHeight - legendHeight - captionHeight - 2 * 12 - 2)
      : null;
  const listId = `${id}-list`;
  const some = drawn !== null && drawn.drawn < drawn.of;
  return (
    <>
      <figure className="journeys-story__figure" aria-describedby={`${id}-caption`}>
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
            ) : fit !== null && (sets === null || all.length) ? (
              <JourneysFigure graph={graph} sets={sets} fit={fit} onDrawn={onDrawn} />
            ) : null}
          </div>
          {/* The legend names the marks drawn; its room is that of a legend of every mark the journeys hold (measured
            unseen), so the room the figure fills does not change with the rows it draws. */}
          <div
            className="journeys-story__legend"
            hidden={answer.state === "failed" || (showcase !== null && !all.length)}
          >
            <div className="journeys-story__legend-room" ref={legendRef} aria-hidden="true">
              <FigureLegend entries={legendEntries(legendMarks(all))} />
            </div>
            <FigureLegend entries={legendEntries(drawn?.marks ?? legendMarks(all))} />
          </div>
          <figcaption id={`${id}-caption`} className="fig-caption journeys-story__caption" ref={captionRef}>
            {showcase && all.length ? (
              <CaptionMore
                lead={
                  <>
                    {drawn && some ? `${drawn.drawn} of the ${all.length}` : `The ${all.length}`} journeys of the{" "}
                    <em>{name}</em> graph{some ? " (each set's most telling)" : ""}, each drawn along its best
                    answer&apos;s path through releases {first}–{last}.
                  </>
                }
              >
                Answered by this server when it started (<Mono>{endpoint}</Mono>).{" "}
                {touch
                  ? "Tap a journey for its steps, again to open it. "
                  : "Point at a journey for its steps; Enter or a click opens it. "}
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
              </CaptionMore>
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
