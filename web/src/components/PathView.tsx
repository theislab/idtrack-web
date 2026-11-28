// The path view: an identifier's journey through Ensembl's releases, drawn from the api's explained path in the figure
// grammar (components/figure/, DESIGN.md).
//
// Releases run left to right (top to bottom on a phone) over the assembly bands; each Ensembl gene is a bar over the
// releases the path holds it, on a lane named by its id; each step is its glyph (a tick for a new version or a
// replacement, a dot for a split or merge, an arc for a re-mapping, a diamond for a handoff between assemblies) and,
// between releases or lanes apart, a line in its hue; a crossing through an external database is dashed. The chosen
// answer is strong, the alternatives the engine considered light; the answers stand in a column at the end; the
// score of each strong step of Ensembl's history is a stem on one track under the lanes. Labels are placed by one
// deterministic rule and never overlap (figure/labels.ts). Every element is focusable (one tab stop, then the arrow
// keys) and shows the exact values the api returned.
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import "d3-transition";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { GraphDescription } from "../api/types";
import { databaseLabel } from "../lib/databases";
import type { Highlight } from "../lib/highlight";
import {
  curve,
  fitLabel,
  HORIZONTAL_METRICS,
  laneLabel,
  laneNames,
  layoutPath,
  pathLabels,
  presentMarks,
  scoreSteps,
  shownCandidates,
  VERTICAL_METRICS,
  type EdgePlace,
  type NodePlace,
  type PathLayout,
} from "../lib/pathLayout";
import type { ModelCandidate, ModelNode, ModelStep, PathModel } from "../lib/pathModel";
import { candidateTitle, nodeFacts, nodeKindWords, stepFacts, type AssemblyNames } from "../lib/pathReading";
import { shortScore, stepWords } from "../lib/resultWords";
import type { Symbols } from "../lib/symbols";
import { criterionValue, yesNo } from "../lib/values";
import { spaced, type Vocabulary } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { Bands } from "./figure/axis";
import { GeneBar, GlyphSwatch, StepGlyph } from "./figure/glyphs";
import { isEvent, type Glyph } from "./figure/glyph";
import { FigureLegend, type LegendEntry } from "./figure/Legend";
import { middleCut, stackLabels, textWidth, wrapWords, type PlacedLabel } from "./figure/labels";
import { assemblyBands, bandRange, scaleOf, shortNames, type Band } from "./figure/releases";
import { useDismiss, useHover } from "./figure/roving";
import { ScoreTrack } from "./figure/ScoreTrack";
import { useWidth } from "./figure/useWidth";

import { Button } from "./ui";
import { HoverCard } from "./v2/HoverCard";

/** The ranking record of a candidate, in idtrack's order, where the api's vocabulary is not at hand. */
const RECORD = [
  "own_version",
  "final_confidence",
  "bridges",
  "bridge_gap",
  "display_name",
  "entry_support",
  "score",
  "same_as_query",
  "annotation",
].map((code) => ({ code, meaning: null, fields: [] }));

const PHONE_WIDTH = 640;
const CHAR = textWidth("0"); // the 11 px monospaced face, one character
const TOP = 44; // the band names (two rows) and the answer column's head (horizontal)
const BOTTOM = 50; // the release axis and its title (horizontal)
const SCORE_TRACK = 58; // the score track under the lanes (horizontal)
const LIMIT_WIDE = 10;
const LIMIT_PHONE = 4;
/** Answers drawn per lane before the rest of that gene's targets are counted (one gene can have hundreds). */
const ROWS_WIDE = 6;
const ROWS_PHONE = 3;
/** The rows of labels of a lane: two above its bars (the genes' ids), offsets from the lane. */
const ROW_OFFSET: Record<string, number> = { a0: -12, a1: -25 };
/** Half the gap between two gene bars that meet at a step. */
const JOINT = 2;
/** A figure reveals along its time axis once, in the one duration of every figure (DIRECTION.md, `--v2-dur-4`),
 *  from the release the identifier is read at toward the answer; one light then travels the chosen path. */
const REVEAL_MS = 900;
const LIGHT_MS = 1300;
/** `--v2-ease-out`: things that arrive. */
const EASE_OUT = "0.16 1 0.3 1";
/** The height the releases of a drawn path take on a phone's timeline at first, at most (one screen and a little). */
const PHONE_AXIS = 760;

type ItemKey = `n:${string}` | `s:${number}` | `a:${number}`;

interface Item {
  key: ItemKey;
  x: number;
  y: number;
  title: string;
  facts: [string, string][];
  label: string;
}

function candidateFacts(candidate: ModelCandidate, model: PathModel, vocabulary: Vocabulary): [string, string][] {
  const c = candidate.api;
  const decision = model.decision;
  const facts: [string, string][] = [
    ["Rank", `${candidate.index + 1} of ${model.candidates.length}`],
    ["Best", yesNo(c.best)],
    ["Target", c.target],
    ["Gene", c.gene],
    ["Entry gene", c.entry_gene],
    ["Read through", c.entry_databases.length ? c.entry_databases.map(databaseLabel).join(", ") : "—"],
    ["Name authority", yesNo(c.authority)],
  ];
  const criteria = vocabulary.criteria.length ? vocabulary.criteria : RECORD;
  for (const criterion of criteria) facts.push([spaced(criterion.code), criterionValue(criterion, c).text]);
  facts.push(["Steps", `${c.external_steps} external, ${c.history_steps} history`]);
  if (decision && (decision.best === candidate || decision.runnerUp === candidate)) {
    facts.push(["Decided by", spaced(decision.key)]);
  }
  return facts;
}

function stepLabel(step: ModelStep): string {
  return stepWords(step.api.reason);
}

/** The kind of a step for a class name (its hue and dash); a split or merge of Ensembl's history is also an event,
 *  drawn at the weight of its importance on every candidate (`pv-event`). */
function stepClass(step: ModelStep): string {
  return `pv-step pv-step--${step.hue} pv-kind--${step.kind}${isEvent(step.api) ? " pv-event" : ""}`;
}

/** The glyph of a drawn step, by the figure grammar's rule (the node it reads from says whether an entry is a read
 *  through an external database). */
function stepGlyph(step: ModelStep, model: PathModel): Glyph {
  if (step.handoff) return "handoff";
  if (step.kind === "self_loop") return "loop";
  if (step.kind === "split_merge") return "event";
  if (step.kind === "history") return "version";
  if (step.kind === "bridge_near" || step.kind === "bridge_far") return "bridge";
  if (step.kind === "final") return "final";
  if (step.kind === "identity") return "identity";
  const source = step.api.source === null ? undefined : model.nodeById.get(step.api.source);
  return source && (source.api.kind === "external" || source.api.kind === "synonym") ? "read" : "form";
}

/** A step drawn as a mark at its middle (Ensembl's history), not only as a line. */
function marksMiddle(step: ModelStep): boolean {
  return step.kind === "history" || step.kind === "split_merge" || step.kind === "self_loop";
}

export interface PathViewProps {
  model: PathModel;
  description: GraphDescription;
  names: AssemblyNames;
  /** What the reader points at elsewhere in the answer: a candidate to draw strongly (a row of the candidates'
   *  table), a step to ring (a row of the path in words); the step shown in the drawing is told back. */
  highlight: Highlight;
  /** The id of the text reading beside the drawing (its accessible description). */
  readingId: string;
  /** The database the conversion asked for (`null`: Ensembl genes). */
  requestedDatabase: string | null;
  /** The genes' symbols at the target release, where they have come (written beside the answers). */
  symbols?: Symbols | null;
  /** What stands first on the drawing's toolbar (the answer's choice between the drawing and the words). */
  lead?: ReactNode;
}

export function PathView({
  model,
  description,
  names,
  highlight: store,
  readingId,
  requestedDatabase,
  symbols = null,
  lead = null,
}: PathViewProps) {
  // The frame's width is taken at once (useWidth); the drawing follows it in a transition, so that laying out and
  // drawing a large path yields to the page instead of holding it in the task that measured the frame.
  const { ref: wrapper, width: measured } = useWidth<HTMLDivElement>(0);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (measured !== width)
      startTransition(() => {
        setWidth(measured);
      });
  }, [measured, width]);
  const highlight = useSyncExternalStore(store.subscribe, store.candidate);
  const litStep = useSyncExternalStore(store.subscribe, store.step);
  const vertical = width > 0 && width < PHONE_WIDTH;
  const [showAll, setShowAll] = useState(false);
  const limit = showAll ? Number.POSITIVE_INFINITY : vertical ? LIMIT_PHONE : LIMIT_WIDE;
  const rowsPerLane = showAll ? Number.POSITIVE_INFINITY : vertical ? ROWS_PHONE : ROWS_WIDE;
  const [drawn, setDrawn] = useState<number | null>(null);
  // On a phone, the best answers drawn where the width holds fewer lanes than the best answers (null: all of them).
  const [capped, setCapped] = useState<number | null>(null);
  const onDrawn = useCallback((count: number, cappedBest: number | null) => {
    setDrawn(count);
    setCapped(cappedBest);
  }, []);
  const bestCount = model.candidates.filter((c) => c.best).length;
  // The key names the marks of the candidates drawn (on a phone a wide tie draws the first of its best answers).
  const drawnBest = capped ?? Number.POSITIVE_INFINITY;
  const present = useMemo(() => presentMarks(model, limit, drawnBest), [model, limit, drawnBest]);

  return (
    <div className="pv fig" ref={wrapper}>
      {width === 0 ? (
        <div className="pv-frame pv-frame--waiting" aria-hidden="true" />
      ) : vertical ? (
        <VerticalPath
          model={model}
          description={description}
          names={names}
          width={width}
          limit={limit}
          rowsPerLane={rowsPerLane}
          onDrawn={onDrawn}
          highlight={highlight}
          litStep={litStep}
          onStepShown={store.setStep}
          readingId={readingId}
          requestedDatabase={requestedDatabase}
          symbols={symbols}
          lead={lead}
        />
      ) : (
        <HorizontalPath
          model={model}
          description={description}
          names={names}
          width={width}
          limit={limit}
          rowsPerLane={rowsPerLane}
          onDrawn={onDrawn}
          highlight={highlight}
          litStep={litStep}
          onStepShown={store.setStep}
          readingId={readingId}
          requestedDatabase={requestedDatabase}
          symbols={symbols}
          lead={lead}
        />
      )}
      {highlight !== null && model.candidates[highlight] ? (
        <p className="pv__chosen" role="status">
          Candidate <span className="mono">{highlight + 1}</span>,{" "}
          <span className="mono">{model.candidates[highlight].api.target}</span>, is drawn strong, as chosen in the
          decision.{" "}
          <Button
            variant="quiet"
            onClick={() => {
              store.setCandidate(null);
            }}
          >
            Draw the best answer strong
          </Button>
        </p>
      ) : null}
      {showAll || (drawn !== null && drawn < model.candidates.length) ? (
        <p className="pv__more">
          {showAll
            ? `All ${model.candidates.length} candidates are drawn.`
            : capped !== null
              ? `${capped} of the ${bestCount} best answers are drawn (as many lanes as the width holds)${bestCount < model.candidates.length ? `, of ${model.candidates.length} candidates` : ""}; the reading and the table list all.`
              : `${drawn ?? 0} of ${model.candidates.length} candidates are drawn (the best and the next in rank, at most ${rowsPerLane} targets per gene); the reading and the table list all.`}{" "}
          <Button
            variant="quiet"
            onClick={() => {
              startTransition(() => {
                setShowAll((v) => !v);
              });
            }}
          >
            {showAll ? "Draw fewer" : `Draw all ${model.candidates.length}`}
          </Button>
        </p>
      ) : null}
      <PathLegend present={present} />
    </div>
  );
}

