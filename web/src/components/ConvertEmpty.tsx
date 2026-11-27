// The Convert page before a conversion: one screen, the hero. On one side what idtrack does, in a line and a sentence,
// the form (the identifier, examples from the graph's showcase, the organism, the releases and the database folded in
// one line that says them, Convert) and the ways on; on the other the figure: real identifiers of the graph in view,
// each drawn as its journey through the releases over the assembly bands, travelling once as the page appears, as this
// server answered them when it started (`GET /organisms/{organism}/showcase`: the page converts nothing itself). The
// head paints first, before the server's organisms are known; the figure's room is held and its frame (the bands, the
// axis) drawn before its journeys arrive, so nothing moves. The longer stories of the showcase (the cases, one journey
// up close, the server's facts) are on Explore (components/explore/Stories.tsx).
import { Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { GraphDescription } from "../api/types";
import { databaseLabel } from "../lib/databases";
import { isEnsembl } from "../lib/home/journeyModel";
import { bridgesOf, journeyList, journeySets, legendMarks, type Journey, type LegendMark } from "../lib/home/journeys";
import { releasesOf } from "../lib/home/links";
import { plural } from "../lib/home/stepWords";
import { lazyPart } from "../lib/lazyPart";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href } from "../lib/router";
import { useShowcase } from "../lib/showcase";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErrorPanel } from "./ErrorPanel";
import { FigureLegend, type LegendEntry } from "./figure/Legend";
import { CaptionMore } from "./home/CaptionMore";
import type { JourneysDrawn } from "./home/JourneysFigure";
import { Link, Mono } from "./ui";
import "../styles/home.css";

// The drawing is its own chunk, asked for at once (beside the showcase), so that its frame stands before the journeys
// arrive; the head and the form paint without it.
const JourneysFigure = lazyPart(() => import("./home/JourneysFigure").then((m) => ({ default: m.JourneysFigure })));
JourneysFigure.preload();
// The measured line reads the benchmarks' results: its own chunk, asked for once the page is idle (its room is held).
const HeroMeasure = lazyPart(() => import("./home/HeroMeasure").then((m) => ({ default: m.HeroMeasure })));

export function ConvertEmpty({ description, form }: { description: GraphDescription | null; form: ReactNode }) {
  const id = useId();
  const { organisms } = useOrganisms();
  const releases = releasesOf(organisms);
  const idle = useIdle();
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
          <span className="hero__line">Follow a gene id</span>{" "}
          <span className="hero__line">through Ensembl&apos;s</span> <span className="hero__line">history</span>
        </h1>
        <p className="hero__lede">
          Give a gene id or symbol of any release: idtrack follows it through Ensembl&apos;s records to the release and
          database you ask, within one organism, with the evidence for every step and its own inferences marked.
        </p>
        <div className="hero__measure-room">
          {description && idle ? (
            <ErrorBoundary part="The measured line" resetKey={description.organism}>
              <Suspense fallback={null}>
                <HeroMeasure organism={description.organism} digest={description.content_digest ?? null} />
              </Suspense>
            </ErrorBoundary>
          ) : null}
        </div>
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
        <div className="hero__figure" aria-hidden="true" />
      )}
    </section>
  );
}

/** Whether the page has been idle once since this view appeared (what is not needed for the first paint waits for it). */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as {
      requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const done = () => {
      setIdle(true);
    };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(done, { timeout: 1500 });
      return () => {
        w.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(done, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  return idle;
}

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
      ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), idtrack's inference`
      : ""
  }`;
}

/** The hero's figure: the showcase's journeys of the graph in view, filling the room the hero gives it. */
function HeroFigure({ graph }: { graph: GraphDescription }) {
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
      <figure className="hero__figure" aria-describedby={`${id}-caption`}>
        <div className="hero__frame" ref={roomRef}>
          <div className="hero__plot">
            {answer.state === "failed" ? (
              <div className="hero__failed" style={fit !== null ? { minHeight: fit } : undefined}>
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
          <div className="hero__legend" hidden={answer.state === "failed" || (showcase !== null && !all.length)}>
            <div className="hero__legend-room" ref={legendRef} aria-hidden="true">
              <FigureLegend entries={legendEntries(legendMarks(all))} />
            </div>
            <FigureLegend entries={legendEntries(drawn?.marks ?? legendMarks(all))} />
          </div>
          <figcaption id={`${id}-caption`} className="fig-caption hero__caption" ref={captionRef}>
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
                  className="hero__list-toggle"
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
        <ol id={listId} className={`hero__list${listed ? "" : " visually-hidden"}`} aria-label="The journeys in words">
          {all.map((j) => (
            <li key={`${j.set}-${j.identifier}`}>{journeyWords(j)}</li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
