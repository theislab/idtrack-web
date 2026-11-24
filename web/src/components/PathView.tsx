// The path view: an identifier's journey through Ensembl's releases, drawn from the api's explained path.
//
// Releases run left to right (top to bottom on a phone) over the assembly bands; each Ensembl gene is a bar over the
// releases the path holds it, on a lane; each step is a line in the hue of its kind; the chosen answer is strong, the
// alternatives the engine considered are light; the answers stand in a column at the end with the deciding criterion.
// Every element is focusable (one tab stop, then the arrow keys) and shows the exact values the api returned.
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import "d3-transition";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GraphDescription } from "../api/types";
import { assemblyBands, tickStep } from "../lib/bands";
import { databaseLabel } from "../lib/databases";
import { shortFloat } from "../lib/numbers";
import {
  fitLabel,
  HORIZONTAL_METRICS,
  layoutPath,
  VERTICAL_METRICS,
  type EdgePlace,
  type NodePlace,
  type PathLayout,
} from "../lib/pathLayout";
import type { ModelCandidate, ModelStep, PathModel } from "../lib/pathModel";
import { candidateTitle, nodeFacts, stepFacts, type AssemblyNames } from "../lib/pathReading";
import { criterionValue, yesNo } from "../lib/values";
import { spaced, type Vocabulary } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";

import { Button } from "./ui";

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
const CHAR = 6.7; // width of a character of the 11px monospaced face
const AXIS = 60; // the release axis and the band names (horizontal), or the axis's width (vertical)
const LIMIT_WIDE = 10;
const LIMIT_PHONE = 4;

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
  return spaced(step.api.reason);
}

/** The kind of a step for a class name (its hue and dash). */
function stepClass(step: ModelStep): string {
  return `pv-step pv-step--${step.hue} pv-kind--${step.kind}`;
}

export interface PathViewProps {
  model: PathModel;
  description: GraphDescription;
  names: AssemblyNames;
  /** A candidate to show strongly (from the table of candidates), or null. */
  highlight: number | null;
  /** The id of the text reading beside the drawing (its accessible description). */
  readingId: string;
  /** The database the conversion asked for (`null`: Ensembl genes). */
  requestedDatabase: string | null;
}

export function PathView({ model, description, names, highlight, readingId, requestedDatabase }: PathViewProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const vertical = width > 0 && width < PHONE_WIDTH;
  const [showAll, setShowAll] = useState(false);
  const limit = showAll ? Number.POSITIVE_INFINITY : vertical ? LIMIT_PHONE : LIMIT_WIDE;

  return (
    <div className="pv" ref={wrapper}>
      {width === 0 ? null : vertical ? (
        <VerticalPath
          model={model}
          description={description}
          names={names}
          width={width}
          limit={limit}
          highlight={highlight}
          readingId={readingId}
          requestedDatabase={requestedDatabase}
        />
      ) : (
        <HorizontalPath
          model={model}
          description={description}
          names={names}
          width={width}
          limit={limit}
          highlight={highlight}
          readingId={readingId}
          requestedDatabase={requestedDatabase}
        />
      )}
      {model.candidates.length > (vertical ? LIMIT_PHONE : LIMIT_WIDE) ? (
        <p className="pv__more">
          {showAll
            ? `All ${model.candidates.length} candidates are drawn.`
            : `${Math.min(model.candidates.length, vertical ? LIMIT_PHONE : LIMIT_WIDE)} of ${model.candidates.length} candidates are drawn (the best and the next in rank); the reading and the table list all.`}{" "}
          <Button variant="quiet" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Draw fewer" : `Draw all ${model.candidates.length}`}
          </Button>
        </p>
      ) : null}
      <PathLegend />
    </div>
  );
}

interface DrawingProps {
  model: PathModel;
  description: GraphDescription;
  names: AssemblyNames;
  width: number;
  limit: number;
  highlight: number | null;
  readingId: string;
  requestedDatabase: string | null;
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
        label: `${place.node.api.label}: ${facts.map(([k, v]) => `${k} ${v}`).join("; ")}`,
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
            label: `Step ${index}: ${facts.map(([k, v]) => `${k} ${v}`).join("; ")}`,
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
        label: `${candidateTitle(answer.candidate)}: ${facts.map(([k, v]) => `${k} ${v}`).join("; ")}`,
      });
    }
    return list;
  }, [layout, model, names, toXY, vocabulary]);
  return items;
}