interface DrawingProps {
  model: PathModel;
  description: GraphDescription;
  names: AssemblyNames;
  width: number;
  limit: number;
  rowsPerLane: number;
  /** The candidates drawn, and the best answers drawn where the width holds fewer lanes than they are (else null). */
  onDrawn: (count: number, cappedBest: number | null) => void;
  highlight: number | null;
  /** A step to ring (pointed at in the path in words). */
  litStep: number | null;
  /** Tell the step the drawing shows (pointed at or focused), so its row in the words is marked. */
  onStepShown: (index: number | null) => void;
  readingId: string;
  requestedDatabase: string | null;
  symbols: Symbols | null;
  lead: ReactNode;
}

/** The focusable items in reading order, and the keyboard and pointer state over them. */
function useItems(
  layout: PathLayout,
  model: PathModel,
  names: AssemblyNames,
  toXY: (t: number, s: number) => [number, number],
) {
  const vocabulary = useVocabulary();
  const items = useMemo(() => {
    const list: Item[] = [];
    const seen = new Set<string>();
    const addNode = (id: string | null) => {
      if (id === null || seen.has(`n:${id}`)) return;
      const place = layout.nodes.get(id);
      if (!place || place.node.role === "target") return;
      seen.add(`n:${id}`);
      const [x, y] = toXY(place.t0, place.s);
      const facts = nodeFacts(place.node, names);
      list.push({
        key: `n:${id}`,
        x,
        y,
        title: place.node.api.label,
        facts,
        label: spoken(place.node.api.label, facts, ["Kind", "Active", "On the path", "Place"]),
      });
    };
    const edgeOf = new Map(layout.edges.map((e) => [e.step.index, e]));
    if (model.result.graph_id !== null) addNode(model.result.graph_id);
    for (const candidate of layout.shown) {
      for (const index of candidate.steps) {
        const edge = edgeOf.get(index);
        if (!edge) continue;
        addNode(edge.step.api.source);
        if (!seen.has(`s:${index}`)) {
          seen.add(`s:${index}`);
          const [x, y] = toXY(edge.mid.t, edge.mid.s);
          const facts = stepFacts(edge.step, model, names, vocabulary);
          list.push({
            key: `s:${index}`,
            x,
            y,
            title: stepLabel(edge.step),
            facts,
            label: spoken(`Step ${index + 1}: ${stepLabel(edge.step)}`, facts, [
              "Ensembl event",
              "From",
              "To",
              "Release",
              "Score",
              "Assembly handoff",
              "Places",
            ]),
          });
        }
        addNode(edge.step.api.target);
      }
      addNode(candidate.api.gene);
    }
    for (const answer of layout.answers) {
      const [x, y] = toXY(layout.answerT, answer.s);
      const facts = candidateFacts(answer.candidate, model, vocabulary);
      list.push({
        key: `a:${answer.candidate.index}`,
        x,
        y,
        title: candidateTitle(answer.candidate),
        facts,
        label: spoken(candidateTitle(answer.candidate), facts, ["Score", "Decided by"]),
      });
    }
    return list;
  }, [layout, model, names, toXY, vocabulary]);
  return items;
}

/** What a screen reader says of an element: its title and the facts a reader needs first (the note, linked as its
 *  description, holds every fact). */
function spoken(title: string, facts: [string, string][], wanted: string[]): string {
  const said = facts.filter(([k]) => wanted.includes(k)).map(([k, v]) => `${k.toLowerCase()} ${v}`);
  return said.length ? `${title}; ${said.join("; ")}` : title;
}

/** The distance from an element's middle to its note: the half-height of the element's hit area (24 px), so that the
 *  pointer passes from the element straight onto its note, with no gap to cross. */
const REACH = 12;

/** The top of the window's free room: the bottom of the sticky masthead (a note never stands under it). */
function freeTop(): number {
  const header = document.querySelector("header.mast");
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

function Tooltip({
  item,
  width,
  id,
  pinned,
  pointer,
  mayScroll,
}: {
  item: Item | null;
  width: number;
  id: string;
  pinned: boolean;
  pointer: { onPointerEnter: () => void; onPointerLeave: () => void };
  /** The note is shown by focus (not by pointing): the page may scroll to make room for it. */
  mayScroll: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The note stands whole in the window's free room (below the masthead): below its element where the room below holds
  // it, else above it; where neither does, the page is first scrolled so that the element stands near the top of the
  // free room and the note opens below it, scrolled inside itself where it is longer than the window (PageUp and
  // PageDown on the figure scroll it). The element's anchor is the part of it in the window (a long bar's start can be
  // off screen). Never cut by the figure's frame: the note stands over what follows the figure.
  // A note below its element is set by its top; a note above it by its bottom, so that it meets the element whatever
  // height it is drawn at (its text can settle after it was measured).
  const [place, setPlace] = useState<{ key: string; top: number; above: boolean; max: number | null } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const canvas = element?.offsetParent;
    if (!element || !canvas || !item) return;
    const gap = 8;
    const mast = freeTop();
    const bottom = window.innerHeight;
    const height = element.scrollHeight;
    let origin = canvas.getBoundingClientRect().top;
    let y = Math.min(Math.max(origin + item.y, mast + gap), bottom - gap);
    const below = bottom - (y + REACH) - gap;
    const over = y - REACH - gap - mast;
    if (mayScroll && height > below && height > over) {
      // Neither side holds it: bring the element near the top of the free room, then open below.
      const shift = y - (mast + 3 * gap);
      if (shift > 1) {
        window.scrollBy({ top: shift, behavior: "instant" });
        origin = canvas.getBoundingClientRect().top;
        y = Math.min(Math.max(origin + item.y, mast + gap), bottom - gap);
      }
    }
    const room = bottom - (y + REACH) - gap;
    const roomOver = y - REACH - gap - mast;
    const anchor = y - origin;
    let next: { key: string; top: number; above: boolean; max: number | null };
    if (height <= room || room >= roomOver)
      next = { key: item.key, top: anchor + REACH, above: false, max: height <= room ? null : Math.max(120, room) };
    else
      next = {
        key: item.key,
        // The note's bottom edge, from the canvas's bottom.
        top: canvas.clientHeight - (anchor - REACH),
        above: true,
        max: height <= roomOver ? null : roomOver,
      };
    // A note shown for another element opens at its start (one element serves every note).
    if (place?.key !== next.key) element.scrollTop = 0;
    if (place?.key !== next.key || place.top !== next.top || place.above !== next.above || place.max !== next.max)
      setPlace(next);
  }, [item, place, mayScroll]);
  // A finger has no keys to name: the hint says what a tap does.
  const coarse = useMemo(() => {
    const media = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
    return typeof media === "function" && media.call(window, "(pointer: coarse)").matches;
  }, []);
  if (!item) return null;
  // Over the element's column (it starts 20 px before the element), so that the pointer reaches the note by moving
  // straight up or down from the element.
  const left = Math.min(Math.max(8, item.x - 20), Math.max(8, width - 352));
  return (
    <div
      className="pv-tip"
      id={id}
      role="tooltip"
      ref={ref}
      style={{
        left,
        ...(place?.key === item.key && place.above ? { bottom: place.top } : {}),
        top: place?.key === item.key ? (place.above ? "auto" : place.top) : item.y + REACH,
        maxHeight: place?.key === item.key && place.max !== null ? place.max : undefined,
      }}
      {...pointer}
    >
      <p className="pv-tip__title">{item.title}</p>
      <dl className="pv-tip__facts">
        {item.facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="pv-tip__hint">
        {coarse
          ? pinned
            ? "Pinned · tap the page to close"
            : "Tap a mark to read it"
          : pinned
            ? "Pinned · Esc to close"
            : "Enter pins · the arrows follow the path · Esc hides"}
        {!coarse && place?.key === item.key && place.max !== null ? " · PageDown scrolls" : ""}
      </p>
    </div>
  );
}

/** How long the pointer must rest on another element before its note replaces the note shown: the pointer crosses
 *  other elements on its way to a note, and the note stays while it does (WCAG 1.4.13, hoverable). */
const SWITCH_MS = 140;

/** The element under the pointer (`useHover`), steadied: while a note is shown, another element's note replaces it only
 *  once the pointer rests on that element, and the pointer reaching the note keeps it. */
function useSteadyHover<K>() {
  const base = useHover<K>();
  const pending = useRef<number | null>(null);
  // The pointer is on the note: an element's leave (which a browser sends after the note's enter when the two touch)
  // does not take the note away.
  const onNote = useRef(false);
  const cancel = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = null;
  };
  useEffect(() => cancel, []);
  const { hover, enter: baseEnter, leave: baseLeave, drop: baseDrop } = base;
  const keep = base.note.onPointerEnter;
  const enter = useCallback(
    (key: K) => {
      cancel();
      if (onNote.current) return;
      if (hover === null || hover === key) baseEnter(key);
      else {
        // The note shown stays (its leave is forgotten) until the pointer rests on the other element.
        keep();
        pending.current = window.setTimeout(() => baseEnter(key), SWITCH_MS);
      }
    },
    [hover, baseEnter, keep],
  );
  const leave = useCallback(() => {
    cancel();
    if (!onNote.current) baseLeave();
  }, [baseLeave]);
  const drop = useCallback(() => {
    cancel();
    onNote.current = false;
    baseDrop();
  }, [baseDrop]);
  const note = {
    onPointerEnter: () => {
      cancel();
      onNote.current = true;
      keep();
    },
    onPointerLeave: () => {
      onNote.current = false;
      base.note.onPointerLeave();
    },
  };
  return { hover, enter, leave, drop, note };
}

/** The arrow keys that move to the next element of the path, in the direction the walk runs on the screen: time runs
 *  to the right on a wide drawing and down a phone's timeline, so a walk back in time runs left (or up). */
function nextKeys(model: PathModel, vertical: boolean): { next: string[]; previous: string[] } {
  const back = model.result.from_release !== null && model.result.to_release < model.result.from_release;
  const [along, alongBack] = vertical ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
  const [across, acrossBack] = vertical ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  return back
    ? { next: [alongBack, across], previous: [along, acrossBack] }
    : { next: [along, across], previous: [alongBack, acrossBack] };
}

/** Keyboard and pointer focus over the items: one tab stop, the arrows move along the path as it runs on the screen,
 *  Enter pins, Escape hides the tip (focus stays where it is); the tip can be pointed at without vanishing. */
function useFocus(items: Item[], tipId: string, keysOf: { next: string[]; previous: string[] }) {
  const [active, setActive] = useState<ItemKey | null>(null);
  const pointer = useSteadyHover<ItemKey>();
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const refs = useRef(new Map<string, SVGGElement>());
  // The tab stop: the element last focused while it is still drawn, else the first (a zoom or "draw all" can remove it).
  const current = active !== null && items.some((i) => i.key === active) ? active : (items[0]?.key ?? null);
  const visible = pointer.hover ?? (focused || pinned ? current : null);
  const dismiss = useDismiss(visible !== null);
  const shown = dismiss.dismissed ? null : visible;
  const move = useCallback(
    (to: number) => {
      const item = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!item) return;
      setActive(item.key);
      refs.current.get(item.key)?.focus();
    },
    [items],
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const index = items.findIndex((i) => i.key === current);
      const keys: Record<string, () => void> = {
        ...Object.fromEntries(keysOf.next.map((k) => [k, () => move(index + 1)])),
        ...Object.fromEntries(keysOf.previous.map((k) => [k, () => move(index - 1)])),
        Home: () => move(0),
        End: () => move(items.length - 1),
        Enter: () => setPinned((p) => !p),
        " ": () => setPinned((p) => !p),
        Escape: () => {
          setPinned(false);
          pointer.drop();
        },
      };
      // A note longer than the window scrolls inside itself: PageDown and PageUp on the figure scroll it.
      if (event.key === "PageDown" || event.key === "PageUp") {
        const note = document.getElementById(tipId);
        if (note && note.scrollHeight > note.clientHeight + 1) {
          event.preventDefault();
          note.scrollBy({ top: (event.key === "PageDown" ? 1 : -1) * note.clientHeight * 0.8 });
        }
        return;
      }
      const action = keys[event.key];
      if (action) {
        event.preventDefault();
        if (event.key !== "Escape") dismiss.reset();
        action();
      }
    },
    [items, current, move, pointer, dismiss, tipId, keysOf],
  );
  // A pinned note closes when the page is pressed anywhere but on a mark of the drawing or on the note itself.
  const drop = pointer.drop;
  useEffect(() => {
    if (!pinned) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      const onMark = [...refs.current.values()].some((element) => element.contains(target));
      if (onMark || document.getElementById(tipId)?.contains(target)) return;
      setPinned(false);
      drop();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [pinned, tipId, drop]);
  const labels = useMemo(() => new Map(items.map((i) => [i.key, i.label])), [items]);
  const bind = (key: ItemKey) => ({
    role: "button" as const,
    "aria-label": labels.get(key) ?? key,
    "aria-pressed": pinned && key === current,
    "aria-describedby": shown === key ? tipId : undefined,
    ref: (element: SVGGElement | null) => {
      if (element) refs.current.set(key, element);
      else refs.current.delete(key);
    },
    tabIndex: key === current ? 0 : -1,
    onFocus: () => {
      setActive(key);
      setFocused(true);
      dismiss.reset();
    },
    onBlur: () => setFocused(false),
    onMouseEnter: () => {
      pointer.enter(key);
      dismiss.reset();
    },
    onMouseLeave: () => pointer.leave(),
    onClick: () => {
      setActive(key);
      setPinned(true);
      dismiss.reset();
      refs.current.get(key)?.focus();
    },
    onKeyDown,
  });
  return {
    shown,
    pinned,
    onKeyDown,
    bind,
    current,
    focusedKey: focused ? current : null,
    note: pointer.note,
    byPointer: pointer.hover !== null,
  };
}

