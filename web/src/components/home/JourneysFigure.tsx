// The Convert page's first figure: real conversions of one graph, answered by this server once when it started (its
// showcase), drawn together on one release axis over the assembly bands, in the figure grammar (components/figure/).
// Each row is one identifier's journey: its best answer's path as a thin gene bar with Ensembl's history steps marked by
// their glyphs (a journey back in time carries chevrons pointing back). Every mark is local to its row: where the
// identifier is read through an external database its start is an open square, an answer in an external database is a
// filled square, a bridge is the square with a dot on the row itself, dashed to where it lands; no line leaves a row.
//
// The figure fills the room the hero gives it and always names its rows: where the room cannot hold every journey at a
// named pitch, it draws fewer, chosen by one rule (lib/home/useJourneys.ts `chooseJourneys`), and says how many. The
// assembly bands run from their names to the axis; each set of journeys stands in them under its words. The rare
// events are the figure's accents (a split or merge, a step across an assembly change, a crossing into another
// database, a renamed answer in bold); the routine new versions are quiet ticks. Where many journeys take a step of one
// kind at one release, a note under the bands' names says what happened there, on a leader down to the rows, counted
// from the journeys drawn, never shortened and never cut. A row in focus (or under the pointer, or tapped once) is
// isolated and named; pointing at a step shows that step; the arrow keys move between rows and along a row's steps
// with each step's exact values; Enter, Space, a click or a second tap opens the full answer.
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import {
  answerText,
  drawnEvents,
  eventWords,
  isEnsembl,
  releaseEvents,
  type JourneyMark,
  type ReleaseEvent,
} from "../../lib/home/journeyModel";
import {
  bridgesOf,
  answerChanged,
  isRenamed,
  journeyList,
  legendMarks,
  readDatabases,
  sameAnswerGroups,
  type Journey,
  type LegendMark,
  type JourneySet,
} from "../../lib/home/journeys";
import { caseHref, openAt } from "../../lib/home/links";
import { clearEnds } from "../../lib/home/rowMarks";
import { plural, stepsInWords } from "../../lib/home/stepWords";
import {
  chooseJourneys,
  headHeight,
  journeysGeometry,
  LEAST_PLOT,
  LINE,
  NARROW_ROW,
  ROW,
  setHeight,
  setWords,
} from "../../lib/home/useJourneys";
import { pythonFloat } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { href, navigate } from "../../lib/router";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { FIG_TEXT, middleCut, placeLabels, textWidth, wrapWords } from "../figure/labels";
import { assemblyBands, releaseScale } from "../figure/releases";
import { useDismiss, useHover } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

/** The journeys travel once a page session, the first time the figure is drawn. */
let played = false;

/** The glyph of a mark drawn on a row. */
const ROW_GLYPH: Partial<Record<JourneyMark["kind"], Glyph>> = {
  version: "version",
  event: "event",
  loop: "loop",
  handoff: "handoff",
  bridge: "bridge",
};

/** How far apart (px) two marks of a row stand at least: the start and end marks move outward to keep it. */
const CLEAR = 9.5;
/** The lines the release-wide events may take: three on a wide figure (one event a line, or two lines for one whose
 *  words are longer than the room), two on a narrow one (its one event, wrapped). */
const EVENT_LINES = { wide: 3, narrow: 2 } as const;
/** The air (px) between two notes on a line, and around an event's mark and leader. */
const NOTE_GAP = 14;
/** The measured width of a sans text is reckoned a little wider (its halo, rounding of the face's hinting). */
const MEASURE_SLACK = 1.03;

/** What the figure drew, for its legend and its caption. */
export interface JourneysDrawn {
  /** The journeys drawn, of all the showcase holds. */
  drawn: number;
  of: number;
  /** Whether each row's names stand above its track (a narrow figure). */
  narrow: boolean;
  /** The kinds of mark the rows drawn hold (the legend names these). */
  marks: LegendMark[];
}

interface PlacedEvent {
  e: ReleaseEvent;
  line: number;
  lines: string[];
  x: number;
  anchor: "start" | "end";
}

/** The release-wide events' notes on `lines` lines: each in turn (the order given) on the first line where its full
 *  words fit after its mark, else before it, else on two lines (its releases and what happened, then its count), within
 *  the figure and touching no note, mark or leader there. A note's leader runs down from its mark through the lines
 *  under it, which then keep it clear. */
