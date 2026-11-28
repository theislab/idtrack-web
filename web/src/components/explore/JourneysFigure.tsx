// The first figure of Explore's stories: real conversions of one graph, answered by this server once when it started (its
// showcase), drawn together on one release axis over the assembly bands, in the figure grammar (components/figure/).
// Each row is one identifier's journey: its best answer's path as a thin line, one segment for each stable gene id it
// passes through (the tone alternates where the id changes), with Ensembl's history steps marked by their glyphs and,
// at a split or a merge, a stub for each other id the event's earlier id passed to (above, toward later releases) or
// its later id received (below, from earlier ones); a journey back in time carries chevrons pointing back. Every mark
// is local to its row: where the identifier is read through an external database its start is an open square, an
// answer in an external database is a filled square, a bridge is the square with a dot on the row itself, dashed to
// where it lands; no line leaves a row.
//
// At rest the figure draws its lines and marks only: a row's ids (the identifier, each id it passes through, the
// answer) are written on the row in focus, under the pointer or tapped once, and in its note; the figure's text
// alternative and the list in words name every one. The rows are the most convoluted journeys of their sets, the sets
// in the order of their most convoluted journey (lib/home/useJourneys.ts `rankedSets`, `chooseJourneys`): where the
// room cannot hold every journey, fewer are drawn, three at most on a phone, and the caption says how many. Where many
// journeys take a step of one kind at one release, a mark over the rows says so on pointing or focus, counted from the
// journeys drawn, and leads to that release of the graph's history. The arrow keys move between rows and along a row's
// steps with each step's exact values; Enter, Space, a click or a second tap opens the full answer.
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
  type JourneyModel,
  type ReleaseEvent,
} from "../../lib/home/journeyModel";
import {
  bridgesOf,
  answerChanged,
  isRenamed,
  journeyList,
  legendMarks,
  sameAnswerGroups,
  type Journey,
  type LegendMark,
  readDatabases,
  type JourneySet,
} from "../../lib/home/journeys";
import { caseHref } from "../../lib/home/links";
import { clearEnds } from "../../lib/home/rowMarks";
import { plural, stepsInWords } from "../../lib/home/stepWords";
import { chooseJourneys, headHeight, journeysGeometry, ROW, setHeight, setWords } from "../../lib/home/useJourneys";
import { pythonFloat } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { stableId } from "../../lib/path/steps";
import { href, navigate } from "../../lib/router";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { FIG_TEXT, middleCut, placeLabels, wrapWords } from "../figure/labels";
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
/** The figure's side margins: room for a start or end mark moved outward, and the bracket of rows of one answer. */
const SIDE = 14;
/** Below this width the figure draws three journeys at most (a phone). */
const PHONE = 640;
/** The rows a phone draws. */
const PHONE_ROWS = 3;
/** The stubs of a split or merge drawn at most; the note gives the count. */
const STUBS = 4;

/** What the figure drew, for its legend and its caption. */
export interface JourneysDrawn {
  /** The journeys drawn, of all the showcase holds (after the filter). */
  drawn: number;
  of: number;
  /** Whether the figure draws as on a phone (three rows at most). */
  narrow: boolean;
  /** The kinds of mark the rows drawn hold (the key names these). */
  marks: LegendMark[];
}

/** One stretch of a row: the releases it runs over (in px) and the stable id the path holds there. */
interface Segment {
  x0: number;
  x1: number;
  id: string;
}

/** A row's segments, one per stable gene id in the walk's order: the line from its start to its end, cut where a step
 *  enters a gene of another stable id (a history step between two ids, the far side of a bridge). */