/** The label of the identifier or a form it is read through, with the identifier's databases where they fit. */
function upperLabel(place: NodePlace, room: number) {
  const label = fitLabel(place.node.label, room / CHAR) ?? "…";
  const databases = place.node.isQuery ? place.node.api.databases.map(databaseLabel) : [];
  let left = room - textWidth(label) - 16;
  const shown: string[] = [];
  for (const database of databases) {
    const cost = textWidth(`${database}, `, 11, "sans");
    if (left - cost < 60 && shown.length < databases.length - 1) break;
    if (left < cost) break;
    shown.push(database);
    left -= cost;
  }
  const more = databases.length - shown.length;
  return (
    <>
      {label}
      {shown.length || more ? (
        <tspan className="pv-label__db">
          {" · "}
          {shown.join(", ")}
          {more ? `${shown.length ? ", " : ""}+${more} more` : ""}
        </tspan>
      ) : null}
    </>
  );
}

/** How many forms of the identifier (rows above the lanes) the drawn candidates' paths pass through. */
function drawnUpper(model: PathModel, limit: number): number {
  const ids = new Set<string>();
  for (const candidate of shownCandidates(model, limit)) {
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (!step) continue;
      for (const id of [step.api.source, step.api.target]) if (id !== null) ids.add(id);
    }
  }
  if (model.result.graph_id !== null) ids.add(model.result.graph_id);
  return model.nodes.filter((n) => n.role === "upper" && ids.has(n.id)).length;
}

/** The releases a view opened on an event shows, at least. */
const EVENT_WINDOW = 12;

/** The first event of the best answer's path a reader comes to see: a split or merge of Ensembl's history, or a
 *  bridge (where Ensembl's history gives no successor); its releases and its name. */
function eventOf(model: PathModel): { span: [number, number]; words: string } | null {
  const best = model.candidates.find((c) => c.best);
  if (!best) return null;
  for (const index of best.steps) {
    const step = model.steps[index];
    if (!step) continue;
    if (step.kind === "split_merge" || step.kind === "bridge_near") {
      const span: [number, number] = [
        Math.min(step.sourceRelease, step.targetRelease),
        Math.max(step.sourceRelease, step.targetRelease),
      ];
      const words = step.kind === "bridge_near" ? "bridge" : step.api.reason.replace(/_/g, " ");
      return { span, words };
    }
  }
  return null;
}

/** The view over `span` with a release of room on each side, at least `least` releases wide, inside the graph's
 *  releases (d3's programmatic transform does not keep it inside by itself). */
function spanTransform(
  span: [number, number],
  least: number,
  [r0, rN]: [number, number],
  base: (release: number) => number,
  plotL: number,
): ZoomTransform {
  const full = rN - r0 + 1;
  const wide = Math.min(full, Math.max(least, span[1] - span[0] + 3));
  let a = (span[0] + span[1]) / 2 - wide / 2;
  a = Math.min(Math.max(a, r0 - 0.5), rN + 0.5 - wide);
  const k = full / wide;
  // The zoomed position of a release is k * base(release) + x: put the window's first release at the plot's left.
  return zoomIdentity.translate(plotL - k * base(a), 0).scale(k);
}

/** The releases the drawn candidates' paths touch: the view is fitted to them, not to every candidate's. */
function drawnSpan(model: PathModel, limit: number): [number, number] | null {
  const shown = shownCandidates(model, limit);
  const releases: number[] = [];
  for (const candidate of shown) {
    for (const index of candidate.steps) {
      const step = model.steps[index];
      if (step) releases.push(step.sourceRelease, step.targetRelease);
    }
  }
  if (model.result.from_release !== null) releases.push(model.result.from_release);
  releases.push(model.result.to_release);
  return releases.length ? [Math.min(...releases), Math.max(...releases)] : model.span;
}

/** The zoom of a drawing as two matching stroke icons, out then in (the same order on every figure that zooms). */
function ZoomButtons({ onOut, onIn, out, into }: { onOut: () => void; onIn: () => void; out: string; into: string }) {
  const glyph = (plus: boolean) => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d={plus ? "M4.8 7h4.4M7 4.8v4.4" : "M4.8 7h4.4"} stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
  return (
    <div className="pv-views__zoom" role="group" aria-label="Zoom">
      <button type="button" className="pv-views__icon" onClick={onOut} aria-label={out} title={out}>
        {glyph(false)}
      </button>
      <button type="button" className="pv-views__icon" onClick={onIn} aria-label={into} title={into}>
        {glyph(true)}
      </button>
    </div>
  );
}

/** Where a drawing's reveal starts on its time axis: at the release read, with the identifier and the forms it is read
 *  through (a staircase before that release) shown from the start, so that the first marks are whole at once. A walk
 *  forward reveals toward later releases, which leaves the staircase behind it; a walk back starts past it. */
function revealStart(read: number, staircase: number, model: PathModel, lo: number, hi: number): number {
  const back = model.result.to_release < (model.result.from_release ?? model.result.to_release);
  return Math.min(Math.max(back ? read - staircase : read, lo), hi);
}

/** The clip that reveals a drawing once along its time axis, from the release read (`at`, on the time axis) outward in
 *  the walk's direction: toward later releases for a walk forward, toward earlier ones for a walk back. */
function RevealClip({
  id,
  at,
  extent,
  across,
  back,
  vertical,
}: {
  id: string;
  at: number;
  extent: number;
  across: number;
  back: boolean;
  vertical: boolean;
}) {
  const [pos, size] = vertical ? ["y", "height"] : ["x", "width"];
  const common = { dur: `${REVEAL_MS}ms`, fill: "freeze", calcMode: "spline", keySplines: EASE_OUT, keyTimes: "0;1" };
  const box = vertical ? { x: 0, width: across } : { y: 0, height: across };
  return (
    <clipPath id={id}>
      {back ? (
        <rect {...box} {...{ [pos]: at, [size]: extent - at }}>
          <animate attributeName={pos} from={String(at)} to="0" {...common} />
          <animate attributeName={size} from={String(extent - at)} to={String(extent)} {...common} />
        </rect>
      ) : (
        <rect {...box} {...{ [pos]: 0, [size]: at }}>
          <animate attributeName={size} from={String(at)} to={String(extent)} {...common} />
        </rect>
      )}
    </clipPath>
  );
}

/** One light that travels the chosen path once as the drawing reveals: from the identifier read, step by step along
 *  its genes' bars and Ensembl's steps, to the answer. */
function TravellingLight({
  layout,
  toXY,
  scale,
  vertical,
}: {
  layout: PathLayout;
  toXY: (t: number, s: number) => [number, number];
  scale: (r: number) => number;
  vertical: boolean;
}) {
  const best = layout.shown.find((c) => c.best);
  if (!best) return null;
  const edgeOf = new Map(layout.edges.map((e) => [e.step.index, e]));
  let d = "";
  for (const index of best.steps) {
    const edge = edgeOf.get(index);
    if (!edge?.d) continue;
    const segment = edgePath(edge, layout, scale);
    d += d ? segment.replace(/^M/, "L") : segment;
  }
  if (!d) return null;
  const swap = vertical ? `translate(${toXY(0, 0)[0]},0) matrix(0,1,1,0,0,0)` : `translate(0,${toXY(0, 0)[1]})`;
  return (
    <g transform={swap} aria-hidden="true" className="pv-light">
      <circle r={3.6} className="pv-light__dot" opacity={0}>
        <animateMotion
          dur={`${LIGHT_MS}ms`}
          fill="freeze"
          path={d}
          calcMode="spline"
          keyPoints="0;1"
          keyTimes="0;1"
          keySplines="0.65 0 0.35 1"
        />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.08;0.85;1"
          dur={`${LIGHT_MS}ms`}
          fill="freeze"
        />
      </circle>
    </g>
  );
}