function Tooltip({ item, width, id, pinned }: { item: Item | null; width: number; id: string; pinned: boolean }) {
  if (!item) return null;
  const left = Math.min(Math.max(8, item.x + 14), Math.max(8, width - 336));
  return (
    <div className="pv-tip" id={id} role="tooltip" style={{ left, top: item.y + 16 }}>
      <p className="pv-tip__title">{item.title}</p>
      <dl className="pv-tip__facts">
        {item.facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {pinned ? <p className="pv-tip__hint">Pinned · Esc to close</p> : null}
    </div>
  );
}

/** Keyboard and pointer focus over the items: one tab stop, arrows move, Enter pins, Escape closes. */
function useFocus(items: Item[]) {
  const [active, setActive] = useState<ItemKey | null>(null);
  const [hover, setHover] = useState<ItemKey | null>(null);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const refs = useRef(new Map<string, SVGGElement>());
  // The tab stop: the element last focused while it is still drawn, else the first (a zoom or "draw all" can remove it).
  const current = active !== null && items.some((i) => i.key === active) ? active : (items[0]?.key ?? null);
  const shown = hover ?? (focused || pinned ? current : null);
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
        ArrowRight: () => move(index + 1),
        ArrowDown: () => move(index + 1),
        ArrowLeft: () => move(index - 1),
        ArrowUp: () => move(index - 1),
        Home: () => move(0),
        End: () => move(items.length - 1),
        Enter: () => setPinned((p) => !p),
        " ": () => setPinned((p) => !p),
        Escape: () => {
          setPinned(false);
          setHover(null);
        },
      };
      const action = keys[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    },
    [items, current, move],
  );
  const bind = (key: ItemKey) => ({
    ref: (element: SVGGElement | null) => {
      if (element) refs.current.set(key, element);
      else refs.current.delete(key);
    },
    tabIndex: key === current ? 0 : -1,
    onFocus: () => {
      setActive(key);
      setFocused(true);
    },
    onBlur: () => setFocused(false),
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover(null),
    onClick: () => {
      setActive(key);
      setPinned(true);
      refs.current.get(key)?.focus();
    },
    onKeyDown,
  });
  return { shown, pinned, onKeyDown, bind, current };
}