function segmentsOf(m: JourneyModel, start: number, end: number, xOf: (release: number) => number): Segment[] {
  const genes = new Set((m.result.path?.nodes ?? []).filter((n) => n.kind === "ensembl_gene").map((n) => n.id));
  const cuts: { x: number; id: string }[] = [];
  let current: string | null = null;
  for (const mk of m.marks) {
    const target = mk.step.target;
    if (!genes.has(target)) continue;
    const id = stableId(target);
    if (current === null) current = id;
    else if (id !== current) {
      cuts.push({ x: xOf(mk.at), id });
      current = id;
    }
  }
  const first = m.marks.map((mk) => mk.step.target).find((t) => genes.has(t)) ?? m.best[0]?.gene ?? m.result.query_id;
  const out: Segment[] = [];
  let from = start;
  let id = stableId(first);
  for (const c of cuts) {
    out.push({ x0: Math.min(from, c.x), x1: Math.max(from, c.x), id });
    from = c.x;
    id = c.id;
  }
  out.push({ x0: Math.min(from, end), x1: Math.max(from, end), id });
  return out;
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
  all: drawAll = false,
  onDrawn,
}: {
  graph: GraphDescription;
  /** Every set of the showcase's journeys, ranked (`rankedSets`); the figure draws those its room holds (null: not yet
   *  arrived, and the figure draws its frame, the bands and the axis, and after a moment says what it waits for). */
  sets: JourneySet[] | null;
  /** The height to fill: the rows take the pitch that fills it; fewer journeys are drawn where it cannot hold them
   *  all at a named pitch. */
  fit: number;
  /** Draw every journey given, whatever the room (the figure then grows). */
  all?: boolean;
  /** Told what the figure drew (its caption says it). */
  onDrawn?: (drawn: JourneysDrawn) => void;
}) {
  const vocabulary = useVocabulary();
  const { ref, width } = useWidth<HTMLDivElement>(800);
  const waiting = given === null;
  const allSets = given ?? [];
  const every = journeyList(allSets);
  const idOf = (j: Journey) => (j.model ? j.model.result.query_id : j.identifier);
  const narrow = width < PHONE;

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
  const sets = chooseJourneys(
    allSets,
    drawAll ? Number.MAX_SAFE_INTEGER : fit,
    { head: headHeight(1), set: (s) => setHeight(allLines[s]?.length ?? 1), row: ROW },
    narrow && !drawAll ? PHONE_ROWS : Infinity,
  );
  const list = journeyList(sets);
  const setLines = sets.map((_, s) => allLines[s] ?? [""]);
  const models = list.flatMap((j) => (j.model ? [j.model] : []));
  const events = drawnEvents(releaseEvents(models, 0.5), narrow ? 1 : 3);

  // Rows of one set next to each other whose answers are the same gene: joined by a bracket after their lines.
  const groups = sameAnswerGroups(list);
  const releases = graph.releases;
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  const scale = releaseScale(releases, SIDE, width - SIDE - (groups.length ? 8 : 0));
  const assemblyName = (key: number) => graph.assemblies.find((a) => a.assembly === key)?.name ?? String(key);
  const eventX = (e: ReleaseEvent) => scale.x((e.old + e.new) / 2);
  const g = journeysGeometry({
    sets: sets.map((s) => s.journeys.length),
    setLines: setLines.map((l) => l.length),
    events: events.length ? 1 : 0,
    fit: drawAll ? 0 : fit,
  });

  // Until the journeys arrive, the frame fills the room: the bands from their names to the axis.
  const bottom = waiting ? Math.max(g.bottom, fit - 34) : g.bottom;
  const height = waiting ? bottom + 34 : g.height;
  const axisY = bottom + 4;

  const marks = legendMarks(list);
  const marksKey = marks.join(" ");
  useEffect(() => {
    if (!waiting)
      onDrawn?.({
        drawn: list.length,
        of: every.length,
        narrow,
        marks: marksKey ? (marksKey.split(" ") as LegendMark[]) : [],
      });
  }, [onDrawn, waiting, list.length, every.length, narrow, marksKey]);

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
  // The release-wide event lit: under the pointer (its column) or in focus (its mark, a link).
  const [litEvent, setLitEvent] = useState<number | null>(null);
  const [focusedEvent, setFocusedEvent] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const visible = hover ?? focus?.j ?? null;
  const dismiss = useDismiss(visible !== null);
  const active = visible;
  const shownNote = dismiss.dismissed ? null : visible;
  const step = hover !== null ? (pointed?.j === hover ? pointed : null) : focus && focus.k >= 0 ? focus : null;
  const eventShown = focusedEvent ?? litEvent;

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
      segments: ends !== null ? [] : segmentsOf(m, placed.start, placed.end, (r) => scale.x(r)),
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
    const count = list[j]?.model?.marks.length ?? 0;
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
        setFocus({ j, k: Math.min(count - 1, k + 1) });
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
          {s.splits || s.merges ? (
            <p className="fig-note__quiet">
              {s.splits ? `${plural(s.splits, "other id")} the earlier id passed to` : ""}
              {s.splits && s.merges ? "; " : ""}
              {s.merges ? `${plural(s.merges, "other id")} the later id received` : ""}
            </p>
          ) : null}
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
    const ids = rowMarks[j]?.segments.map((sg) => sg.id) ?? [];
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
        {ids.length > 1 ? (
          <p className="fig-note__quiet">
            Through {plural(ids.length, "stable id")}: <span className="mono">{ids.join(" → ")}</span>
          </p>
        ) : null}
        <p className="fig-note__quiet">
          {stepsInWords(m.marks.map((mk) => mk.step))}
          {handoffs ? `; ${plural(handoffs, "step")} across an assembly change` : ""}
          {bridges.length
            ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), IDTrack's inference`
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

  // The ids of the row in focus (or pointed at): the identifier at its start, each id it passes through over its
  // segment, the answer at its end, on a line of paper above the row (and a second where they would touch), cut in
  // their middle where they have no room.
  const activeLabels = (() => {
    if (active === null) return null;
    const entry = list[active];
    const m = entry?.model;
    const ends = rowMarks[active];
    if (!entry || !m || !ends) return null;
    const cuts = (text: string) => [text, ...[16, 13, 10, 8].map((c) => middleCut(text, c) ?? "")].filter(Boolean);
    const answer = answerText(m);
    const segments = ends.segments;
    // Each id the row passes through, but the identifier's own and the answer's, which its ends name.
    const between = segments.filter(
      (sg, i) =>
        !(i === 0 && sg.id === stableId(idOf(entry))) &&
        !(i === segments.length - 1 && [...new Set(m.best.map((c) => stableId(c.target)))].includes(sg.id)),
    );
    const requests = [
      {
        key: "start",
        anchor: ends.start,
        forms: [idOf(entry)],
        align: m.backward ? ("end" as const) : ("start" as const),
        rows: ["a", "b"],
        weight: 500,
      },
      {
        key: "end",
        anchor: ends.end,
        forms: cuts(answer),
        align: m.backward ? ("start" as const) : ("end" as const),
        rows: ["a", "b"],
        weight: 600,
      },
      ...between.map((sg, i) => ({
        key: `s${i}`,
        anchor: (sg.x0 + sg.x1) / 2,
        forms: cuts(sg.id),
        align: "center" as const,
        rows: ["a", "b"],
        weight: 400,
      })),
    ];
    const placed = placeLabels(requests, { bounds: [2, width - 2], gap: 8 });
    return { placed, y: g.lineY(active), renamed: isRenamed(entry), changed: answerChanged(entry) };
  })();

  const takes = (e: ReleaseEvent) => (j: Journey) =>
    j.model?.marks.some(
      (mk) =>
        mk.kind === e.kind &&
        Math.min(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.old &&
        Math.max(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.new &&
        (e.reason === null || mk.step.reason === e.reason),
    ) ?? false;
  const eventLineY = g.eventY(0) - 4;
  const shownEvent = eventShown === null ? null : (events[eventShown] ?? null);
  return (
    <div
      className={`journeys__plot fig${motion === "travel" ? " jr-travel" : motion === "held" ? " jr-held" : ""}`}
      ref={ref}
      style={{ height }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || !events.length) return;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const x = event.clientX - box.left;
        const near = events.findIndex((e) => Math.abs(eventX(e) - x) <= 6);
        setLitEvent((l) => (near < 0 ? (l === null ? l : null) : near));
      }}
      onPointerLeave={() => {
        setLitEvent(null);
      }}
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
            : `${list.length} of the ${every.length} journeys of the ${organismName(graph.organism)} graph through the releases ${first} to ${last}. Arrow keys move between journeys and along their steps; Enter opens a journey's full answer.`
        }
        onPointerLeave={() => {
          pointer.leave();
          setPointed(null);
        }}
      >
        {/* The assembly bands, one column each from their names down to the axis */}
        <Bands bands={bands} scale={scale} top={0} bottom={bottom} labelY={13} outerY={27} />
        <ReleaseTicks scale={scale} y={axisY} releases={releases} bounds={[0, width]} />
        {/* Release-wide events: a mark over the rows, each a link to that release of the graph's history; on pointing
            at its column or focusing it, its leader and its guides through the sets whose journeys take it, and its
            words in a note. */}
        <g className="jr-events">
          {events.map((e, n) => {
            const x = eventX(e);
            const lit = eventShown === n;
            const takenBy = sets.map((set) => set.journeys.some(takes(e)));
            const words = eventWords(e, assemblyName).line;
            // Each release-wide event leads to the graph's own page, its History tab, opened on the release the event
            // leads into (its exact counts).
            const at = href(`/organisms/${graph.organism}`, { tab: "history", release: e.new });
            return (
              <g
                key={`${e.kind}-${e.old}-${e.reason ?? ""}`}
                className={`jr-event jr-event--${e.kind}${lit ? " is-lit" : ""}`}
              >
                {lit ? (
                  <g aria-hidden="true">
                    <line x1={x} x2={x} y1={eventLineY + 6} y2={g.head + 4} className="jr-event__leader" />
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
                  </g>
                ) : null}
                <a
                  href={`${at}#history`}
                  className="jr-event__link"
                  aria-label={`${words}: Ensembl's id history of the ${organismName(graph.organism)} graph, release by release`}
                  onFocus={() => {
                    setFocusedEvent(n);
                  }}
                  onBlur={() => {
                    setFocusedEvent((f) => (f === n ? null : f));
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`${at}#history`);
                  }}
                >
                  <rect x={x - 10} y={eventLineY - 10} width={20} height={20} className="fig-hit" />
                  <StepGlyph glyph={e.kind} x={x} y={eventLineY + (e.kind === "loop" ? 4 : 0)} size="thin" />
                </a>
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
          const ids = ends?.segments.map((sg) => sg.id) ?? [];
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
                      ids.length > 1 ? `, through ${plural(ids.length, "stable id")} (${ids.join(", ")})` : ""
                    }${
                      bridges.length
                        ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), IDTrack's inference`
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
                    ends.segments.map((sg, k) => (
                      <GeneBar
                        key={k}
                        x0={sg.x0}
                        x1={sg.x1}
                        y={y}
                        size="thin"
                        className={`jr-line${k % 2 ? " jr-line--b" : ""}`}
                      />
                    ))
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
                  <Forks marks={m.marks} x={(r) => scale.x(r)} y={y} />
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
        {/* Every text of the figure stands on a halo of the paper: no band edge, guide or line crosses a set's words or a
            row's ids. The rows' ids stand apart from the rows, whose accessible names say them. */}
        <g className="jr-labels" aria-hidden="true">
          {sets.map((_, s) => (
            <text key={s} x={2} y={g.setBaseline(s)} className="fig-text fig-text--sans jr-sets__name">
              {(setLines[s] ?? []).map((line, k) => (
                <tspan key={k} x={2} dy={k ? 15 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          ))}
        </g>
        <g className="jr-names" aria-hidden="true">
          {groups.map(([a, b]) => {
            const x = scale.x1 + 10;
            return (
              <path
                key={`${a}-${b}`}
                d={`M${x},${g.lineY(a)}h3V${g.lineY(b)}h-3`}
                className="jr-same"
                data-rows={`${a}-${b}`}
              />
            );
          })}
          {activeLabels
            ? [...activeLabels.placed.values()].map((l) => (
                <text
                  key={l.key}
                  x={l.x}
                  y={activeLabels.y - (l.row === "a" ? 8 : 20)}
                  textAnchor={l.anchor}
                  className={`fig-text jr-id${
                    l.key === "end"
                      ? ` jr-answer ${activeLabels.renamed ? "fig-text--strong jr-answer--renamed" : activeLabels.changed ? "fig-text--strong" : "jr-answer--same"}`
                      : l.key === "start"
                        ? " jr-id--start"
                        : " jr-id--between"
                  }`}
                >
                  {l.text}
                </text>
              ))
            : null}
        </g>
      </svg>
      {shownNote !== null ? (
        <FigureNote x={noteX} y={g.lineY(shownNote) + 14} width={width} pointer={pointer.note}>
          {noteFor(shownNote)}
        </FigureNote>
      ) : shownEvent ? (
        <FigureNote x={eventX(shownEvent)} y={eventLineY + 14} width={width}>
          <p className="fig-note__title">{eventWords(shownEvent, assemblyName).line}</p>
          <p className="fig-note__quiet">A press opens this release in the graph&apos;s history.</p>
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

/** The stubs of a row's splits and merges: at a step whose earlier id passed to other ids too, a stub for each (at
 *  most `STUBS`) leaving the step above the line toward later releases; at a step whose later id received other ids
 *  too, a stub for each entering it below the line from earlier releases, in the event's hue. */
export function Forks({ marks, x, y }: { marks: readonly JourneyMark[]; x: (release: number) => number; y: number }) {
  return (
    <g className="jr-forks" aria-hidden="true">
      {marks.flatMap((mk, k) => {
        const s = mk.step;
        if (s.kind !== "history" || (!s.splits && !s.merges)) return [];
        const at = x(mk.at);
        const out = Array.from({ length: Math.min(STUBS, s.splits) }, (_, i) => (
          <line key={`s${k}-${i}`} x1={at + 2} y1={y - 1.5} x2={at + 7} y2={y - 4 - 2.2 * i} className="jr-fork" />
        ));
        const into = Array.from({ length: Math.min(STUBS, s.merges) }, (_, i) => (
          <line key={`m${k}-${i}`} x1={at - 7} y1={y + 4 + 2.2 * i} x2={at - 2} y2={y + 1.5} className="jr-fork" />
        ));
        return [...out, ...into];
      })}
    </g>
  );
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