function placeEvents(
  events: readonly ReleaseEvent[],
  words: (e: ReleaseEvent) => { line: string; lines: [string, string] },
  xOf: (e: ReleaseEvent) => number,
  lines: number,
  width: number,
): PlacedEvent[] {
  const taken: [number, number][][] = Array.from({ length: lines }, () => []);
  const free = (line: number, a: number, b: number) =>
    (taken[line] ?? []).every(([p, q]) => b + NOTE_GAP < p || q + NOTE_GAP < a);
  const measure = (text: string) => textWidth(text, FIG_TEXT, "sans") * MEASURE_SLACK + 2;
  const placed: PlacedEvent[] = [];
  for (const e of events) {
    const x = xOf(e);
    const full = words(e);
    const forms: string[][] = [[full.line], [...full.lines]];
    let done = false;
    for (const form of forms) {
      if (done) break;
      const w = Math.max(...form.map(measure));
      for (let line = 0; line + form.length <= lines && !done; line++) {
        for (const anchor of ["start", "end"] as const) {
          const [a, b] = anchor === "start" ? [x + 9, x + 9 + w] : [x - 9 - w, x - 9];
          if (a < 2 || b > width - 2) continue;
          const own = form.map((_, k) => line + k);
          // Its text and its mark on its own lines; its leader through every line under them.
          if (!own.every((l) => free(l, a, b) && free(l, x - 5, x + 5))) continue;
          const below = Array.from({ length: lines - line - form.length }, (_, k) => line + form.length + k);
          if (!below.every((l) => free(l, x - 2, x + 2))) continue;
          for (const l of own) taken[l]?.push([a, b], [x - 5, x + 5]);
          for (const l of below) taken[l]?.push([x - 2, x + 2]);
          placed.push({ e, line, lines: form, x: anchor === "start" ? a : b, anchor });
          done = true;
          break;
        }
      }
    }
  }
  return placed;
}

/** Whether a journey's answer is an Ensembl gene. */
const ensemblAnswer = (j: Journey) =>
  j.model !== null && (j.model.result.final_database === null || isEnsembl(j.model.result.final_database));

/** The databases a journey is read through (not Ensembl's own). */
const readThrough = (j: Journey) => (j.model?.result.from_databases ?? []).filter((d) => !isEnsembl(d));