function HorizontalPath({
  model,
  description,
  names,
  width,
  limit,
  rowsPerLane,
  onDrawn,
  highlight,
  litStep,
  onStepShown,
  readingId,
  requestedDatabase,
  symbols,
  lead,
}: DrawingProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  // The view the toolbar last set (pressed), until a zoom or pan by hand.
  const [preset, setPreset] = useState<"fit" | "event" | "all" | null>("fit");
  const tipId = useId();
  const clipId = useId().replace(/:/g, "");
  const releases = description.releases;
  const r0 = releases[0] ?? 0;
  const rN = releases[releases.length - 1] ?? 0;
  const answerWidth = Math.min(280, Math.max(200, width * 0.18));
  const metrics = HORIZONTAL_METRICS;
  // Room left of the plot for the identifier and the forms it is read through, which stand in a staircase before the
  // release they are read at: as many steps as the drawn candidates' paths hold such forms (at most four).
  const upperRoom = (Math.min(4, drawnUpper(model, limit)) + 1) * metrics.indent;
  // The gutter names the rows: where each identifier lives (its database or kind), then the genes' lanes by their id.
  const gutter = useMemo(() => {
    if (width < 900) return 28;
    const titles = model.nodes
      .filter((n) => n.role === "upper" || n.role === "bridge")
      .map((n) => (n.role === "bridge" ? `via ${spaceOf(n)}` : spaceOf(n, model.result.from_databases)).length);
    const ids = model.nodes.filter((n) => n.role === "gene").map((n) => n.label.length);
    return Math.min(196, Math.max(124, Math.max("Ensembl gene".length, ...titles, ...ids) * 6.2 + 46));
  }, [model.nodes, model.result.from_databases, width]);
  const plotL = gutter + upperRoom;
  const plotR = width - answerWidth - 60;
  const left = plotL - upperRoom;
  const base = useMemo(
    () =>
      scaleLinear()
        .domain([r0 - 0.5, rN + 0.5])
        .range([plotL, plotR]),
    [r0, rN, plotL, plotR],
  );
  // The view opens fitted to the drawn path: its first layout is the fitted one (no layout at the whole range first).
  const fitSpan = useMemo(() => drawnSpan(model, limit), [model, limit]);
  const [transform, setTransform] = useState<ZoomTransform>(() =>
    spanTransform(fitSpan ?? [r0, rN], 10, [r0, rN], base, plotL),
  );
  // The scale changes with the transform's values, not with a new object of the same values (d3 sends one when the
  // view is set to where it stands): a layout is made once per view.
  const { k: zoomK, x: zoomX } = transform;
  const scale = useMemo(() => zoomIdentity.translate(zoomX, 0).scale(zoomK).rescaleX(base), [zoomK, zoomX, base]);
  const answerT = width - answerWidth;
  const layout = useMemo(
    () => layoutPath(model, { scale: (r) => scale(r), answerT, metrics, limit, rowsPerLane }),
    [model, scale, answerT, metrics, limit, rowsPerLane],
  );
  useEffect(() => {
    onDrawn(layout.shown.length, null);
  }, [layout.shown.length, onDrawn]);
  const isStrong = useCallback(
    (candidates: number[], best: boolean) => (highlight === null ? best : candidates.includes(highlight)),
    [highlight],
  );
  const scored = useMemo(() => scoreSteps(layout, isStrong), [layout, isStrong]);
  const lanesBottom = TOP + layout.stackSize;
  const trackTop = lanesBottom + 12;
  const plotBottom = scored.length ? lanesBottom + SCORE_TRACK : lanesBottom;
  const height = plotBottom + BOTTOM;
  const toXY = useCallback((t: number, s: number): [number, number] => [t, s + TOP], []);
  const items = useItems(layout, model, names, toXY);
  const keysOf = useMemo(() => nextKeys(model, false), [model]);
  const focus = useFocus(items, tipId, keysOf);
  const shownItem = items.find((i) => i.key === focus.shown) ?? null;
  useStepShown(focus.shown, onStepShown);

  // Zoom along the releases: drag to pan, ctrl or shift with the wheel (or a pinch) to zoom, buttons for both.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, Math.max(1, (rN - r0 + 1) / 3)])
      .extent([
        [plotL, 0],
        [plotR, height],
      ])
      .translateExtent([
        [plotL, 0],
        [plotR, height],
      ])
      .filter((event: Event) => {
        if (event.type === "wheel") return (event as WheelEvent).ctrlKey || (event as WheelEvent).shiftKey;
        if (event.type === "dblclick") return false;
        return !(event as MouseEvent).button;
      })
      .on("zoom", (event: { transform: ZoomTransform; sourceEvent: unknown }) => {
        const next = event.transform;
        setTransform((t) => (t.k === next.k && t.x === next.x ? t : next));
        // A zoom or pan by hand leaves the view of every preset.
        if (event.sourceEvent) setPreset(null);
      });
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [plotL, plotR, height, r0, rN]);

  const reduced = useMemo(() => {
    // A browser has matchMedia; a test's DOM may not.
    const media = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
    return typeof media === "function" && media.call(window, "(prefers-reduced-motion: reduce)").matches;
  }, []);
  // The path draws itself once, from the release it is read at toward the answer, and one light travels the chosen
  // path (none under reduced motion).
  const [revealed, setRevealed] = useState(reduced);
  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => setRevealed(true), LIGHT_MS + 50);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const revealId = useId().replace(/:/g, "");
  const duration = (ms: number) => (reduced ? 0 : ms);

  const event = useMemo(() => eventOf(model), [model]);
  /** Zoom to a window over `span` with a release of room on each side, at least `least` releases wide, inside the
   *  graph's releases (d3's programmatic transform does not keep it inside by itself). */
  const zoomToSpan = useCallback(
    (span: [number, number], least: number, animate: boolean) => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      if (!svg || !behavior) return;
      const target = spanTransform(span, least, [r0, rN], base, plotL);
      const selection = select(svg);
      if (animate && !reduced)
        selection
          .transition()
          .duration(400)
          .call((t) => behavior.transform(t, target));
      else behavior.transform(selection, target);
    },
    [r0, rN, base, plotL, reduced],
  );
  const fit = useCallback(
    (animate: boolean) => zoomToSpan(fitSpan ?? [r0, rN], 10, animate),
    [zoomToSpan, fitSpan, r0, rN],
  );
  const showEvent = useCallback(
    (animate: boolean) => {
      if (event) zoomToSpan(event.span, EVENT_WINDOW, animate);
    },
    [zoomToSpan, event],
  );
  // The view opens on the whole path (its event, a split, a merge or a bridge, is a button of the toolbar and a band
  // in the drawing).
  useEffect(() => {
    fit(false);
  }, [fit]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior)
      select(svg)
        .transition()
        .duration(duration(250))
        .call((t) => behavior.scaleBy(t, factor));
  };
  const showEverything = () => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior)
      select(svg)
        .transition()
        .duration(duration(350))
        .call((t) => behavior.transform(t, zoomIdentity));
  };
  /** Centre the view on a release (the overview strip). */
  const centreOn = (release: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior) behavior.translateTo(select(svg), base(release), height / 2);
  };

  const ppr = Math.abs(scale(1) - scale(0));
  const step = ppr >= 30 ? 1 : ppr >= 12 ? 5 : 10;
  const bands = useMemo(() => assemblyBands(description), [description]);
  const view: [number, number] = [
    Math.max(r0, Math.ceil(scale.invert(plotL) - 0.01)),
    Math.min(rN, Math.floor(scale.invert(plotR) + 0.01)),
  ];
  const figureScale = useMemo(() => scaleOf(releases, (r) => scale(r), plotL, plotR), [releases, scale, plotL, plotR]);

  // Labels: the genes' ids in the two rows above each lane, the chosen path's first, then in time order; a gene after
  // a gene of the same id on its lane (or under the lane's name) by its version.
  const laneTitles = useMemo(() => (gutter > 40 ? laneNames(layout) : new Map<number, string>()), [layout, gutter]);
  const labels = useMemo(() => pathLabels(layout, [left, plotR + 4], laneTitles), [layout, left, plotR, laneTitles]);

  const laneY = useMemo(() => {
    const map = new Map<number, number>();
    for (const place of layout.nodes.values()) {
      if (place.node.role === "gene" && place.lane !== null && !map.has(place.lane)) map.set(place.lane, place.s);
    }
    return map;
  }, [layout]);
  const rowY = (row: string) => {
    const [laneText = "0", offset = "a0"] = row.split(":");
    return (laneY.get(Number(laneText)) ?? 0) + (ROW_OFFSET[offset] ?? 0) + TOP;
  };
  const candidatesOfNode = useNodeCandidates(model);

  // The axis's labelled releases: every `step`-th, with light grid lines behind the drawing.
  const ticks = releases.filter((r) => {
    const x = scale(r);
    return x >= left - 2 && x <= plotR + 2;
  });

  return (
    <div className="pv-frame">
      {/* One row: the zoom, "Fit the path", and the other views in a popover (the event of the best path, every
          release), with the releases in view and how to pan and zoom by hand. */}
      <div className="pv-toolbar">
        {lead}
        <div className="pv-toolbar__tools" role="group" aria-label="Zoom of the path">
          <Button
            variant="quiet"
            className="pv-tool pv-preset"
            aria-pressed={preset === "fit"}
            onClick={() => {
              setPreset("fit");
              fit(true);
            }}
          >
            Fit the path
          </Button>
          <HoverCard
            hover={false}
            className="pv-views"
            triggerClassName="pv-tool pv-views__trigger"
            label="View: zoom, other spans of releases, and the releases in view"
            trigger={
              <>
                View
                <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
                  <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </>
            }
          >
            {(close) => {
              // A view chosen closes the popover and gives the focus back to its button.
              const choose = (event: { currentTarget: HTMLElement }, set: () => void) => {
                event.currentTarget.closest(".hovercard")?.querySelector<HTMLElement>(".hovercard__trigger")?.focus();
                close();
                set();
              };
              return (
                <div className="pv-views__list">
                  <ZoomButtons
                    onOut={() => {
                      setPreset(null);
                      zoomBy(1 / 1.6);
                    }}
                    onIn={() => {
                      setPreset(null);
                      zoomBy(1.6);
                    }}
                    out="Zoom out"
                    into="Zoom in"
                  />
                  {event ? (
                    <button
                      type="button"
                      className="pv-views__item pv-preset"
                      aria-pressed={preset === "event"}
                      onClick={(e) => {
                        choose(e, () => {
                          setPreset("event");
                          showEvent(true);
                        });
                      }}
                    >
                      The {event.words} at{" "}
                      {event.span[0] === event.span[1] ? event.span[0] : `${event.span[0]} → ${event.span[1]}`}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pv-views__item pv-preset"
                    aria-pressed={preset === "all"}
                    onClick={(e) => {
                      choose(e, () => {
                        setPreset("all");
                        showEverything();
                      });
                    }}
                  >
                    All releases
                  </button>
                  <p className="pv-views__note">
                    In view: releases{" "}
                    <span className="mono">
                      {view[0]}–{view[1]}
                    </span>{" "}
                    of{" "}
                    <span className="mono">
                      {r0}–{rN}
                    </span>
                    . Drag the drawing to pan; ctrl or shift with the wheel, or a pinch, zooms.
                  </p>
                </div>
              );
            }}
          </HoverCard>
        </div>
      </div>
      <Overview
        bands={bands}
        base={base}
        width={width}
        left={left}
        plotR={plotR}
        span={fitSpan}
        view={[scale.invert(plotL), scale.invert(plotR)]}
        onCentre={centreOn}
        range={[r0, rN]}
      />
      <div className="pv-canvas">
        <svg
          ref={svgRef}
          className="pv-svg"
          width={width}
          height={height}
          role="group"
          aria-label={`Path of ${model.result.query_id} from release ${model.result.from_release ?? "—"} to ${model.result.to_release}: ${layout.shown.length} candidates drawn. Arrow keys move between its elements; the reading beside it says every step.`}
          aria-describedby={readingId}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={0} width={plotR - left + 6} height={height} />
            </clipPath>
            {!revealed ? (
              <RevealClip
                id={revealId}
                at={revealStart(
                  scale(model.result.from_release ?? model.result.to_release),
                  upperRoom,
                  model,
                  left,
                  width,
                )}
                extent={width}
                across={height}
                back={model.result.to_release < (model.result.from_release ?? model.result.to_release)}
                vertical={false}
              />
            ) : null}
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <Bands
              bands={bands}
              scale={figureScale}
              top={0}
              bottom={plotBottom}
              labelY={13}
              outerY={27}
              view={[left, plotR]}
            />
            <g className="pv-grid" aria-hidden="true">
              {ticks
                .filter((r) => r % step === 0 || step === 1)
                .map((r) => (
                  <line key={r} x1={scale(r)} x2={scale(r)} y1={TOP - 8} y2={plotBottom} />
                ))}
            </g>
            <RowTracks layout={layout} left={left} right={plotR} top={TOP} />
            <g clipPath={revealed ? undefined : `url(#${revealId})`}>
              <PathMarks
                layout={layout}
                model={model}
                toXY={toXY}
                scale={scale}
                isStrong={isStrong}
                lit={litStep}
                focus={focus}
                range={[r0, rN]}
                part="main"
                plot={[left, plotR]}
              />
              <g className="pv-labels" aria-hidden="true">
                {[...labels.values()].map((label) => (
                  <GeneLabel
                    key={label.key}
                    label={label}
                    y={rowY(label.row)}
                    strong={(() => {
                      const place = layout.nodes.get(label.key.slice(2));
                      return place ? isStrong(candidatesOfNode.get(place.node.id) ?? [], place.best) : false;
                    })()}
                    bridge={layout.nodes.get(label.key.slice(2))?.node.role === "bridge"}
                  />
                ))}
              </g>
            </g>
          </g>
          {scored.length ? (
            <g clipPath={revealed ? undefined : `url(#${revealId})`}>
              <ScoreTrack
                items={scored
                  .map(({ edge, weight, hue }) => ({
                    key: String(edge.step.index),
                    x: toXY(edge.mid.t, edge.mid.s)[0],
                    weight,
                    hue,
                  }))
                  .filter((item) => item.x >= left && item.x <= plotR)}
                x0={left}
                x1={plotR}
                top={trackTop + 8}
                bottom={trackTop + 40}
                labelX={left - 6}
                name={null}
              />
            </g>
          ) : null}
          {scored.length && gutter > 40 ? (
            <g className="pv-rows" aria-hidden="true">
              <text className="pv-rows__score" x={12} y={trackTop + 12}>
                Ensembl&apos;s score
              </text>
            </g>
          ) : null}
          <g clipPath={revealed ? undefined : `url(#${revealId})`}>
            <PathMarks
              layout={layout}
              model={model}
              toXY={toXY}
              scale={scale}
              isStrong={isStrong}
              lit={litStep}
              focus={focus}
              range={[r0, rN]}
              part="final"
              plot={[left, plotR]}
            />
          </g>
          {!revealed ? <TravellingLight layout={layout} toXY={toXY} scale={scale} vertical={false} /> : null}
          {gutter > 40 ? (
            <RowTitles layout={layout} model={model} width={gutter} top={TOP} isStrong={isStrong} titles={laneTitles} />
          ) : null}
          <g className="pv-axis" aria-hidden="true">
            <line className="pv-axis__base" x1={left} x2={plotR} y1={plotBottom} y2={plotBottom} />
            {ticks.map((r) => {
              const x = scale(r);
              const labelled = r % step === 0 || step === 1;
              if (!labelled && ppr < 4) return null;
              return (
                <g key={r}>
                  <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + (labelled ? 6 : 3)} />
                  {labelled ? (
                    <text x={x} y={plotBottom + 18} textAnchor="middle">
                      {r}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text className="pv-axis__title" x={(left + plotR) / 2} y={plotBottom + 40} textAnchor="middle">
              Ensembl release
            </text>
          </g>
          <AnswerColumn
            layout={layout}
            model={model}
            toXY={toXY}
            isStrong={isStrong}
            focus={focus}
            x={answerT}
            width={answerWidth}
            requestedDatabase={requestedDatabase}
            symbols={symbols}
          />
        </svg>
        <Tooltip
          item={shownItem}
          width={width}
          id={tipId}
          pinned={focus.pinned}
          pointer={focus.note}
          mayScroll={!focus.byPointer}
        />
      </div>
    </div>
  );
}

/** Where an identifier lives, for the name of its row: its database (or the first of them), or its kind. */
/** The row of an identifier, by the databases it is read through: for the identifier as read, those that read it at
 *  the release read (`from_databases`, as the Read card says); for any other id, those that attach it at any release. */
function spaceOf(node: ModelNode, read: readonly string[] = []): string {
  const kind = node.api.kind;
  if (kind === "external" || kind === "synonym") {
    const databases = (node.isQuery && read.length ? read : node.api.databases).map(databaseLabel);
    const first = databases[0] ?? (kind === "synonym" ? "synonym" : "external id");
    const more = databases.length > 1 ? ` +${databases.length - 1}` : "";
    return `${kind === "synonym" ? "synonym · " : ""}${first}${more}`;
  }
  return kind === "base_ensembl_gene" ? "Ensembl id, no version" : nodeKindWords(kind);
}

/** A hairline along each row and lane, so that the rows read as the identifier spaces the path moves between. */
function RowTracks({ layout, left, right, top }: { layout: PathLayout; left: number; right: number; top: number }) {
  return (
    <g className="pv-tracks" aria-hidden="true">
      {layout.rows.map((row) => (
        <line key={row.id} x1={left} x2={right} y1={row.s + top} y2={row.s + top} />
      ))}
      {layout.laneS.map((s, lane) => (
        <line key={`lane:${lane}`} className="pv-tracks__lane" x1={left} x2={right} y1={s + top} y2={s + top} />
      ))}
    </g>
  );
}

/** The names of the rows in the gutter: the database or kind of each identifier above the lanes, then each lane of
 *  genes by the id its genes share (its versions are written on its bars). */
function RowTitles({
  layout,
  model,
  width,
  top,
  isStrong,
  titles,
}: {
  layout: PathLayout;
  model: PathModel;
  width: number;
  top: number;
  isStrong: (candidates: number[], best: boolean) => boolean;
  titles: Map<number, string>;
}) {
  const room = (width - 34) / CHAR;
  return (
    <g className="pv-rows" aria-hidden="true">
      <text className="pv-rows__head" x={12} y={top - 12}>
        Database
      </text>
      {layout.rows.map((row) => {
        const place = layout.nodes.get(row.id);
        if (!place) return null;
        const y = row.s + top;
        const text =
          row.kind === "bridge" ? `via ${spaceOf(place.node)}` : spaceOf(place.node, model.result.from_databases);
        const external = place.node.api.kind === "external" || place.node.api.kind === "synonym";
        return (
          <g key={row.id} className={`pv-rows__row ${place.best ? "pv-rows__row--strong" : ""}`}>
            <StepGlyph
              glyph={row.kind === "bridge" ? "bridge" : external ? "read" : "form"}
              x={16}
              y={y}
              size="thin"
              strong={place.best}
            />
            <text x={28} y={y + 3.5}>
              {fitLabel(text, room * 1.08) ?? "…"}
            </text>
          </g>
        );
      })}
      {layout.laneS.map((s, lane) => {
        // A lane is named strongly where it holds a gene of a best answer (every best of a tie alike).
        const strong = (layout.laneBest[lane] ?? false) && model.candidates.some((c) => isStrong([c.index], c.best));
        const id = titles.get(lane);
        return (
          <g key={`lane:${lane}`} className={`pv-rows__row ${strong ? "pv-rows__row--strong" : ""}`}>
            <GeneBar x0={10} x1={22} y={s + top} size="thick" strong={strong} />
            <text x={28} y={s + top + (id ? -2 : 3.5)}>
              Ensembl gene
            </text>
            {id ? (
              <text className="pv-rows__id" x={28} y={s + top + 11}>
                {fitLabel(id, room) ?? "…"}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function GeneLabel({ label, y, strong, bridge }: { label: PlacedLabel; y: number; strong: boolean; bridge: boolean }) {
  return (
    <text
      className={`pv-label ${strong ? "pv-label--strong" : ""} ${bridge ? "pv-label--bridge" : ""}`}
      x={label.x}
      y={y}
      textAnchor={label.anchor}
    >
      {label.text}
    </text>
  );
}

/** The graph's whole release range in miniature: the assembly bands, the drawn path's releases and the window in
 *  view. Pressing or dragging on it centres the view there (the toolbar's buttons do the same by keyboard). */
function Overview({
  bands,
  base,
  width,
  left,
  plotR,
  span,
  view,
  onCentre,
  range,
}: {
  bands: Band[];
  base: (release: number) => number;
  width: number;
  left: number;
  plotR: number;
  span: [number, number] | null;
  view: [number, number];
  onCentre: (release: number) => void;
  range: [number, number];
}) {
  const [dragging, setDragging] = useState(false);
  const toRelease = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const fraction = (x - base(range[0] - 0.5)) / (base(range[1] + 0.5) - base(range[0] - 0.5));
    return range[0] - 0.5 + fraction * (range[1] - range[0] + 1);
  };
  const v0 = Math.max(base(view[0]), left);
  const v1 = Math.min(base(view[1]), plotR);
  return (
    <svg
      className={`pv-overview ${dragging ? "is-dragging" : ""}`}
      width={width}
      height={30}
      aria-hidden="true"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onCentre(toRelease(event));
      }}
      onPointerMove={(event) => {
        if (dragging) onCentre(toRelease(event));
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      {bands.map((band, i) => (
        <rect
          key={band.assembly}
          className={`pv-overview__band ${i % 2 ? "pv-overview__band--b" : ""}`}
          x={base(band.first - 0.5)}
          y={9}
          width={Math.max(0, base(band.last + 0.5) - base(band.first - 0.5))}
          height={12}
        />
      ))}
      {span ? <line className="pv-overview__span" x1={base(span[0])} x2={base(span[1])} y1={15} y2={15} /> : null}
      <rect className="pv-overview__window" x={v0} y={4} width={Math.max(4, v1 - v0)} height={22} rx={3} />
      <text className="pv-overview__label" x={left - 8} y={19} textAnchor="end">
        {range[0]}
      </text>
      <text className="pv-overview__label" x={plotR + 8} y={19}>
        {range[1]}
      </text>
    </svg>
  );
}

function VerticalPath({
  model,
  description,
  names,
  width,
  limit,
  rowsPerLane,
  onDrawn,
  highlight,
  litStep,
  onStepShown,
  readingId,
  lead,
}: DrawingProps) {
  const releases = description.releases;
  const r0 = releases[0] ?? 0;
  const rN = releases[releases.length - 1] ?? 0;
  const [all, setAll] = useState(false);
  const tipId = useId();
  const span = drawnSpan(model, limit) ?? [r0, rN];
  // The pitch of a release: the drawn path's releases take about one screen of a phone (26 px each for a short path,
  // 14 at the least for a long one, where the labels still stand apart on their leaders); the buttons change it.
  const [chosen, setChosen] = useState<number | null>(null);
  const pixels = chosen ?? Math.max(14, Math.min(26, Math.floor(PHONE_AXIS / (span[1] - span[0] + 3))));
  const setPixels = (change: (p: number) => number) => {
    setChosen(change(pixels));
  };
  const a = all ? r0 : Math.max(r0, span[0] - 1);
  const b = all ? rN : Math.min(rN, span[1] + 1);
  const metrics = VERTICAL_METRICS;
  // The timeline starts 16 px under the toolbar; where the walk runs down from the release read (forward), the forms it
  // is read through stand in a staircase above that release, and their room is held.
  const forward = model.result.to_release >= (model.result.from_release ?? model.result.to_release);
  const top = 16 + (forward ? Math.min(4, drawnUpper(model, limit)) * metrics.indent : 0);
  const scale = useMemo(
    () =>
      scaleLinear()
        .domain([a - 0.5, b + 0.5])
        .range([top, top + (b - a + 1) * pixels]),
    [a, b, top, pixels],
  );
  const answerT = top + (b - a + 1) * pixels + 30;
  const left = 46;
  // The lanes stand side by side across the phone: where the best answers alone (a tie of many genes) leave the labels'
  // column less than sixteen characters and the score track, as many of them are drawn as leave it that, the first in
  // the api's order (the line under the drawing says how many; "Draw all" draws every one, and the drawing then
  // scrolls sideways in its frame). Any other drawing keeps the frame's width.
  const need = (l: PathLayout) => Math.ceil(left + l.stackSize + 4 + 44 + 16 * CHAR);
  const { layout, capped } = useMemo(() => {
    const at = (maxBest: number, n: number) =>
      layoutPath(model, { scale: (r) => scale(r), answerT, metrics, limit: n, rowsPerLane, maxBest });
    const whole = at(Number.POSITIVE_INFINITY, limit);
    const bests = model.candidates.filter((c) => c.best).length;
    if (!Number.isFinite(limit) || bests < 2 || need(at(Number.POSITIVE_INFINITY, 0)) <= width)
      return { layout: whole, capped: null };
    let lo = 1;
    let hi = bests - 1;
    let found = { layout: at(1, limit), capped: 1 };
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const l = at(mid, limit);
      if (need(l) <= width) {
        found = { layout: l, capped: mid };
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }, [model, scale, answerT, metrics, limit, rowsPerLane, width]);
  const drawWidth = Number.isFinite(limit) ? width : Math.max(width, need(layout));
  useEffect(() => {
    onDrawn(layout.shown.length, capped);
  }, [layout.shown.length, capped, onDrawn]);
  const toXY = useCallback((t: number, s: number): [number, number] => [s + left, t], []);
  const isStrong = useCallback(
    (candidates: number[], best: boolean) => (highlight === null ? best : candidates.includes(highlight)),
    [highlight],
  );
  const allScored = useMemo(() => scoreSteps(layout, isStrong), [layout, isStrong]);
  // The score track runs down beside the lanes, the labels in a column to its right; where the column would leave a
  // label fewer than sixteen characters, the track gives way (the scores stay in each step's note and the reading).
  const trackX = left + layout.stackSize + 4;
  // The score track is 40 px across, so that its two ends (1.0 and the lowest score drawn) are labelled apart.
  const scored = (drawWidth - trackX - 58) / CHAR >= 16 ? allScored : [];
  // The counts of a split's or a merge's other ids stand beside their glyph, right of the lanes: the labels' column
  // starts after the widest of them (stubCounts: 14 px from the glyph, the count in 10 px type).
  const countRoom = useMemo(() => {
    const most = Math.max(0, ...model.steps.map((st) => Math.max(st.api.splits, st.api.merges)));
    return most ? 14 + textWidth(`+${most}`, 10) + 4 : 0;
  }, [model.steps]);
  const gutter = Math.max(trackX + (scored.length ? 58 : 4), left + layout.stackSize + countRoom + 4);
  const height = answerT + layout.answers.length * 4 + 40;
  const items = useItems(layout, model, names, toXY);
  const keysOf = useMemo(() => nextKeys(model, true), [model]);
  const focus = useFocus(items, tipId, keysOf);
  const shownItem = items.find((i) => i.key === focus.shown) ?? null;
  useStepShown(focus.shown, onStepShown);
  const bands = useMemo(() => assemblyBands(description), [description]);

  // Labels in a column to the right of the lanes, pushed apart where they would overlap, joined by a leader line; a
  // gene after a gene of the same id on its lane is labelled by its version; an id with no room is cut in its middle.
  const labels = useMemo(() => {
    const wanted: { key: string; at: number; x: number; text: string; strong: boolean; kind: string }[] = [];
    const previousOnLane = new Map<number, string>();
    const places = [...layout.nodes.values()].sort((p, q) => p.t0 - q.t0);
    for (const place of places) {
      if (place.node.role === "target") continue;
      const [x, y] = toXY(place.t0, place.s);
      let text = place.node.label;
      if (place.node.role === "gene" && place.lane !== null) {
        text = laneLabel(place.node.label, previousOnLane.get(place.lane) ?? null);
        previousOnLane.set(place.lane, place.node.label);
        // In the labels' column a version is joined to its id (a bare ".2" there names nothing).
        if (text !== place.node.label) text = middleCut(place.node.label, 14) ?? place.node.label;
      }
      wanted.push({ key: place.node.id, x, at: y, text, strong: place.best, kind: place.node.role });
    }
    for (const answer of layout.answers) {
      const [x, y] = toXY(layout.answerT, answer.s);
      wanted.push({
        key: `answer:${answer.candidate.index}`,
        x,
        at: y,
        text: `${answer.candidate.index + 1}  ${answer.candidate.api.target}`,
        strong: answer.candidate.best,
        kind: "answer",
      });
    }
    // The assembly bands are named in the same column, where each band begins.
    for (const band of bands) {
      if (band.last < a || band.first > b) continue;
      const y = scale(Math.max(band.first, a) - 0.5) + 10;
      wanted.push({
        key: `band:${band.assembly}`,
        x: gutter,
        at: y,
        text: `${band.name} ${bandRange(band)}`,
        strong: false,
        kind: "band",
      });
    }
    const room = (drawWidth - gutter - 4) / CHAR;
    const shorts = shortNames(bands.map((band) => band.name));
    const bandText = (band: Band) =>
      [`${band.name} ${bandRange(band)}`, band.name, `${shorts.get(band.name) ?? band.name} ${bandRange(band)}`].find(
        (t) => t.length <= room,
      ) ??
      shorts.get(band.name) ??
      band.name;
    for (const w of wanted) {
      const band = w.kind === "band" ? bands.find((b) => `band:${b.assembly}` === w.key) : undefined;
      if (band) w.text = bandText(band);
    }
    return stackLabels(
      wanted.sort((p, q) => p.at - q.at || (p.kind === "band" ? -1 : q.kind === "band" ? 1 : p.x - q.x)),
      15,
    ).flatMap((w) => {
      const text = middleCut(w.text, Math.floor(room));
      return text === null ? [] : [{ ...w, text }];
    });
  }, [layout, toXY, gutter, drawWidth, bands, scale, a, b]);
  const totalHeight = Math.max(height, (labels[labels.length - 1]?.placed ?? 0) + 30);
  // The timeline draws itself once from the release read toward the answer, and one light travels the chosen path
  // (none under reduced motion).
  const reduced = useMemo(() => {
    const media = (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
    return typeof media === "function" && media.call(window, "(prefers-reduced-motion: reduce)").matches;
  }, []);
  const [revealed, setRevealed] = useState(reduced);
  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => setRevealed(true), LIGHT_MS + 50);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const revealId = useId().replace(/:/g, "");

  return (
    <div className="pv-frame">
      <div className="pv-toolbar">
        {lead}
        <div className="pv-toolbar__tools" role="group" aria-label="Scale of the path">
          <HoverCard
            hover={false}
            className="pv-views"
            triggerClassName="pv-tool pv-views__trigger"
            label="View: the spacing of the releases, and every release"
            trigger={
              <>
                View
                <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
                  <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </>
            }
          >
            <div className="pv-views__list">
              <ZoomButtons
                onOut={() => setPixels((p) => Math.max(10, p - 8))}
                onIn={() => setPixels((p) => Math.min(60, p + 8))}
                out="Close up the releases"
                into="Spread the releases"
              />
              <button
                type="button"
                className="pv-views__item pv-preset"
                aria-pressed={all}
                onClick={() => setAll((v) => !v)}
              >
                All releases
              </button>
            </div>
          </HoverCard>
        </div>
      </div>
      <div className={`pv-canvas${drawWidth > width ? " pv-canvas--wide" : ""}`}>
        <svg
          className="pv-svg pv-svg--vertical"
          width={drawWidth}
          height={totalHeight}
          role="group"
          aria-label={`Path of ${model.result.query_id} from release ${model.result.from_release ?? "—"} to ${model.result.to_release}, as a timeline from top to bottom. Arrow keys move between its elements; the reading below says every step.`}
          aria-describedby={readingId}
        >
          {bands.map((band, i) => {
            if (band.last < a || band.first > b) return null;
            const y0 = scale(Math.max(band.first, a) - 0.5);
            const y1 = scale(Math.min(band.last, b) + 0.5);
            return (
              <g key={band.assembly}>
                <rect
                  className={i % 2 ? "fig-band fig-band--b" : "fig-band"}
                  x={0}
                  y={y0}
                  width={drawWidth}
                  height={Math.max(0, y1 - y0)}
                />
                <line className="fig-band__edge" x1={0} x2={drawWidth} y1={y0} y2={y0} />
              </g>
            );
          })}
          <g className="pv-axis" aria-hidden="true">
            <line className="pv-axis__base" x1={left - 14} x2={left - 14} y1={scale(a - 0.5)} y2={scale(b + 0.5)} />
            {releases.map((r) => {
              if (r < a || r > b) return null;
              const y = scale(r);
              const labelled = pixels >= 16 || r % 5 === 0;
              return (
                <g key={r}>
                  <line x1={left - 14} x2={left - 18} y1={y} y2={y} />
                  {labelled ? (
                    <text x={left - 21} y={y + 4} textAnchor="end">
                      {r}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          {!revealed ? (
            <defs>
              <RevealClip
                id={revealId}
                at={revealStart(
                  scale(model.result.from_release ?? model.result.to_release),
                  (Math.min(4, drawnUpper(model, limit)) + 1) * metrics.indent,
                  model,
                  0,
                  totalHeight,
                )}
                extent={totalHeight}
                across={drawWidth}
                back={!forward}
                vertical
              />
            </defs>
          ) : null}
          <g clipPath={revealed ? undefined : `url(#${revealId})`}>
            <PathMarks
              layout={layout}
              model={model}
              toXY={toXY}
              scale={(r) => scale(r)}
              isStrong={isStrong}
              lit={litStep}
              focus={focus}
              range={[a, b]}
              vertical
              across={[0, drawWidth]}
            />
          </g>
          {!revealed ? <TravellingLight layout={layout} toXY={toXY} scale={(r) => scale(r)} vertical /> : null}
          {scored.length ? (
            <ScoreTrack
              vertical
              items={scored.map(({ edge, weight, hue }) => ({
                key: String(edge.step.index),
                x: toXY(edge.mid.t, edge.mid.s)[1],
                weight,
                hue,
              }))}
              x0={scale(a - 0.5)}
              x1={scale(b + 0.5)}
              top={trackX}
              bottom={trackX + 40}
              labelX={scale(a - 0.5) - 6}
            />
          ) : null}
          <g className="pv-labels" aria-hidden="true">
            {labels.map((l) => (
              <g key={l.key}>
                {l.kind !== "band" && (Math.abs(l.placed - l.at) > 2 || l.x + 8 < gutter) ? (
                  <path className="pv-leader" d={`M${l.x + 6},${l.at}L${gutter - 4},${l.placed}`} />
                ) : null}
                <text
                  className={
                    l.kind === "band"
                      ? "fig-band__name pv-band__label"
                      : `pv-label ${l.strong ? "pv-label--strong" : ""} ${l.kind === "answer" ? "pv-label--answer" : ""}`
                  }
                  x={gutter}
                  y={l.placed + 4}
                >
                  {l.text}
                </text>
              </g>
            ))}
          </g>
          <AnswerColumn
            layout={layout}
            model={model}
            toXY={toXY}
            isStrong={isStrong}
            focus={focus}
            x={answerT}
            width={0}
            vertical
          />
        </svg>
        <Tooltip
          item={shownItem}
          width={width}
          id={tipId}
          pinned={focus.pinned}
          pointer={focus.note}
          mayScroll={!focus.byPointer}
        />
      </div>
    </div>
  );
}

/** The candidates whose paths hold each node (a node is drawn strongly with any of them). */
function useNodeCandidates(model: PathModel): Map<string, number[]> {
  return useMemo(() => {
    const map = new Map<string, number[]>();
    for (const candidate of model.candidates) {
      for (const index of candidate.steps) {
        const step = model.steps[index];
        if (!step) continue;
        for (const id of [step.api.source, step.api.target]) {
          if (id === null) continue;
          const list = map.get(id);
          if (!list) map.set(id, [candidate.index]);
          else if (list[list.length - 1] !== candidate.index) list.push(candidate.index);
        }
      }
      const genes = map.get(candidate.api.gene);
      if (!genes) map.set(candidate.api.gene, [candidate.index]);
      else if (genes[genes.length - 1] !== candidate.index) genes.push(candidate.index);
    }
    return map;
  }, [model]);
}

interface MarksProps {
  layout: PathLayout;
  model: PathModel;
  toXY: (t: number, s: number) => [number, number];
  scale: (r: number) => number;
  isStrong: (candidates: number[], best: boolean) => boolean;
  focus: ReturnType<typeof useFocus>;
  range: [number, number];
  vertical?: boolean;
  /** `main`: everything but the final steps; `final`: the final steps and the ids they pass through, drawn outside the
   *  plot's clip (from the plot's edge where the gene's end is out of view); `all` (the phone's timeline). */
  part?: "main" | "final" | "all";
  /** The plot's extent along time, for the start of a final step whose gene end is out of view. */
  plot?: [number, number];
  /** A step pointed at in the path in words: ringed. */
  lit?: number | null;
  /** The phone's timeline: the drawing's extent across (x), inside which a count's text stands. */
  across?: [number, number];
}

/** Tell the step the drawing shows (pointed at or focused), and that none is shown when it goes. */
function useStepShown(shown: string | null, onStepShown: (index: number | null) => void) {
  const told = useRef(false);
  useEffect(() => {
    if (shown?.startsWith("s:")) {
      told.current = true;
      onStepShown(Number(shown.slice(2)));
    } else if (told.current) {
      told.current = false;
      onStepShown(null);
    }
  }, [shown, onStepShown]);
}

interface StubCount {
  x: number;
  y: number;
  n: number;
  anchor: "start" | "end";
}

/** Along time from an event's glyph: +1 toward later releases (the walk's direction does not change Ensembl's event). */
function alongFrom(x: number, y: number, vertical: boolean) {
  return (dt: number, ds: number): [number, number] => (vertical ? [x + ds, y + dt] : [x + dt, y + ds]);
}

/** The counts of an event's other ids, where they stand: at the end of the fan, above it on a wide drawing, beside it
 *  on a phone's timeline (clear of the lanes). */
function stubCounts(step: ModelStep, x: number, y: number, vertical: boolean): StubCount[] {
  const along = alongFrom(x, y, vertical);
  const out: StubCount[] = [];
  for (const [n, side] of [
    [step.api.splits, 1],
    [step.api.merges, -1],
  ] as const) {
    if (!n) continue;
    const [cx, cy] = vertical ? along(side * 22, 14) : along(side * 25, -10);
    out.push({ x: cx, y: cy, n, anchor: vertical || side > 0 ? "start" : "end" });
  }
  return out;
}

/** The box a count's text takes (10 px of the monospaced face). */
function countBox(c: StubCount): [number, number, number, number] {
  const w = textWidth(`+${c.n}`, 10);
  const x0 = c.anchor === "start" ? c.x : c.x - w;
  return [x0 - 1, c.y - 6, x0 + w + 1, c.y + 6];
}

/** The other ids of a split or a merge, counted by the api and not named: a short stub per id (at most three) leaving
 *  the event's glyph toward the later releases (a split: the earlier id passed to them too) or entering it from the
 *  earlier ones (a merge: they passed to the later id too), with their count at its end where no other count stands.
 *  Drawn in the event's hue; the path in words names them. */
function EventStubs({
  step,
  x,
  y,
  vertical,
  counts,
}: {
  step: ModelStep;
  x: number;
  y: number;
  vertical: boolean;
  counts: StubCount[];
}) {
  const along = alongFrom(x, y, vertical);
  const stubs: string[] = [];
  for (const [n, side] of [
    [step.api.splits, 1],
    [step.api.merges, -1],
  ] as const) {
    for (let i = 0; i < Math.min(3, n); i++) {
      const spread = (Math.floor(i / 2) + 1) * 10;
      const [x1, y1] = along(side * 6, 0);
      const [x2, y2] = along(side * 22, (i % 2 ? 1 : -1) * spread);
      stubs.push(`M${x1},${y1}L${x2},${y2}`);
    }
  }
  return (
    <g className="pv-stubs" aria-hidden="true">
      {stubs.map((d) => (
        <path key={d} d={d} />
      ))}
      {counts.map((c) => (
        <text key={`${c.x}|${c.y}`} className="pv-stubs__count" x={c.x} y={c.y + 3} textAnchor={c.anchor}>
          +{c.n}
        </text>
      ))}
    </g>
  );
}

/** The stubs of every drawn event of Ensembl's history, apart from the steps' focusable marks (counts, not names: no
 *  part of an element's name). The chosen path's first; a count is left out where another stands (two events at one
 *  place: the note and the words have each). */
function EventStubLayer({
  edges,
  toXY,
  vertical,
  isStrong,
  bounds,
}: {
  edges: readonly EdgePlace[];
  toXY: (t: number, s: number) => [number, number];
  vertical: boolean;
  isStrong: (candidates: number[], best: boolean) => boolean;
  /** The plot's extent across the drawing (x): a count that would run out of it is left out. */
  bounds: [number, number] | null;
}) {
  // The events of the path drawn strongly (the chosen path, or the candidate pointed at); the alternatives' events are
  // drawn at their weight by their own marks, their other ids counted in their notes.
  const events = edges
    .filter(
      (e) =>
        marksMiddle(e.step) &&
        isEvent(e.step.api) &&
        (e.step.api.splits || e.step.api.merges) &&
        isStrong(e.step.candidates, e.step.best),
    )
    .map((edge) => ({ edge, at: toXY(edge.mid.t, edge.mid.s) }));
  const placed: [number, number, number, number][] = [];
  const meets = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  return (
    <g className="pv-stub-layer" aria-hidden="true">
      {events.map(({ edge, at: [x, y] }) => {
        // An event's fan is left out where another's stands (several lanes meeting one event at one release).
        const fan: [number, number, number, number] = vertical
          ? [x - 22, y - 26, x + 22, y + 26]
          : [x - 26, y - 22, x + 26, y + 22];
        if (placed.some((p) => meets(p, fan))) return null;
        const counts = stubCounts(edge.step, x, y, vertical).filter((c) => {
          const box = countBox(c);
          if (bounds && (box[0] < bounds[0] || box[2] > bounds[1])) return false;
          if (placed.some((p) => meets(p, box))) return false;
          placed.push(box);
          return true;
        });
        placed.push(fan);
        return <EventStubs key={edge.step.index} step={edge.step} x={x} y={y} vertical={vertical} counts={counts} />;
      })}
    </g>
  );
}

/** A gene's bar along time: from the left edge of its first release's column to the right edge of its last, less
 *  the joint where a step meets it. */
function barExtent(place: NodePlace, scale: (r: number) => number): [number, number] {
  const half = Math.abs(scale(place.node.first + 0.5) - scale(place.node.first)) || 0;
  return [place.t0 - half + JOINT, place.t1 + half - JOINT];
}

/** A step's line, from the end of the bar it leaves to the start of the bar it enters (a step between two genes), or
 *  between the points the layout gives (any other node). */
function edgePath(edge: EdgePlace, layout: PathLayout, scale: (r: number) => number): string {
  const source = edge.step.api.source === null ? undefined : layout.nodes.get(edge.step.api.source);
  const target = layout.nodes.get(edge.step.api.target);
  const half = Math.abs(scale(1) - scale(0.5));
  const from = { ...edge.from };
  const to = { ...edge.to };
  const forward = to.t >= from.t;
  if (source?.node.role === "gene") from.t += (forward ? 1 : -1) * Math.max(0, half - JOINT);
  if (target?.node.role === "gene") to.t -= (forward ? 1 : -1) * Math.max(0, half - JOINT);
  return curve(from, to);
}

function PathMarks({
  layout,
  model,
  toXY,
  scale,
  isStrong,
  focus,
  range,
  vertical = false,
  part = "all",
  plot,
  lit = null,
  across,
}: MarksProps) {
  const swap = vertical ? `translate(${toXY(0, 0)[0]},0) matrix(0,1,1,0,0,0)` : `translate(0,${toXY(0, 0)[1]})`;
  const candidatesOfNode = useNodeCandidates(model);
  const nodeStrong = (place: NodePlace) => isStrong(candidatesOfNode.get(place.node.id) ?? [], place.best);
  const answerNodes = new Set(layout.answers.map((a) => a.nodeId));

  if (part === "final") {
    return (
      <g className="pv-marks pv-marks--final">
        {layout.edges
          .filter((edge) => edge.step.api.kind === "final")
          .map((edge) => {
            const step = edge.step;
            const strong = isStrong(step.candidates, step.best);
            const key = `s:${step.index}` as const;
            const source = step.api.source === null ? undefined : layout.nodes.get(step.api.source);
            const from =
              source?.node.role === "gene" && plot
                ? { t: Math.max(plot[0], Math.min(edge.from.t, plot[1])), s: edge.from.s }
                : edge.from;
            const d = curve(from, edge.to);
            return (
              <g
                key={key}
                {...focus.bind(key)}
                className={`${stepClass(step)} ${strong ? "pv-strong" : "pv-weak"} ${focus.shown === key ? "pv-active" : ""}`}
              >
                <g transform={swap}>
                  <path className="pv-hit" d={d} />
                  <path className="pv-line" d={d} />
                </g>
              </g>
            );
          })}
        {[...layout.nodes.values()]
          .filter((place) => place.node.role === "target" && !answerNodes.has(place.node.id))
          .map((place) => {
            const [x, y] = toXY(place.t0, place.s);
            return (
              <g key={place.node.id} aria-hidden="true">
                <StepGlyph glyph="form" x={x} y={y} size="thin" strong={nodeStrong(place)} />
              </g>
            );
          })}
      </g>
    );
  }

  const edges = layout.edges.filter((edge) => !(part === "main" && edge.step.api.kind === "final"));
  return (
    <g className="pv-marks">
      {/* Life of each gene (the releases it exists, from the api's `active`): a faint track with a cap where it ends. */}
      <g transform={swap} aria-hidden="true">
        {[...layout.nodes.values()]
          .filter((p) => p.node.role === "gene")
          .flatMap((place) =>
            place.node.api.active.map(([first, last], i) => {
              const t0 = scale(Math.max(first, range[0]));
              const end = last ?? range[1];
              const t1 = scale(Math.min(end, range[1]));
              if (first > range[1] || end < range[0]) return null;
              return (
                <g key={`${place.node.id}:${i}`} className="pv-life">
                  <line x1={t0} x2={t1} y1={place.s} y2={place.s} />
                  {last !== null && last <= range[1] && last > place.node.last ? (
                    <line className="pv-life__end" x1={t1} x2={t1} y1={place.s - 6} y2={place.s + 6} />
                  ) : null}
                </g>
              );
            }),
          )}
        {/* A leader from each drawn gene that is its own target to its row in the answer column. */}
        {!vertical
          ? layout.answers.map((answer) => {
              if (answer.candidate.api.final_path.length) return null;
              const place = layout.nodes.get(answer.candidate.api.gene);
              if (!place) return null;
              const end = barExtent(place, scale)[1];
              return (
                <path
                  key={`leader:${answer.candidate.index}`}
                  className={`pv-answer-leader ${isStrong([answer.candidate.index], answer.candidate.best) ? "pv-strong" : "pv-weak"}`}
                  d={`M${end + 4},${place.s}C${(end + layout.answerT) / 2},${place.s} ${(end + layout.answerT) / 2},${answer.s} ${layout.answerT - 8},${answer.s}`}
                />
              );
            })
          : null}
        {/* The lines of the steps that join releases or lanes apart, under the bars. */}
        {edges.map((edge) => {
          if (!edge.d || edge.step.api.kind === "self_loop" || edge.step.api.kind === "identity") return null;
          const strong = isStrong(edge.step.candidates, edge.step.best);
          return (
            <path
              key={`line:${edge.step.index}`}
              className={`${stepClass(edge.step)} pv-line ${strong ? "pv-strong" : "pv-weak"}`}
              d={edgePath(edge, layout, scale)}
            />
          );
        })}
      </g>
      {/* Genes: a bar each, focusable with its exact values. */}
      {[...layout.nodes.values()]
        .filter((p) => p.node.role === "gene")
        .map((place) => {
          const key = `n:${place.node.id}` as const;
          const strong = nodeStrong(place);
          const [b0, b1] = barExtent(place, scale);
          return (
            <g
              key={key}
              {...focus.bind(key)}
              className={`pv-node-group ${strong ? "pv-strong" : "pv-weak"} ${focus.shown === key ? "pv-active" : ""}`}
            >
              <g transform={swap}>
                <rect className="pv-hit-node" x={b0} y={place.s - 12} width={Math.max(12, b1 - b0)} height={24} />
                <GeneBar x0={b0} x1={b1} y={place.s} size={strong ? "thick" : "thin"} strong={strong} />
                {focus.focusedKey === key ? (
                  <rect
                    className="fig-focus"
                    x={b0 - 3}
                    y={place.s - 8}
                    width={Math.max(6, b1 - b0 + 6)}
                    height={16}
                    rx={4}
                  />
                ) : null}
              </g>
            </g>
          );
        })}
      {/* Steps: the glyph of each, over the bars, and its target for focus and pointer (24 px or more). */}
      {edges.map((edge) => {
        const step = edge.step;
        const strong = isStrong(step.candidates, step.best);
        const key = `s:${step.index}` as const;
        const bind = focus.bind(key);
        const active = focus.shown === key;
        const ringed = focus.focusedKey === key;
        const pointed = lit === step.index && !ringed;
        const [mx, my] = toXY(edge.mid.t, edge.mid.s);
        const glyph = stepGlyph(step, model);
        if (step.api.kind === "identity" || !edge.d) {
          const [x, y] = toXY(edge.to.t, edge.to.s);
          return (
            <g
              key={key}
              {...bind}
              className={`${stepClass(step)} ${strong ? "pv-strong" : "pv-weak"} ${active ? "pv-active" : ""}`}
            >
              <circle className="pv-hit-node" cx={x} cy={y} r={12} />
              <StepGlyph glyph="identity" x={x} y={y} strong={strong} />
              {ringed ? <circle className="fig-focus" cx={x} cy={y} r={13} /> : null}
              {pointed ? <circle className="pv-lit" cx={x} cy={y} r={13} /> : null}
            </g>
          );
        }
        const middle = marksMiddle(step);
        return (
          <g
            key={key}
            {...bind}
            className={`${stepClass(step)} ${strong ? "pv-strong" : "pv-weak"} ${active ? "pv-active" : ""}`}
          >
            <g transform={swap}>
              <path className="pv-hit" d={edgePath(edge, layout, scale)} />
            </g>
            <rect className="pv-hit-node" x={mx - 12} y={my - 12} width={24} height={24} />
            {middle ? (
              vertical ? (
                <g transform={`rotate(90 ${mx} ${my})`}>
                  <StepGlyph
                    glyph={glyph}
                    x={mx}
                    y={my}
                    size={strong ? "thick" : "thin"}
                    strong={strong}
                    event={glyph === "handoff" && isEvent(step.api)}
                  />
                </g>
              ) : (
                <StepGlyph
                  glyph={glyph}
                  x={mx}
                  y={my}
                  size={strong ? "thick" : "thin"}
                  strong={strong}
                  event={glyph === "handoff" && isEvent(step.api)}
                />
              )
            ) : null}
            {ringed ? <circle className="fig-focus" cx={mx} cy={my} r={12} /> : null}
            {pointed ? <circle className="pv-lit" cx={mx} cy={my} r={12} /> : null}
          </g>
        );
      })}
      <EventStubLayer
        edges={edges}
        toXY={toXY}
        vertical={vertical}
        isStrong={isStrong}
        bounds={vertical ? (across ?? null) : (plot ?? null)}
      />
      {/* The identifier, the forms it is read through and the ids bridges pass through. */}
      {[...layout.nodes.values()].map((place) => {
        if (place.node.role === "gene") return null;
        if (place.node.role === "target") {
          // An id a final path passes through (the phone's timeline; the wide drawing draws it with the final steps).
          if (part === "main" || answerNodes.has(place.node.id)) return null;
          const [x, y] = toXY(place.t0, place.s);
          return (
            <g key={place.node.id} aria-hidden="true">
              <StepGlyph glyph="form" x={x} y={y} size="thin" strong={nodeStrong(place)} />
            </g>
          );
        }
        const key = `n:${place.node.id}` as const;
        const [x, y] = toXY(place.t0, place.s);
        const strong = nodeStrong(place);
        const glyph: Glyph =
          place.node.role === "bridge"
            ? "bridge"
            : place.node.api.kind === "external" || place.node.api.kind === "synonym"
              ? "read"
              : "form";
        return (
          <g key={key}>
            <g
              {...focus.bind(key)}
              className={`pv-node-group ${strong ? "pv-strong" : "pv-weak"} ${focus.shown === key ? "pv-active" : ""} ${place.node.isQuery ? "pv-query" : ""}`}
            >
              <circle className="pv-hit-node" cx={x} cy={y} r={12} />
              <StepGlyph glyph={glyph} x={x} y={y} strong={strong} />
              {focus.focusedKey === key ? <circle className="fig-focus" cx={x} cy={y} r={11} /> : null}
            </g>
            {!vertical
              ? (() => {
                  // A mark out of the view at this zoom has no label (it is on focus, in the note and the words).
                  if (plot && (x < plot[0] || x > plot[1])) return null;
                  // To the right of the mark where there is room in the plot; else to its left (a path read late in
                  // time).
                  const right = (plot?.[1] ?? layout.answerT - 24) - x - 12;
                  const databases = place.node.isQuery ? place.node.api.databases.map(databaseLabel).join(", ") : "";
                  const needed =
                    textWidth(`${place.node.label}  `) + (databases ? textWidth(` · ${databases}`, 11, "sans") : 0);
                  const before = right < Math.min(needed, 260) && x - 40 > right;
                  return (
                    <text
                      className={`pv-label ${strong ? "pv-label--strong" : ""}`}
                      x={before ? x - 10 : x + 10}
                      y={y + 4}
                      textAnchor={before ? "end" : "start"}
                      aria-hidden="true"
                    >
                      {upperLabel(place, before ? Math.min(x - 40, 420) : right)}
                    </text>
                  );
                })()
              : null}
          </g>
        );
      })}
    </g>
  );
}

/** The second line of an answer in the answer column: the gene's symbol, whether it is best (and what decided), and
 *  its score (cut after six digits; the note holds it whole), as much of it as fits the column, in that order. */
function answerLine(
  c: ModelCandidate,
  { symbol, decided, tiedWith, room }: { symbol: string; decided: string | null; tiedWith: number; room: number },
): string {
  const parts = [
    symbol,
    c.best ? (decided ? `best, by ${decided}` : tiedWith ? `best, tied with ${tiedWith}` : "best") : "",
    `score ${shortScore(c.api.score).text}`,
  ].filter(Boolean);
  while (parts.length > 1 && textWidth(parts.join(" · "), 11, "sans") > room) parts.pop();
  return parts.join(" · ");
}

function AnswerColumn({
  layout,
  model,
  toXY,
  isStrong,
  focus,
  x,
  width,
  vertical = false,
  requestedDatabase = null,
  symbols = null,
}: {
  layout: PathLayout;
  model: PathModel;
  toXY: (t: number, s: number) => [number, number];
  isStrong: (candidates: number[], best: boolean) => boolean;
  focus: ReturnType<typeof useFocus>;
  x: number;
  width: number;
  vertical?: boolean;
  requestedDatabase?: string | null;
  symbols?: Symbols | null;
}) {
  const decision = model.decision;
  return (
    <g className="pv-answers">
      {!vertical ? (
        <>
          <line className="pv-answers__rule" x1={x - 14} x2={x - 14} y1={6} y2={TOP + layout.stackSize} />
          <text className="pv-answers__head" x={x + 6} y={TOP - 26}>
            {`${model.result.no_target ? "Reached" : "Answer"} at ${model.result.to_release}`}
          </text>
          <text className="pv-answers__db" x={x + 6} y={TOP - 12}>
            {wrapWords(
              model.result.no_target
                ? `no ${databaseLabel(requestedDatabase ?? "ensembl_gene")} for the best`
                : databaseLabel(model.result.final_database ?? "ensembl_gene"),
              width - 16,
            ).map((line, i) => (
              <tspan key={i} x={x + 6} dy={i ? 13 : 0}>
                {line}
              </tspan>
            ))}
          </text>
        </>
      ) : null}
      {layout.folded.map((fold) => {
        const [fx, fy] = toXY(layout.answerT, fold.s);
        return (
          <text
            key={`fold:${fold.lane}`}
            className="pv-folded"
            x={vertical ? fx - 6 : fx + 12}
            y={vertical ? fy + 4 : fy + 4}
            aria-hidden="true"
          >
            {vertical ? `+${fold.count}` : `+ ${fold.count} more of this gene (table)`}
          </text>
        );
      })}
      {layout.answers.map((answer) => {
        const c = answer.candidate;
        const key = `a:${c.index}` as const;
        const [ax, ay] = toXY(layout.answerT, answer.s);
        const strong = isStrong([c.index], c.best);
        const room = Math.max(0, width - 46) / CHAR;
        const text = vertical ? null : (fitLabel(c.api.target, room) ?? "…");
        const decided = decision?.best === c;
        const tied = c.best && model.result.tie;
        return (
          <g key={key}>
            <g
              {...focus.bind(key)}
              className={`pv-answer ${strong ? "pv-strong" : "pv-weak"} ${c.best ? "pv-answer--best" : ""} ${focus.shown === key ? "pv-active" : ""}`}
            >
              <rect className="pv-hit-answer" x={ax - 12} y={ay - 12} width={vertical ? 24 : width - 4} height={24} />
              <StepGlyph glyph="final" x={ax} y={ay} strong={c.best} />
              {focus.focusedKey === key ? <circle className="fig-focus" cx={ax} cy={ay} r={10} /> : null}
            </g>
            {!vertical ? (
              <g className="pv-answer__text" aria-hidden="true">
                <text className="pv-answer__rank" x={ax + 12} y={ay + 4}>
                  {c.index + 1}
                </text>
                <text className={`pv-label ${strong ? "pv-label--strong" : ""}`} x={ax + 32} y={ay + 4}>
                  {text}
                </text>
                <text className="pv-decided" x={ax + 32} y={ay + 18}>
                  {answerLine(c, {
                    symbol: (symbols?.of.get(c.api.gene) ?? []).filter((x) => x !== c.api.target).join(", "),
                    decided: decided ? spaced(decision.key) : null,
                    tiedWith: tied ? model.candidates.filter((x) => x.best).length - 1 : 0,
                    room: width - 58,
                  })}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** The legend of the path view: the figure grammar's glyphs, as drawn; the marks this drawing holds, the key to every
 *  mark of the path view on request. */
function PathLegend({ present }: { present?: Set<string> }) {
  const life: ReactNode = (
    <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
      <g className="pv-life">
        <path d="M2,8L26,8" />
        <path className="pv-life__end" d="M26,2L26,14" />
      </g>
    </svg>
  );
  const score: ReactNode = (
    <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
      <line className="fig-score__line" x1={2} x2={28} y1={3} y2={3} />
      <g className="fig-score__stem fig-hue--history">
        <line x1={10} x2={10} y1={3} y2={12} />
        <circle cx={10} cy={12} r={2.4} />
      </g>
      <circle className="fig-score__none" cx={21} cy={3} r={2.6} />
    </svg>
  );
  const dashed: ReactNode = (
    <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
      <path className="pv-line pv-step--external pv-kind--entry_external" d="M2,8L28,8" />
    </svg>
  );
  const entries: LegendEntry[] = [
    { key: "gene", glyph: "gene", text: "An Ensembl gene over the releases the path holds it (chosen path)" },
    {
      key: "weak",
      swatch: (
        <span className="pv-legend-weak">
          <GlyphSwatch glyph="gene-thin" />
        </span>
      ),
      text: "Alternatives considered",
    },
    { key: "version", glyph: "version", text: "A new version or a replacement" },
    { key: "event", glyph: "event", text: "A split or a merge" },
    {
      key: "stubs",
      swatch: (
        <svg width="30" height="16" aria-hidden="true" className="fig-swatch">
          <g className="pv-step--event">
            <g className="pv-stubs">
              <path d="M12,8L24,2" />
              <path d="M12,8L24,14" />
            </g>
            <circle className="pv-legend-dot" cx={10} cy={8} r={3} />
          </g>
        </svg>
      ),
      text: "Other ids of the same split or merge, and how many (counted by the api; named in the words)",
    },
    { key: "loop", glyph: "loop", text: "A re-mapping of a gene to itself" },
    { key: "handoff", glyph: "handoff", text: "A step across an assembly change" },
    { key: "cross", swatch: dashed, text: "Through an external database: read as, a bridge, the target id" },
    { key: "read", glyph: "read", text: "An external id; with a dot: one a bridge passes through" },
    { key: "final", glyph: "final", text: "The answer" },
    { key: "score", swatch: score, text: "Ensembl's score of a step, on the track (open: no score)" },
    { key: "life", swatch: life, text: "Releases the gene exists; the cap is its last" },
  ];
  if (!present) return <FigureLegend label="Legend of the path" entries={entries} />;
  const local = entries.filter((e) => present.has(e.key));
  return (
    <div className="pv-legend">
      <FigureLegend label="Legend of this path" entries={local} />
      {local.length < entries.length ? (
        <details className="pv-legend__all">
          <summary>Key to every mark of the path view</summary>
          <FigureLegend label="Key to every mark of the path view" entries={entries} />
        </details>
      ) : null}
    </div>
  );
}