/** The label of the identifier or a form it is read through, with the identifier's databases where they fit. */
function upperLabel(place: NodePlace, room: number) {
  const label = fitLabel(place.node.label, null, room, CHAR) ?? "…";
  const databases = place.node.isQuery ? place.node.api.databases.map(databaseLabel) : [];
  let left = room - label.length * CHAR - 16;
  const shown: string[] = [];
  for (const database of databases) {
    const cost = (database.length + 2) * 5.6;
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

function edgeMarks(edge: EdgePlace, toXY: (t: number, s: number) => [number, number], strong: boolean) {
  const step = edge.step;
  const [mx, my] = toXY(edge.mid.t, edge.mid.s);
  const marks = [];
  if (step.handoff) {
    marks.push(
      <path
        key="handoff"
        className="pv-handoff"
        d={`M${mx},${my - 5}L${mx + 5},${my}L${mx},${my + 5}L${mx - 5},${my}Z`}
      />,
    );
  }
  if (step.kind === "split_merge") {
    marks.push(<circle key="event" className="pv-event-dot" cx={mx} cy={my} r={strong ? 3 : 2.5} />);
  }
  return marks;
}

/** The score written on a step where it fits (shortened; the exact value is in the step's facts), or null. */
function weightText(edge: EdgePlace, room: number): string | null {
  const weight = edge.step.api.weight;
  if (weight === null || weight === 1) return null;
  const short = shortFloat(weight, 3);
  return short.text.length * CHAR * 0.9 > room ? null : short.text;
}

function weightLabel(edge: EdgePlace, toXY: (t: number, s: number) => [number, number], text: string) {
  const [x, y] = toXY(edge.mid.t, edge.mid.s);
  return (
    <text className="pv-weight" x={x} y={y - 8} textAnchor="middle">
      {text}
    </text>
  );
}

function HorizontalPath({
  model,
  description,
  names,
  width,
  limit,
  highlight,
  readingId,
  requestedDatabase,
}: DrawingProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const tipId = useId();
  const clipId = useId().replace(/:/g, "");
  const releases = description.releases;
  const r0 = releases[0] ?? 0;
  const rN = releases[releases.length - 1] ?? 0;
  const answerWidth = Math.min(300, Math.max(210, width * 0.22));
  const metrics = HORIZONTAL_METRICS;
  const upperRoom = (model.nodes.filter((n) => n.role === "upper").length + 1) * metrics.indent;
  const plotL = 24 + upperRoom;
  const plotR = width - answerWidth - 28;
  const base = useMemo(
    () =>
      scaleLinear()
        .domain([r0 - 0.5, rN + 0.5])
        .range([plotL, plotR]),
    [r0, rN, plotL, plotR],
  );
  const scale = useMemo(() => transform.rescaleX(base), [transform, base]);
  const answerT = width - answerWidth;
  const layout = useMemo(
    () => layoutPath(model, { scale: (r) => scale(r), answerT, metrics, limit }),
    [model, scale, answerT, metrics, limit],
  );
  const height = AXIS + layout.stackSize + 8;
  const toXY = useCallback((t: number, s: number): [number, number] => [t, s + AXIS], []);
  const items = useItems(layout, model, names, toXY);
  const focus = useFocus(items);
  const shownItem = items.find((i) => i.key === focus.shown) ?? null;

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
      .on("zoom", (event: { transform: ZoomTransform }) => setTransform(event.transform));
    zoomRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, [plotL, plotR, height, r0, rN]);

  const fit = useCallback(
    (animate: boolean) => {
      const svg = svgRef.current;
      const behavior = zoomRef.current;
      if (!svg || !behavior) return;
      // A window over the path's releases with a release of room on each side, at least ten releases wide, inside
      // the graph's releases (d3's programmatic transform does not keep it inside by itself).
      const span = model.span ?? [r0, rN];
      const full = rN - r0 + 1;
      const width = Math.min(full, Math.max(10, span[1] - span[0] + 3));
      let a = (span[0] + span[1]) / 2 - width / 2;
      a = Math.min(Math.max(a, r0 - 0.5), rN + 0.5 - width);
      const k = full / width;
      // The zoomed position of a release is k * base(release) + x: put the path's first release at the plot's left.
      const target = zoomIdentity.translate(plotL - k * base(a), 0).scale(k);
      const selection = select(svg);
      if (animate)
        selection
          .transition()
          .duration(350)
          .call((t) => behavior.transform(t, target));
      else behavior.transform(selection, target);
    },
    [model.span, r0, rN, base, plotL],
  );
  useEffect(() => {
    fit(false);
  }, [fit]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior)
      select(svg)
        .transition()
        .duration(250)
        .call((t) => behavior.scaleBy(t, factor));
  };
  const showEverything = () => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (svg && behavior)
      select(svg)
        .transition()
        .duration(350)
        .call((t) => behavior.transform(t, zoomIdentity));
  };

  const ppr = Math.abs(scale(1) - scale(0));
  const step = tickStep(ppr);
  const bands = useMemo(() => assemblyBands(description), [description]);
  const isStrong = (candidates: number[], best: boolean) =>
    highlight === null ? best : candidates.includes(highlight);

  // Labels of genes: above the bar, or below it where the label before still takes the room above; cut in the middle
  // only when neither side has room (the full id is always on focus).
  const geneLabels = useMemo(() => {
    const byLane = new Map<number, NodePlace[]>();
    for (const place of layout.nodes.values()) {
      // Genes, and the ids a bridge passes through (on the lane of the gene it leaves), share a lane's label room.
      if ((place.node.role !== "gene" && place.node.role !== "bridge") || place.lane === null) continue;
      byLane.set(place.lane, [...(byLane.get(place.lane) ?? []), place]);
    }
    const labels: { place: NodePlace; text: string | null; below: boolean; before: boolean }[] = [];
    const left = plotL - upperRoom;
    for (const places of byLane.values()) {
      places.sort((a, b) => a.t0 - b.t0);
      let aboveEnd = -Infinity;
      let belowEnd = -Infinity;
      places.forEach((place, i) => {
        const x = place.t0 - 3;
        const limit = plotR + 4;
        const full = place.node.label;
        const previous = places[i - 1]?.node.label ?? null;
        if (i === 0 && x + full.length * CHAR > limit && x - full.length * CHAR - 8 >= left) {
          // The first gene of a lane, near the end of the releases: its label before it, where the lane is empty.
          labels.push({ place, text: full, below: false, before: true });
        } else if (x >= aboveEnd && x + full.length * CHAR <= limit) {
          labels.push({ place, text: full, below: false, before: false });
          aboveEnd = x + full.length * CHAR + 8;
        } else if (x >= belowEnd && x + full.length * CHAR <= limit) {
          labels.push({ place, text: full, below: true, before: false });
          belowEnd = x + full.length * CHAR + 8;
        } else {
          // A label is never drawn over another: the free side, cut to the room before the next gene; where both
          // sides are taken, the id is on focus and in the reading.
          const below = x < aboveEnd;
          const next = places[i + 1];
          const room = Math.min(limit, next ? next.t0 : limit) - x - 6;
          const text = x < aboveEnd && x < belowEnd ? null : fitLabel(full, previous, room, CHAR);
          labels.push({ place, text, below, before: false });
          if (text) {
            if (below) belowEnd = x + text.length * CHAR + 8;
            else aboveEnd = x + text.length * CHAR + 8;
          }
        }
      });
    }
    return labels;
  }, [layout, plotR, plotL, upperRoom]);

  return (
    <div className="pv-frame">
      <div className="pv-toolbar" role="toolbar" aria-label="Zoom of the path">
        <Button variant="quiet" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          ＋
        </Button>
        <Button variant="quiet" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </Button>
        <Button variant="quiet" onClick={() => fit(true)}>
          Fit the path
        </Button>
        <Button variant="quiet" onClick={showEverything}>
          All releases
        </Button>
        <span className="pv-toolbar__hint">Drag to pan · ctrl or shift + wheel to zoom</span>
      </div>
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
              <rect x={plotL - upperRoom} y={0} width={plotR - plotL + upperRoom + 6} height={height} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {bands.map((band, i) => {
              const x0 = scale(band.first - 0.5);
              const x1 = scale(band.last + 0.5);
              const label = `${band.name} · ${band.first}–${band.last}`;
              const visible = Math.min(x1, plotR) - Math.max(x0, plotL - upperRoom);
              const text =
                label.length * 6.6 < visible - 12 ? label : band.name.length * 6.6 < visible - 12 ? band.name : null;
              return (
                <g key={band.assembly} className={`pv-band ${i % 2 ? "pv-band--b" : "pv-band--a"}`}>
                  <rect x={x0} y={0} width={Math.max(0, x1 - x0)} height={height} />
                  {i > 0 ? <line className="pv-band__edge" x1={x0} x2={x0} y1={0} y2={height} /> : null}
                  {text ? (
                    <text className="pv-band__label" x={Math.max(x0, plotL - upperRoom) + 6} y={14}>
                      {text}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <g className="pv-axis" aria-hidden="true">
              <line x1={plotL - upperRoom} x2={plotR} y1={AXIS - 22} y2={AXIS - 22} />
              {releases.map((r) => {
                const x = scale(r);
                if (x < plotL - upperRoom - 2 || x > plotR + 2) return null;
                const labelled = r % step === 0 || step === 1;
                return (
                  <g key={r}>
                    <line x1={x} x2={x} y1={AXIS - 22} y2={AXIS - (labelled ? 28 : 25)} />
                    {labelled ? (
                      <text x={x} y={AXIS - 32} textAnchor="middle">
                        {r}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
            <PathMarks
              layout={layout}
              model={model}
              toXY={toXY}
              scale={scale}
              isStrong={isStrong}
              focus={focus}
              range={[r0, rN]}
              geneLabels={geneLabels}
            />
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
          />
        </svg>
        <Tooltip item={shownItem} width={width} id={tipId} pinned={focus.pinned} />
      </div>
    </div>
  );
}

function VerticalPath({ model, description, names, width, limit, highlight, readingId }: DrawingProps) {
  const releases = description.releases;
  const r0 = releases[0] ?? 0;
  const rN = releases[releases.length - 1] ?? 0;
  const [pixels, setPixels] = useState(26);
  const [all, setAll] = useState(false);
  const tipId = useId();
  const span = model.span ?? [r0, rN];
  const a = all ? r0 : Math.max(r0, span[0] - 1);
  const b = all ? rN : Math.min(rN, span[1] + 1);
  const metrics = VERTICAL_METRICS;
  const upperCount = model.nodes.filter((n) => n.role === "upper").length;
  const top = 24 + upperCount * metrics.indent;
  const scale = useMemo(
    () =>
      scaleLinear()
        .domain([a - 0.5, b + 0.5])
        .range([top, top + (b - a + 1) * pixels]),
    [a, b, top, pixels],
  );
  const answerT = top + (b - a + 1) * pixels + 30;
  const layout = useMemo(
    () => layoutPath(model, { scale: (r) => scale(r), answerT, metrics, limit }),
    [model, scale, answerT, metrics, limit],
  );
  const left = 46;
  const toXY = useCallback((t: number, s: number): [number, number] => [s + left, t], []);
  const gutter = left + layout.stackSize + 6;
  const height = answerT + layout.answers.length * 4 + 40;
  const items = useItems(layout, model, names, toXY);
  const focus = useFocus(items);
  const shownItem = items.find((i) => i.key === focus.shown) ?? null;
  const bands = useMemo(() => assemblyBands(description), [description]);
  const isStrong = (candidates: number[], best: boolean) =>
    highlight === null ? best : candidates.includes(highlight);

  // Labels in a column to the right of the lanes, pushed apart where they would overlap, joined by a leader line.
  const labels = useMemo(() => {
    const wanted: { key: string; y: number; x: number; text: string; strong: boolean; kind: string }[] = [];
    for (const place of layout.nodes.values()) {
      if (place.node.role === "target") continue;
      const [x, y] = toXY(place.t0, place.s);
      wanted.push({ key: place.node.id, x, y, text: place.node.label, strong: place.best, kind: place.node.role });
    }
    for (const answer of layout.answers) {
      const [x, y] = toXY(layout.answerT, answer.s);
      wanted.push({
        key: `answer:${answer.candidate.index}`,
        x,
        y,
        text: `${answer.candidate.index + 1}  ${answer.candidate.api.target}`,
        strong: answer.candidate.best,
        kind: "answer",
      });
    }
    // The assembly bands are named in the same column, where each band begins.
    for (const band of bands) {
      if (band.last < a || band.first > b) continue;
      const y = scale(Math.max(band.first, a) - 0.5) + 10;
      wanted.push({ key: `band:${band.assembly}`, x: gutter, y, text: band.name, strong: false, kind: "band" });
    }
    wanted.sort((p, q) => p.y - q.y || (p.kind === "band" ? -1 : q.kind === "band" ? 1 : p.x - q.x));
    let floor = -Infinity;
    const room = width - gutter - 8;
    return wanted.map((w) => {
      const y = Math.max(w.y, floor + 15);
      floor = y;
      return { ...w, labelY: y, text: fitLabel(w.text, null, room, 6.3) ?? "…" };
    });
  }, [layout, toXY, gutter, width, bands, scale, a, b]);
  const totalHeight = Math.max(height, (labels[labels.length - 1]?.labelY ?? 0) + 30);

  return (
    <div className="pv-frame">
      <div className="pv-toolbar" role="toolbar" aria-label="Scale of the path">
        <Button variant="quiet" onClick={() => setPixels((p) => Math.min(60, p + 8))} aria-label="Spread the releases">
          ＋
        </Button>
        <Button
          variant="quiet"
          onClick={() => setPixels((p) => Math.max(10, p - 8))}
          aria-label="Close up the releases"
        >
          −
        </Button>
        <Button variant="quiet" onClick={() => setAll((v) => !v)}>
          {all ? "The path's releases" : "All releases"}
        </Button>
      </div>
      <div className="pv-canvas">
        <svg
          className="pv-svg"
          width={width}
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
              <g key={band.assembly} className={`pv-band ${i % 2 ? "pv-band--b" : "pv-band--a"}`}>
                <rect x={0} y={y0} width={width} height={Math.max(0, y1 - y0)} />
                <line className="pv-band__edge" x1={0} x2={width} y1={y0} y2={y0} />
              </g>
            );
          })}
          <g className="pv-axis" aria-hidden="true">
            <line x1={left - 14} x2={left - 14} y1={scale(a - 0.5)} y2={scale(b + 0.5)} />
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
          <PathMarks
            layout={layout}
            model={model}
            toXY={toXY}
            scale={(r) => scale(r)}
            isStrong={isStrong}
            focus={focus}
            range={[a, b]}
            geneLabels={[]}
            vertical
          />
          <g className="pv-labels" aria-hidden="true">
            {labels.map((l) => (
              <g key={l.key}>
                {l.kind !== "band" && (Math.abs(l.labelY - l.y) > 2 || l.x + 8 < gutter) ? (
                  <path className="pv-leader" d={`M${l.x + 6},${l.y}L${gutter - 4},${l.labelY}`} />
                ) : null}
                <text
                  className={
                    l.kind === "band"
                      ? "pv-band__label"
                      : `pv-label ${l.strong ? "pv-label--strong" : ""} ${l.kind === "answer" ? "pv-label--answer" : ""}`
                  }
                  x={gutter}
                  y={l.labelY + 4}
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
        <Tooltip item={shownItem} width={width} id={tipId} pinned={focus.pinned} />
      </div>
    </div>
  );
}

interface MarksProps {
  layout: PathLayout;
  model: PathModel;
  toXY: (t: number, s: number) => [number, number];
  scale: (r: number) => number;
  isStrong: (candidates: number[], best: boolean) => boolean;
  focus: ReturnType<typeof useFocus>;
  range: [number, number];
  geneLabels: { place: NodePlace; text: string | null; below: boolean; before: boolean }[];
  vertical?: boolean;
}

function PathMarks({ layout, model, toXY, scale, isStrong, focus, range, geneLabels, vertical = false }: MarksProps) {
  const swap = vertical ? `translate(${toXY(0, 0)[0]},0) matrix(0,1,1,0,0,0)` : `translate(0,${toXY(0, 0)[1]})`;
  const candidatesOfNode = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const candidate of model.candidates) {
      for (const index of candidate.steps) {
        const step = model.steps[index];
        if (!step) continue;
        for (const id of [step.api.source, step.api.target]) {
          if (id !== null) map.set(id, [...(map.get(id) ?? []), candidate.index]);
        }
      }
      map.set(candidate.api.gene, [...(map.get(candidate.api.gene) ?? []), candidate.index]);
    }
    return map;
  }, [model]);
  const nodeStrong = (place: NodePlace) => isStrong(candidatesOfNode.get(place.node.id) ?? [], place.best);

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
                  {last !== null && last <= range[1] ? (
                    <line className="pv-life__end" x1={t1} x2={t1} y1={place.s - 5} y2={place.s + 5} />
                  ) : null}
                </g>
              );
            }),
          )}
        {[...layout.nodes.values()]
          .filter((p) => p.node.role === "gene")
          .map((place) => (
            <line
              key={place.node.id}
              className={`pv-bar ${nodeStrong(place) ? "pv-strong" : "pv-weak"}`}
              x1={place.t0}
              x2={place.t1}
              y1={place.s}
              y2={place.s}
            />
          ))}
      </g>
      {/* Steps */}
      {layout.edges.map((edge) => {
        const step = edge.step;
        const strong = isStrong(step.candidates, step.best);
        const key = `s:${step.index}` as const;
        const bind = focus.bind(key);
        const active = focus.shown === key;
        const [x, y] = toXY(edge.to.t, edge.to.s);
        if (step.api.kind === "identity" || !edge.d) {
          return (
            <g
              key={key}
              {...bind}
              role="button"
              aria-label={`${stepLabel(step)}: ${step.api.target} exists at release ${model.result.to_release}`}
              className={`${stepClass(step)} ${strong ? "pv-strong" : "pv-weak"} ${active ? "pv-active" : ""}`}
            >
              <circle className="pv-identity" cx={x} cy={y} r={8} />
            </g>
          );
        }
        const room = Math.abs(edge.to.t - edge.from.t);
        // The score written on the line is part of the step's name, as it is part of what is seen.
        const written = !vertical && strong ? weightText(edge, room) : null;
        return (
          <g
            key={key}
            {...bind}
            role="button"
            aria-label={`Step ${step.index + 1}: ${stepLabel(step)}, ${step.api.source ?? ""} to ${step.api.target}${written ? `, score ${written}` : ""}`}
            className={`${stepClass(step)} ${strong ? "pv-strong" : "pv-weak"} ${active ? "pv-active" : ""}`}
          >
            <g transform={swap}>
              <path className="pv-hit" d={edge.d} />
              <path className="pv-line" d={edge.d} />
            </g>
            {edgeMarks(edge, toXY, strong)}
            {written ? weightLabel(edge, toXY, written) : null}
          </g>
        );
      })}
      {/* Nodes */}
      {[...layout.nodes.values()].map((place) => {
        if (place.node.role === "target") return null;
        const key = `n:${place.node.id}` as const;
        const [x, y] = toXY(place.t0, place.s);
        const strong = nodeStrong(place);
        const shape =
          place.node.role === "gene" ? (
            <circle className="pv-node pv-node--gene" cx={x} cy={y} r={4.5} />
          ) : place.node.role === "bridge" ? (
            <path className="pv-node pv-node--bridge" d={`M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z`} />
          ) : place.node.api.kind === "external" || place.node.api.kind === "synonym" ? (
            <rect className="pv-node pv-node--external" x={x - 4.5} y={y - 4.5} width={9} height={9} />
          ) : (
            <circle className="pv-node pv-node--form" cx={x} cy={y} r={4} />
          );
        return (
          <g key={key}>
            <g
              {...focus.bind(key)}
              role="button"
              aria-label={`${place.node.api.label} (${place.node.api.kind})${place.node.isQuery ? ", the identifier as read" : ""}`}
              className={`pv-node-group ${strong ? "pv-strong" : "pv-weak"} ${focus.shown === key ? "pv-active" : ""} ${place.node.isQuery ? "pv-query" : ""}`}
            >
              <circle className="pv-hit-node" cx={x} cy={y} r={11} />
              {shape}
            </g>
            {!vertical && place.node.role === "upper"
              ? (() => {
                  // To the right of the mark where there is room; else to its left (a path read late in time).
                  const right = layout.answerT - x - 24;
                  const databases = place.node.isQuery ? place.node.api.databases.map(databaseLabel).join(", ") : "";
                  const needed = (place.node.label.length + 2) * CHAR + (databases ? (databases.length + 3) * 5.6 : 0);
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
      {!vertical
        ? geneLabels.map(({ place, text, below, before }) => {
            if (text === null) return null;
            const [x, y] = toXY(place.t0, place.s);
            return (
              <text
                key={`label:${place.node.id}`}
                className={`pv-label ${nodeStrong(place) ? "pv-label--strong" : ""}`}
                x={before ? x - 10 : x - 3}
                y={below ? y + 17 : before ? y + 4 : y - 9}
                textAnchor={before ? "end" : "start"}
                aria-hidden="true"
              >
                {text}
              </text>
            );
          })
        : null}
    </g>
  );
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
}) {
  const decision = model.decision;
  return (
    <g className="pv-answers">
      {!vertical ? (
        <>
          <text className="pv-answers__head" x={x + 6} y={AXIS - 34}>
            {model.result.no_target ? "REACHED" : "ANSWERS"}
          </text>
          <text className="pv-answers__db" x={x + 6} y={AXIS - 20}>
            {fitLabel(
              model.result.no_target
                ? `no ${databaseLabel(requestedDatabase ?? "ensembl_gene")} for the best`
                : databaseLabel(model.result.final_database ?? "ensembl_gene"),
              null,
              width - 12,
              6.2,
            ) ?? ""}
          </text>
        </>
      ) : null}
      {layout.answers.map((answer) => {
        const c = answer.candidate;
        const key = `a:${c.index}` as const;
        const [ax, ay] = toXY(layout.answerT, answer.s);
        const strong = isStrong([c.index], c.best);
        const room = Math.max(0, width - 46);
        const text = vertical ? null : (fitLabel(c.api.target, null, room, CHAR) ?? "…");
        const decided = decision?.best === c;
        return (
          <g key={key}>
            <g
              {...focus.bind(key)}
              role="button"
              aria-label={`${candidateTitle(c)}${decided ? `, decided by ${decision.key}` : ""}`}
              className={`pv-answer ${strong ? "pv-strong" : "pv-weak"} ${c.best ? "pv-answer--best" : ""} ${focus.shown === key ? "pv-active" : ""}`}
            >
              <rect className="pv-hit-answer" x={ax - 8} y={ay - 10} width={vertical ? 16 : width - 4} height={20} />
              <rect className="pv-node pv-node--target" x={ax - 4.5} y={ay - 4.5} width={9} height={9} />
            </g>
            {!vertical ? (
              <g className="pv-answer__text" aria-hidden="true">
                <text className="pv-answer__rank" x={ax + 12} y={ay + 4}>
                  {c.index + 1}
                </text>
                <text className={`pv-label ${strong ? "pv-label--strong" : ""}`} x={ax + 32} y={ay + 4}>
                  {text}
                </text>
                {decided ? (
                  <text className="pv-decided" x={ax + 32} y={ay + 18}>
                    {`decided by ${spaced(decision.key)}`}
                  </text>
                ) : null}
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export function PathLegend() {
  const swatch = (className: string, mark?: "dot" | "diamond") => (
    <svg width="36" height="14" aria-hidden="true" className="legend__swatch">
      <path className={`pv-line ${className}`} d="M2,7L34,7" />
      {mark === "dot" ? <circle className="pv-event-dot" cx="18" cy="7" r="3" /> : null}
      {mark === "diamond" ? <path className="pv-handoff" d="M18,2L23,7L18,12L13,7Z" /> : null}
    </svg>
  );
  return (
    <ul className="legend" aria-label="Legend of the path">
      <li className="pv-step--history">{swatch("")}History: a new version, a replacement, a re-mapping</li>
      <li className="pv-step--event">{swatch("", "dot")}History: a split or a merge (score above the line)</li>
      <li className="pv-step--external pv-kind--entry_external">
        {swatch("")}Through an external database: read as, a bridge, the target id
      </li>
      <li className="pv-step--history">{swatch("", "diamond")}Assembly handoff on the step</li>
      <li className="legend__plain">
        <svg width="36" height="14" aria-hidden="true" className="legend__swatch">
          <path className="pv-bar pv-strong" d="M2,7L34,7" />
        </svg>
        Chosen path
      </li>
      <li className="legend__plain">
        <svg width="36" height="14" aria-hidden="true" className="legend__swatch">
          <path className="pv-bar pv-weak" d="M2,7L34,7" />
        </svg>
        Alternatives considered
      </li>
      <li className="legend__plain">
        <svg width="36" height="14" aria-hidden="true" className="legend__swatch">
          <g className="pv-life">
            <path d="M2,7L30,7" />
            <path className="pv-life__end" d="M30,2L30,12" />
          </g>
        </svg>
        Releases the gene exists; the cap is its last, read from its active releases (not a retirement step)
      </li>
    </ul>
  );
}