export function JourneysFigure({
  graph,
  sets: given,
  fit,
  onDrawn,
}: {
  graph: GraphDescription;
  /** Every set of the showcase's journeys; the figure draws those its room holds (null: not yet arrived, and the
   *  figure draws its frame, the bands and the axis, and after a moment says what it waits for). */
  sets: JourneySet[] | null;
  /** The height to fill: a wide figure's rows take the pitch that fills it; fewer journeys are drawn where it cannot
   *  hold them all at a named pitch. */
  fit: number;
  /** Told what the figure drew (its caption says it). */
  onDrawn?: (drawn: JourneysDrawn) => void;
}) {
  const vocabulary = useVocabulary();
  const { ref, width } = useWidth<HTMLDivElement>(800);
  const waiting = given === null;
  const allSets = given ?? [];
  const all = journeyList(allSets);
  const idOf = (j: Journey) => (j.model ? j.model.result.query_id : j.identifier);
  // Each row's two names: the identifier where its line starts, the answer where it ends (a journey back in time
  // starts on the right and ends on the left).
  const namesOf = (j: Journey) => {
    const id = idOf(j);
    const answer = j.model ? answerText(j.model) : null;
    const back = j.model?.backward ?? false;
    return {
      left: back && answer ? `← ${answer}` : id,
      right: back ? id : answer,
      leftIsAnswer: back && answer !== null,
    };
  };
  // The gutters hold the longest names of every journey (so the choice of rows never changes them) and their air.
  const gutter = (w: number) => Math.min(300, Math.max(72, Math.ceil(w + 16)));
  const [leftText, rightText] = all.reduce<[number, number]>(
    ([l, r], j) => {
      const n = namesOf(j);
      const lw = textWidth(n.left, FIG_TEXT, "mono", n.leftIsAnswer ? 600 : 400);
      const rw = n.right === null ? 0 : textWidth(n.right, FIG_TEXT, "mono", n.leftIsAnswer ? 400 : 600);
      return [Math.max(l, lw), Math.max(r, rw)];
    },
    [0, 0],
  );
  const gutters: [number, number] = [gutter(leftText), gutter(rightText) + (sameAnswerGroups(all).length ? 10 : 0)];
  const narrow = width - gutters[0] - gutters[1] < LEAST_PLOT;

  // The words of each set, wrapped to the figure's width where they do not fit one line.
  const setText = (set: JourneySet) =>
    setWords(
      set,
      graph.snapshot_release,
      readDatabases(set).map(databaseLabel),
      set.journeys.length > 0 && set.journeys.every((j) => j.model?.backward ?? false),
    );
  const allLines = allSets.map((set) => wrapWords(setText(set), width - 8, FIG_TEXT, "sans"));

  // The journeys the room holds, chosen by the one rule; then the events among them.
  const eventLines = narrow ? EVENT_LINES.narrow : EVENT_LINES.wide;
  const sets = chooseJourneys(allSets, fit, {
    head: headHeight(eventLines),
    set: (s) => setHeight(allLines[s]?.length ?? 1),
    row: narrow ? NARROW_ROW : ROW,
  });
  const list = journeyList(sets);
  const setLines = sets.map((_, s) => allLines[s] ?? [""]);
  const models = list.flatMap((j) => (j.model ? [j.model] : []));
  const events = drawnEvents(releaseEvents(models, 0.5), narrow ? 1 : EVENT_LINES.wide);

  // Rows of one set next to each other whose answers are the same gene: joined by a bracket after their answers.
  const groups = sameAnswerGroups(list);
  const left = narrow ? 12 : gutters[0];
  const right = narrow ? 12 : gutters[1];
  const releases = graph.releases;
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  const scale = releaseScale(releases, left, width - right);
  const assemblyName = (key: number) => graph.assemblies.find((a) => a.assembly === key)?.name ?? String(key);
  const eventX = (e: ReleaseEvent) => scale.x((e.old + e.new) / 2);
  const notes = placeEvents(events, (e) => eventWords(e, assemblyName), eventX, eventLines, width);
  const usedLines = notes.length ? Math.max(...notes.map((n) => n.line + n.lines.length)) : 0;
  const g = journeysGeometry({
    sets: sets.map((s) => s.journeys.length),
    setLines: setLines.map((l) => l.length),
    events: usedLines,
    narrow,
    gutters,
    fit,
  });

  // Until the journeys arrive, the frame fills the room: the bands from their names to the axis.
  const bottom = waiting ? Math.max(g.bottom, fit - 34) : g.bottom;
  const height = waiting ? bottom + 34 : g.height;
  const axisY = bottom + 4;

  const marks = legendMarks(list).filter((m) => m !== "same" || !narrow);
  const marksKey = marks.join(" ");
  useEffect(() => {
    if (!waiting)
      onDrawn?.({
        drawn: list.length,
        of: all.length,
        narrow,
        marks: marksKey ? (marksKey.split(" ") as LegendMark[]) : [],
      });
  }, [onDrawn, waiting, list.length, all.length, narrow, marksKey]);

  const id = useId();
  // The figure is laid out again once the faces have loaded, so every word is measured in the face that draws it.
  const [, relayout] = useReducer((layouts: number) => layouts + 1, 0);
  useEffect(() => {
    let live = true;
    void (document as { fonts?: FontFaceSet }).fonts?.ready.then(() => {
      if (live) relayout();
    });
    return () => {
      live = false;
    };
  }, []);
  // The journeys travel once, when the page is idle (the travel never competes with the page's first work); until then
  // their lines are held back. Nothing moves under reduced motion.
  const [motion, setMotion] = useState<"none" | "held" | "travel">(() => {
    if (played) return "none";
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)");
    return reduce && reduce.matches ? "none" : "held";
  });
  useEffect(() => {
    played = true;
    if (motion !== "held") return;
    const start = () => {
      setMotion("travel");
    };
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) {
      const handle = idle(start, { timeout: 700 });
      return () => {
        (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(start, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, [motion]);
  const bands = assemblyBands(graph);

  const pointer = useHover<number>();
  const hover = pointer.hover;
  const [focus, setFocus] = useState<{ j: number; k: number } | null>(null);
  const [pointed, setPointed] = useState<{ j: number; k: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [touch, setTouch] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const visible = hover ?? focus?.j ?? null;
  const dismiss = useDismiss(visible !== null);
  const active = visible;
  const shownNote = dismiss.dismissed ? null : visible;
  const step = hover !== null ? (pointed?.j === hover ? pointed : null) : focus && focus.k >= 0 ? focus : null;

  // Each row's marks on the axis: the steps where their releases put them, the start and end moved off them. A journey
  // read and answered at one release is the crossing it is: its read mark stands a step before its answer.
  const rowMarks = list.map((entry) => {
    const m = entry.model;
    if (!m) return null;
    const xs = m.marks.filter((mk) => ROW_GLYPH[mk.kind]).map((mk) => scale.x(mk.at));
    const from = scale.x(m.result.from_release ?? m.lo);
    const to = scale.x(m.result.to_release);
    const ends = Math.abs(to - from) < CLEAR ? { start: to - (m.backward ? -CLEAR : CLEAR), end: to } : null;
    const placed = ends ?? clearEnds(from, to, xs, CLEAR);
    return {
      ...placed,
      crossing: ends !== null,
      lo: Math.min(placed.start, placed.end, scale.x(m.lo)),
      hi: Math.max(placed.start, placed.end, scale.x(m.hi)),
    };
  });

  const openAnswer = (j: number) => {
    const journey = list[j];
    if (!journey) return;
    const set = sets[journey.set];
    navigate(
      caseHref({
        organism: graph.organism,
        identifier: journey.identifier,
        ...(set?.from !== null && set?.from !== undefined ? { from: set.from } : {}),
        ...(set?.to !== null && set?.to !== undefined ? { to: set.to } : {}),
        ...(set?.db !== null && set?.db !== undefined ? { db: set.db } : {}),
      }),
    );
    window.scrollTo({ top: 0 });
  };

  const onKeyDown = (j: number) => (event: KeyboardEvent<SVGGElement>) => {
    const marks = list[j]?.model?.marks.length ?? 0;
    const k = focus?.j === j ? focus.k : -1;
    const moveRow = (to: number) => {
      const next = Math.max(0, Math.min(list.length - 1, to));
      setCurrent(next);
      svgRef.current?.querySelector<SVGGElement>(`[data-journey="${next}"]`)?.focus();
    };
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveRow(j + 1);
      },
      ArrowUp: () => {
        moveRow(j - 1);
      },
      ArrowRight: () => {
        setFocus({ j, k: Math.min(marks - 1, k + 1) });
      },
      ArrowLeft: () => {
        setFocus({ j, k: Math.max(-1, k - 1) });
      },
      Home: () => {
        moveRow(0);
      },
      End: () => {
        moveRow(list.length - 1);
      },
      Enter: () => {
        openAnswer(j);
      },
      " ": () => {
        openAnswer(j);
      },
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      pointer.drop();
      setPointed(null);
      dismiss.reset();
      action();
    }
  };

  /** The step of row j nearest to the pointer, within reach of its glyph. */
  const stepAt = (j: number, x: number): number | null => {
    const m = list[j]?.model;
    if (!m) return null;
    let best: number | null = null;
    let distance = 9;
    m.marks.forEach((mk, k) => {
      if (!ROW_GLYPH[mk.kind] && mk.kind !== "final") return;
      const d = Math.abs(scale.x(mk.at) - x);
      if (d < distance) {
        distance = d;
        best = k;
      }
    });
    return best;
  };

  const noteFor = (j: number): ReactNode => {
    const journey = list[j];
    if (!journey) return null;
    const m = journey.model;
    if (!m) {
      return (
        <>
          <p className="fig-note__title mono">{journey.identifier}</p>
          <p className="fig-note__quiet">
            {journey.error
              ? `Not answered when the server started: ${journey.error.message}`
              : "This conversion has no best answer to draw; open it for what the server says."}
          </p>
        </>
      );
    }
    const r = m.result;
    if (step?.j === j) {
      const mark = m.marks[step.k];
      if (!mark) return null;
      const s = mark.step;
      const meaning = vocabulary.stepReasons.get(s.reason) ?? null;
      const asm = (key: number | null) => (key === null ? "—" : `${assemblyName(key)} (${key})`);
      return (
        <>
          <p className="fig-note__title">
            <span className="mono">{r.query_id}</span> · step {mark.number} of {m.marks.length} · {spaced(s.reason)}
          </p>
          {meaning ? <p className="fig-note__quiet">{prose(meaning)}</p> : null}
          <p className="mono">
            {s.source ?? "—"} → {s.target}
          </p>
          <p>
            {s.old_release !== null && s.new_release !== null ? (
              <>
                Releases <span className="mono">{`${s.old_release} → ${s.new_release}`}</span>
                {" · "}
                {s.weight === null ? "no score" : <span className="mono">score {pythonFloat(s.weight)}</span>}
              </>
            ) : s.release !== null ? (
              <>
                Release <span className="mono">{s.release}</span>
              </>
            ) : null}
          </p>
          {mark.kind === "handoff" ? (
            <p>
              Assembly <span className="mono">{asm(s.old_assembly)}</span> →{" "}
              <span className="mono">{asm(s.assembly)}</span>
            </p>
          ) : null}
          {s.places ? (
            <p className="fig-note__quiet">{prose(vocabulary.placeRelations.get(s.places) ?? spaced(s.places))}</p>
          ) : null}
          {s.databases.length ? <p className="fig-note__quiet">{s.databases.map(databaseLabel).join(", ")}</p> : null}
        </>
      );
    }
    const handoffs = m.marks.filter((mk) => mk.kind === "handoff").length;
    const targets = [...new Set(m.best.map((c) => c.target))];
    const bridges = bridgesOf(journey);
    const read = readThrough(journey);
    return (
      <>
        <p className="fig-note__title">
          <span className="mono">{r.query_id}</span> → <span className="mono">{targets.join(", ")}</span>
        </p>
        <p>
          Read at release <span className="mono">{r.from_release}</span>
          {read.length ? ` in ${read.map(databaseLabel).join(", ")}` : ""}; answered at release{" "}
          <span className="mono">{r.to_release}</span>{" "}
          {ensemblAnswer(journey) ? "as an Ensembl gene" : `in ${databaseLabel(r.final_database ?? "")}`}
          {r.status === "tie" ? ` (a tie of ${targets.length})` : ""}
          {m.backward ? "; walked back in time" : ""}
        </p>
        <p className="fig-note__quiet">
          {stepsInWords(m.marks.map((mk) => mk.step))}
          {handoffs ? `; ${plural(handoffs, "step")} across an assembly change` : ""}
          {bridges.length
            ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), idtrack's inference`
            : ""}
        </p>
        <p className="fig-note__quiet">
          {touch
            ? "Tap again: the full answer"
            : "Point at a step for its values · arrow keys: rows and steps · Enter: the full answer"}
        </p>
      </>
    );
  };

  const noteX = (() => {
    if (active === null) return 0;
    const m = list[active]?.model;
    if (step && m) return scale.x(m.marks[step.k]?.at ?? m.lo);
    return m ? scale.x((m.lo + m.hi) / 2) : width / 2;
  })();

  // The names of the rows on a narrow figure: on a line of paper above each track, the left name at the start of the
  // axis, the right name at its end; the answer cut in its middle (an identifier) where the two would touch.
  const narrowNames = narrow
    ? placeLabels(
        list.flatMap((j, k) => {
          const n = namesOf(j);
          const cuts = (text: string) =>
            [text, ...[16, 13, 10, 8].map((c) => middleCut(text, c) ?? "")].filter(Boolean);
          return [
            {
              key: `l${k}`,
              anchor: scale.x0,
              forms: n.leftIsAnswer ? cuts(n.left) : [n.left],
              align: "start" as const,
              rows: [`r${k}`],
              weight: n.leftIsAnswer ? 600 : 400,
            },
            ...(n.right
              ? [
                  {
                    key: `r${k}`,
                    anchor: scale.x1,
                    forms: cuts(n.right),
                    align: "end" as const,
                    rows: [`r${k}`],
                    weight: n.leftIsAnswer ? 400 : 600,
                  },
                ]
              : []),
          ];
        }),
        { bounds: [0, width], gap: 10 },
      )
    : null;

  const labelWidth = (j: Journey) => {
    const n = namesOf(j);
    return n.right === null ? 0 : textWidth(n.right, FIG_TEXT, "mono", n.leftIsAnswer ? 400 : 600);
  };

  const takes = (e: ReleaseEvent) => (j: Journey) =>
    j.model?.marks.some(
      (mk) =>
        mk.kind === e.kind &&
        Math.min(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.old &&
        Math.max(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.new &&
        (e.reason === null || mk.step.reason === e.reason),
    ) ?? false;
  const toHistory = href(`/organisms/${graph.organism}`);

  return (
    <div
      className={`journeys__plot fig${motion === "travel" ? " jr-travel" : motion === "held" ? " jr-held" : ""}${narrow ? " journeys__plot--narrow" : ""}`}
      ref={ref}
      style={{ height }}
    >
      {waiting ? <Waiting /> : null}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={`journeys__svg${active !== null ? " is-isolating" : ""}`}
        role={waiting ? "img" : "group"}
        aria-label={
          waiting
            ? `The releases ${first} to ${last} of the ${organismName(graph.organism)} graph over its assemblies; the journeys are on their way.`
            : `${list.length} of the ${all.length} journeys of the ${organismName(graph.organism)} graph through the releases ${first} to ${last}. Arrow keys move between journeys and along their steps; Enter opens a journey's full answer.`
        }
        onPointerLeave={() => {
          pointer.leave();
          setPointed(null);
        }}
      >
        {/* The assembly bands, one column each from their names down to the axis */}
        <Bands bands={bands} scale={scale} top={0} bottom={bottom} labelY={13} outerY={27} />
        <ReleaseTicks scale={scale} y={axisY} releases={releases} bounds={[0, width]} />
        {/* Release-wide events: the mark beside its words, a leader down to the rows, a faint guide inside each set whose
            journeys take it */}
        <g className="jr-events" aria-hidden="true">
          {notes.map(({ e, line }) => {
            const x = eventX(e);
            const y = g.eventY(line) - 4;
            const takenBy = sets.map((set) => set.journeys.some(takes(e)));
            return (
              <g key={`${e.kind}-${e.old}-${e.reason ?? ""}`} className={`jr-event jr-event--${e.kind}`}>
                <line x1={x} x2={x} y1={y + 6} y2={g.head + 4} className="jr-event__leader" />
                {sets.map((_, s) =>
                  takenBy[s] ? (
                    <line
                      key={s}
                      x1={x}
                      x2={x}
                      y1={g.blockTop(s) + 1}
                      y2={g.blockBottom(s) - 1}
                      className="jr-event__guide"
                    />
                  ) : null,
                )}
                <StepGlyph glyph={e.kind} x={x} y={y + (e.kind === "loop" ? 4 : 0)} size="thin" />
              </g>
            );
          })}
        </g>
        {list.map((entry, j) => {
          const y = g.lineY(j);
          const m = entry.model;
          const ends = rowMarks[j];
          const isActive = active === j;
          const ringed = focus?.j === j && focus.k < 0 && hover === null;
          const readExternal = readThrough(entry).length > 0;
          const asked = m?.result.final_database ?? null;
          const answeredExternal =
            m !== null && asked !== null && !isEnsembl(asked) && m.marks.some((mk) => mk.kind === "final");
          const bridgeMarks = m?.marks.filter((mk) => mk.kind === "bridge") ?? [];
          const bridges = bridgesOf(entry);
          return (
            <g
              key={`${entry.set}-${entry.identifier}`}
              data-journey={j}
              style={{ "--j": j } as CSSProperties}
              role="link"
              tabIndex={j === current ? 0 : -1}
              aria-label={
                m
                  ? `${m.result.query_id}, read at release ${m.result.from_release}, to ${answerText(m)} at release ${m.result.to_release}: ${plural(m.marks.length, "step")}${
                      bridges.length
                        ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), idtrack's inference`
                        : ""
                    }`
                  : `${entry.identifier}: ${entry.error ? `not answered (${entry.error.message})` : "no best answer to draw"}`
              }
              className={`jr-row fig-target${m?.backward ? " jr-row--back" : ""}${isActive ? " is-active" : ""}`}
              onFocus={() => {
                setCurrent(j);
                setFocus((f) => (f?.j === j ? f : { j, k: -1 }));
                dismiss.reset();
              }}
              onBlur={() => {
                setFocus((f) => (f?.j === j ? null : f));
              }}
              onPointerDown={(event: PointerEvent) => {
                setTouch(event.pointerType !== "mouse");
              }}
              onPointerEnter={(event: PointerEvent) => {
                if (event.pointerType === "mouse") {
                  pointer.enter(j);
                  dismiss.reset();
                }
              }}
              onPointerMove={(event: PointerEvent) => {
                if (event.pointerType !== "mouse") return;
                const box = svgRef.current?.getBoundingClientRect();
                if (!box) return;
                const k = stepAt(j, event.clientX - box.left);
                setPointed((p) => (k === null ? (p === null ? p : null) : p?.j === j && p.k === k ? p : { j, k }));
              }}
              onPointerLeave={(event: PointerEvent) => {
                if (event.pointerType === "mouse") pointer.leave(j);
              }}
              onClick={() => {
                // A touch shows the row first; a second touch opens it.
                if (touch && hover !== j) {
                  pointer.enter(j);
                  dismiss.reset();
                  return;
                }
                openAnswer(j);
              }}
              onKeyDown={onKeyDown(j)}
            >
              <rect x={0} y={g.rowTop(j)} width={width} height={g.row} className="fig-hit" />
              {m && ends ? (
                <g className="jr-path">
                  {ends.crossing ? (
                    <line x1={ends.lo} x2={ends.hi} y1={y} y2={y} className="fig-cross jr-crossing" />
                  ) : (
                    <GeneBar x0={ends.lo} x1={ends.hi} y={y} size="thin" className="jr-line" />
                  )}
                  {m.backward ? <Chevrons x0={ends.lo} x1={ends.hi} y={y} /> : null}
                  {bridgeMarks.length >= 2 ? (
                    <line
                      x1={scale.x(bridgeMarks[0]?.at ?? m.lo)}
                      x2={scale.x(bridgeMarks[bridgeMarks.length - 1]?.at ?? m.hi)}
                      y1={y}
                      y2={y}
                      className="fig-cross jr-bridge"
                    />
                  ) : null}
                  <StepGlyph glyph={readExternal ? "read" : "form"} x={ends.start} y={y} size="thin" />
                  {m.marks.map((mk, k) => {
                    const glyph = ROW_GLYPH[mk.kind];
                    // A bridge's two steps share its id: one square marks where it passes.
                    if (!glyph || (mk.kind === "bridge" && mk.step.kind !== "bridge_near")) return null;
                    return (
                      <StepGlyph
                        key={k}
                        glyph={glyph}
                        x={scale.x(mk.at)}
                        y={y}
                        size="thin"
                        event={glyph === "handoff" && isEvent(mk.step)}
                      />
                    );
                  })}
                  {answeredExternal ? (
                    <StepGlyph glyph="final" x={ends.end} y={y} size="thin" />
                  ) : (
                    <rect x={ends.end - 3} y={y - 3} width={6} height={6} className="jr-end" />
                  )}
                  {step?.j === j ? (
                    <circle cx={scale.x(m.marks[step.k]?.at ?? m.lo)} cy={y} r={8} className="fig-focus" />
                  ) : null}
                </g>
              ) : (
                <line x1={scale.x0} x2={scale.x1} y1={y} y2={y} className="jr-wait" />
              )}
              {ringed ? (
                <rect x={1} y={g.rowTop(j) + 1} width={width - 2} height={g.row - 2} rx={4} className="fig-focus" />
              ) : null}
            </g>
          );
        })}
        {/* Every text of the figure stands on a halo of the paper: no band edge, guide or line crosses a set's words, an
            event's words or a row's names. The rows' names stand apart from the rows, whose accessible names say them. */}
        <g className="jr-labels">
          {sets.map((_, s) => (
            <text
              key={s}
              x={2}
              y={g.setBaseline(s)}
              className="fig-text fig-text--sans jr-sets__name"
              aria-hidden="true"
            >
              {(setLines[s] ?? []).map((line, k) => (
                <tspan key={k} x={2} dy={k ? LINE : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          ))}
          {notes.map((n) => {
            const words = n.lines.join(" ");
            // Each release-wide event leads to the graph's own page, where Ensembl's id history of every gene is drawn
            // release by release.
            return (
              <a
                key={`${n.e.kind}-${n.e.old}-${n.e.reason ?? ""}`}
                href={toHistory}
                className="jr-event__link"
                aria-label={`${words}: Ensembl's id history of the ${organismName(graph.organism)} graph, release by release`}
                onClick={(event) => {
                  event.preventDefault();
                  openAt(toHistory, "history");
                }}
              >
                <text
                  x={n.x}
                  y={g.eventY(n.line)}
                  textAnchor={n.anchor}
                  className="fig-text fig-text--sans jr-event__name"
                >
                  {n.lines.map((line, k) => (
                    <tspan key={k} x={n.x} dy={k ? 16 : 0} className={k ? "jr-event__count" : undefined}>
                      {k < n.lines.length - 1 ? `${line} ` : line}
                    </tspan>
                  ))}
                </text>
              </a>
            );
          })}
        </g>
        <g className="jr-names" aria-hidden="true">
          {list.map((entry, j) => {
            const y = g.lineY(j);
            const n = namesOf(entry);
            const answerCls = `jr-answer ${answerClass(entry)}`;
            if (narrow) {
              const l = narrowNames?.get(`l${j}`);
              const r = narrowNames?.get(`r${j}`);
              const yy = g.nameY(j);
              return (
                <g key={`${entry.set}-${entry.identifier}`} className={active === j ? "is-active" : ""}>
                  {l ? (
                    <text x={l.x} y={yy} className={`fig-text ${n.leftIsAnswer ? answerCls : "jr-id"}`}>
                      {l.text}
                    </text>
                  ) : null}
                  {r ? (
                    <text
                      x={r.x}
                      y={yy}
                      textAnchor="end"
                      className={`fig-text ${n.leftIsAnswer ? "jr-id" : answerCls}`}
                    >
                      {r.text}
                    </text>
                  ) : null}
                </g>
              );
            }
            return (
              <g key={`${entry.set}-${entry.identifier}`} className={active === j ? "is-active" : ""}>
                <text
                  x={scale.x0 - 10}
                  y={y + 3.8}
                  textAnchor="end"
                  className={`fig-text ${n.leftIsAnswer ? answerCls : "jr-id"}`}
                >
                  {n.left}
                </text>
                {n.right === null ? null : (
                  <text x={scale.x1 + 12} y={y + 3.8} className={`fig-text ${n.leftIsAnswer ? "jr-id" : answerCls}`}>
                    {n.right}
                  </text>
                )}
              </g>
            );
          })}
          {narrow
            ? null
            : groups.map(([a, b]) => {
                const x = scale.x1 + 12 + Math.max(...list.slice(a, b + 1).map(labelWidth)) + 6;
                const y0 = g.lineY(a);
                const y1 = g.lineY(b);
                return (
                  <path key={`${a}-${b}`} d={`M${x},${y0}h3V${y1}h-3`} className="jr-same" data-rows={`${a}-${b}`} />
                );
              })}
        </g>
      </svg>
      {shownNote !== null ? (
        <FigureNote x={noteX} y={g.lineY(shownNote) + 14} width={width} pointer={pointer.note}>
          {noteFor(shownNote)}
        </FigureNote>
      ) : null}
      <p className="visually-hidden" aria-live="polite" id={id}>
        {focus && focus.k >= 0 && list[focus.j]?.model
          ? (() => {
              const mk = list[focus.j]?.model?.marks[focus.k];
              return mk
                ? `Step ${mk.number}: ${spaced(mk.step.reason)}, ${mk.step.source ?? ""} to ${mk.step.target}${
                    mk.step.old_release !== null
                      ? `, releases ${mk.step.old_release} to ${mk.step.new_release ?? ""}`
                      : mk.step.release !== null
                        ? `, release ${mk.step.release}`
                        : ""
                  }${mk.step.weight !== null ? `, score ${pythonFloat(mk.step.weight)}` : ""}`
                : "";
            })()
          : ""}
      </p>
    </div>
  );
}

/** While the journeys are on their way: after a moment, what the figure waits for and for how long. */
function Waiting() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  if (seconds < 1) return null;
  return (
    <p className="journeys__waiting" role="status">
      Asking the server for the journeys… <span className="mono">{seconds}</span> s
    </p>
  );
}

/** A journey's answer: strong where it names the gene otherwise than the identifier read (a renamed gene, another
 *  id), quiet where it is the identifier itself (a gene whose symbol did not change). */
function answerClass(j: Journey): string {
  if (!j.model || !j.result) return "";
  if (isRenamed(j)) return "fig-text--strong jr-answer--renamed";
  return answerChanged(j) ? "fig-text--strong" : "jr-answer--same";
}

/** Chevrons along a journey that travels back in time, pointing the way it goes. */
function Chevrons({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  const n = Math.max(1, Math.floor((x1 - x0) / 64));
  const step = (x1 - x0) / (n + 1);
  return (
    <g className="jr-chevrons" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + step * (i + 1);
        return <path key={i} d={`M${x + 3},${y - 3.5}L${x - 0.5},${y}L${x + 3},${y + 3.5}`} />;
      })}
    </g>
  );
}
