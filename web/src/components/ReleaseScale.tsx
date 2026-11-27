// The small release figures of the batch and names pages: a scale of the graph's releases with the assemblies that
// serve them, a lane that fills the releases at which something holds, and bars of counts per release. Each release is
// one cell of equal width (src/lib/releaseAxis.ts); labels are placed by the room measured, never cut.
import { useLayoutEffect, type ReactNode } from "react";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { placeLabels as place, textWidth, type PlacedLabel } from "./figure/labels";
import { bandRange, shortNames, tickLabels, type Axis, type AxisBand as Band, type Run } from "./figure/releases";
import { useWidth } from "./figure/useWidth";

const pct = (fraction: number) => `${(fraction * 100).toFixed(4)}%`;

/** How wide a label of the scale is (its monospaced 11 px text, with a little room). */
const labelWidth = (text: string) => textWidth(text) + 6;

export interface ScaleMark {
  release: number;
  label: string;
  /** `target`: a line drawn strong; `run`: the edge of a highlighted run. */
  kind: "target" | "run";
}

const NO_MARKS: readonly ScaleMark[] = [];
const NO_RUNS: readonly Run[] = [];

/** The scale above a figure: the assemblies serving each release (bands, named where they have room), every release
 *  as a tick, the labelled releases, and marks (the target release, the edges of the runs pointed at). */
export function ReleaseScale({
  axis,
  bands,
  marks = NO_MARKS,
  highlight = NO_RUNS,
  label,
  position = "above",
}: {
  axis: Axis;
  bands: Band[];
  marks?: readonly ScaleMark[];
  /** Runs drawn over the scale (those of a lane pointed at), with their first and last release named. */
  highlight?: readonly Run[];
  label?: string;
  /** Above a figure (band names first) or below a plot (ticks first). */
  position?: "above" | "below";
}) {
  const { ref, width } = useWidth<HTMLDivElement>(0);
  const n = axis.releases.length;
  const perRelease = n ? width / n : 0;
  const gap = perRelease ? Math.max(2, Math.ceil(labelWidth("000") / perRelease)) : 10;
  const labels = width ? tickLabels(axis, gap) : [];
  const edges = highlight.flatMap((run) =>
    run.first === run.last
      ? [{ release: run.first, at: run.left + run.width / 2 }]
      : [
          { release: run.first, at: run.left + 0.5 / n },
          { release: run.last, at: run.left + run.width - 0.5 / n },
        ],
  );
  const at = (release: number) => ((axis.index.get(release) ?? 0) + 0.5) / n;
  const shorts = shortNames(bands.map((b) => b.name));
  const placed = width
    ? placeLabels(
        [
          ...marks.map((m) => ({
            key: `m-${m.kind}-${m.release}`,
            at: at(m.release),
            text: m.label,
            className: `rscale__mark rscale__mark--${m.kind}`,
          })),
          ...edges.map((e, i) => ({
            key: `e-${e.release}-${i}`,
            at: e.at,
            text: String(e.release),
            className: "rscale__edge",
          })),
          ...labels.map((r) => ({
            key: `l-${r}`,
            at: at(r),
            text: String(r),
            className: `rscale__label ${edges.length ? "rscale__label--quiet" : ""}`,
          })),
        ],
        width,
      )
    : [];
  return (
    <div className={`rscale rscale--${position}`} ref={ref} role="img" aria-label={label ?? scaleWords(axis, bands)}>
      <div className="rscale__bands" aria-hidden="true">
        {bands.map((band) => {
          const px = band.width * width;
          const range = bandRange(band);
          const full = `${band.name} ${range}`;
          const short = shorts.get(band.name) ?? band.name;
          const text = [full, band.name, short].find((t) => px >= labelWidth(t) + 4) ?? "";
          return (
            <span
              key={`${band.assembly}-${band.first}`}
              className="rscale__band"
              style={{ left: pct(band.left), width: pct(band.width) }}
              title={`${band.name} (assembly ${band.assembly}) serves releases ${range}`}
            >
              {text}
            </span>
          );
        })}
      </div>
      <div className="rscale__ticks" aria-hidden="true">
        {perRelease >= 3
          ? axis.releases.map((r, i) => (
              <span
                key={r}
                className={`rscale__tick ${r % 10 === 0 ? "rscale__tick--ten" : r % 5 === 0 ? "rscale__tick--five" : ""}`}
                style={{ left: pct((i + 0.5) / n) }}
              />
            ))
          : null}
        {highlight.map((run) => (
          <span key={`h-${run.first}`} className="rscale__run" style={{ left: pct(run.left), width: pct(run.width) }} />
        ))}
        {placed.map((item) => (
          <span key={item.key} className={item.className} style={{ left: `${item.left.toFixed(2)}px` }}>
            {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

interface LabelItem {
  key: string;
  /** The place of the label's anchor, as a fraction of the axis. */
  at: number;
  text: string;
  className: string;
}

/** Place labels in the order given (the first has the highest priority) by the figure grammar's placer: each centred
 *  on its place, shifted inside the scale at its ends, and left out where it would touch a label already placed. */
function placeLabels(items: LabelItem[], width: number): (LabelItem & { left: number })[] {
  const placed = place(
    items.map((item) => ({
      key: item.key,
      anchor: item.at * width,
      forms: [item.text],
      align: "center" as const,
      rows: ["scale"],
    })),
    { bounds: [0, width], gap: 9 },
  );
  return items.flatMap((item) => {
    const label = placed.get(item.key);
    return label ? [{ ...item, left: label.t0 - 3 }] : [];
  });
}

function scaleWords(axis: Axis, bands: Band[]): string {
  const first = axis.releases[0];
  const last = axis.releases[axis.releases.length - 1];
  const served = bands
    .map((b) => `${b.name} serves ${b.first === b.last ? b.first : `${b.first} to ${b.last}`}`)
    .join("; ");
  return `Releases ${String(first)} to ${String(last)}. ${served}.`;
}

/** The assembly bands behind a lane or bars: the second, fourth... band shaded, a hairline where the assembly changes. */
export function BandBackdrop({ bands }: { bands: Band[] }) {
  return (
    <>
      {bands.map((band, i) => (
        <span
          key={`${band.assembly}-${band.first}`}
          className={`rband ${i % 2 ? "rband--alt" : ""} ${i ? "rband--edge" : ""}`}
          style={{ left: pct(band.left), width: pct(band.width) }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/** A lane: the runs of releases at which something holds, filled (or hatched for `variant="synonym"`). */
export function ReleaseLane({
  axis,
  bands,
  runs,
  variant = "fill",
  mark,
}: {
  axis: Axis;
  bands: Band[];
  runs: Run[];
  variant?: "fill" | "synonym";
  /** A release marked across the lane (the release asked for). */
  mark?: number | null;
}) {
  const n = axis.releases.length;
  const markIndex = mark === null || mark === undefined ? undefined : axis.index.get(mark);
  return (
    <span className="rlane" aria-hidden="true">
      <BandBackdrop bands={bands} />
      {runs.map((run) => (
        <span
          key={run.first}
          className={`rlane__run rlane__run--${variant}`}
          style={{ left: pct(run.left), width: pct(run.width) }}
        />
      ))}
      {markIndex !== undefined ? <span className="rlane__mark" style={{ left: pct((markIndex + 0.5) / n) }} /> : null}
    </span>
  );
}

/** The ends of the axis written under a lane where no scale stands above it (a card on a phone). */
export function LaneEnds({ axis }: { axis: Axis }) {
  return (
    <span className="rlane-ends" aria-hidden="true">
      <span>{axis.releases[0]}</span>
      <span>{axis.releases[axis.releases.length - 1]}</span>
    </span>
  );
}

/** The identifiers' travel through releases: from each release at which identifiers were read, an arc to the target
 *  release, as wide as their number (linearly, the widest arc the largest number); those read at the target itself are
 *  a mark on it. Arcs rise in proportion to the distance they travel. Every count stands under its arc's foot on the
 *  axis, in up to three rows (the count read at the target first); `onPlaced` says whether every count found room. */
export function TravelArcs({
  axis,
  bands,
  counts,
  target,
  describe,
  onPlaced,
}: {
  axis: Axis;
  bands: Band[];
  counts: Map<number, number>;
  target: number;
  describe: (release: number, count: number) => string;
  onPlaced?: (all: boolean) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(0);
  const n = axis.releases.length;
  const x = (release: number) => (((axis.index.get(release) ?? 0) + 0.5) / n) * width;
  const targetX = x(target);
  const stay = counts.get(target) ?? 0;
  const arcs = [...counts.entries()]
    .filter(([release]) => release !== target && axis.index.has(release))
    .sort((a, b) => Math.abs(x(b[0]) - targetX) - Math.abs(x(a[0]) - targetX));
  const plot = !arcs.length ? 40 : width && width < 560 ? 124 : 160;
  const base = plot - 1;
  const top = 14;
  const rowPitch = 15;
  const max = Math.max(1, ...arcs.map(([, count]) => count));
  const span = Math.max(1, n - 1);
  const rise = (release: number) => {
    const distance = Math.abs((axis.index.get(release) ?? 0) - (axis.index.get(target) ?? 0)) / span;
    return Math.max(16, (base - top) * distance);
  };
  const widest = Math.min(8, Math.max(3, width / 140));
  // One identifier is 1.5 px of width above a 1 px hairline, less where the widest arc would pass `widest`.
  const perIdentifier = Math.min(1.5, (widest - 1) / max);
  const strokeOf = (count: number) => 1 + count * perIdentifier;
  const foot = Math.max(1.25, Math.min(2.5, width / n / 3));
  // The counts under the feet: the target's first, then the arcs from the nearest; each in the first row with room.
  const requests = [
    ...(stay ? [{ key: "stay", anchor: targetX, text: `${groupedInteger(stay)} at the target` }] : []),
    ...[...arcs]
      .reverse()
      .map(([release, count]) => ({ key: `a-${String(release)}`, anchor: x(release), text: groupedInteger(count) })),
  ];
  const placed = width
    ? place(
        requests.map((r) => ({
          key: r.key,
          anchor: r.anchor,
          forms: [r.text],
          align: "center" as const,
          rows: ["0", "1", "2"],
        })),
        { bounds: [0, width], gap: 6 },
      )
    : new Map<string, PlacedLabel>();
  const all = !width || requests.every((r) => placed.has(r.key));
  useLayoutEffect(() => {
    if (width) onPlaced?.(all);
  }, [width, all, onPlaced]);
  const rowsUsed = Math.max(1, ...[...placed.values()].map((p) => Number(p.row) + 1));
  const height = plot + 6 + rowsUsed * rowPitch;
  return (
    <div className="travel" ref={ref} style={{ height }}>
      {width ? (
        <svg className="travel__plot" width={width} height={height} aria-hidden="true">
          {bands.map((band, i) =>
            i % 2 ? (
              <rect
                key={`r-${band.first}`}
                className="travel__band"
                x={band.left * width}
                y={top - 8}
                width={band.width * width}
                height={base - top + 8}
              />
            ) : null,
          )}
          {bands.map((band, i) =>
            i ? (
              <line
                key={band.first}
                className="travel__edge"
                x1={band.left * width}
                x2={band.left * width}
                y1={top - 8}
                y2={base}
              />
            ) : null,
          )}
          <line className="travel__target" x1={targetX} x2={targetX} y1={top - 8} y2={base} />
          {stay ? (
            <rect
              className="travel__stay"
              x={targetX - Math.max(2, width / n / 2 - 1)}
              width={Math.max(4, width / n - 2)}
              y={base - 12}
              height={12}
            >
              <title>{describe(target, stay)}</title>
            </rect>
          ) : null}
          {arcs.map(([release, count]) => {
            const x1 = x(release);
            const rx = Math.abs(targetX - x1) / 2;
            const ry = rise(release);
            const sweep = targetX > x1 ? 1 : 0;
            return (
              <g key={release} className="travel__arc">
                <path
                  d={`M ${x1.toFixed(2)} ${base} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 0 ${sweep} ${targetX.toFixed(2)} ${base}`}
                  strokeWidth={strokeOf(count)}
                  pathLength={1}
                >
                  <title>{describe(release, count)}</title>
                </path>
                <circle cx={x1} cy={base} r={foot} />
              </g>
            );
          })}
          <line className="travel__axis" x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} />
          {requests.map((r) => {
            const label = placed.get(r.key);
            if (!label || label.row === "0") return null;
            // A count set below the first row is joined to its foot by a hairline.
            return (
              <line
                key={`l-${r.key}`}
                className="travel__leader"
                x1={r.anchor}
                x2={r.anchor}
                y1={base + 3}
                y2={plot + 6 + Number(label.row) * rowPitch}
              />
            );
          })}
        </svg>
      ) : null}
      {requests.map((r) => {
        const label = placed.get(r.key);
        if (!label) return null;
        return (
          <span
            key={r.key}
            className={`travel__count ${r.key === "stay" ? "travel__count--stay" : ""}`}
            style={{
              left: `${(label.t0 - 1).toFixed(2)}px`,
              top: `${(plot + 4 + Number(label.row) * rowPitch).toFixed(2)}px`,
            }}
            aria-hidden="true"
          >
            {r.text}
          </span>
        );
      })}
    </div>
  );
}

/** The steps of Ensembl's history on a batch's best paths, release by release: a column at each release where a path
 *  took a step, as tall as the number of identifiers that stepped there, stacked by kind in its family's hue (history,
 *  splits and merges, assembly changes; DESIGN.md, the figure grammar). The tallest columns carry the number of identifiers that stepped there, where
 *  they have room. */
export function EventStrip({
  axis,
  bands,
  events,
  rows,
  label,
}: {
  axis: Axis;
  bands: Band[];
  events: Map<number, Map<string, number>>;
  /** The identifiers that stepped at each release (each once), written on the tallest columns. */
  rows: Map<number, number>;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(0);
  const n = axis.releases.length;
  const height = 72;
  const top = 16;
  const base = height - 2;
  const columns = [...events.entries()].filter(([release]) => axis.index.has(release));
  const totals = columns.map(([release, kinds]) => [release, sumOf(kinds)] as const);
  const max = Math.max(1, ...totals.map(([, t]) => t));
  const cell = width / Math.max(1, n);
  const barWidth = Math.max(2, Math.min(10, cell - 1));
  const scale = (count: number) => ((base - top) * count) / max;
  const x = (release: number) => (((axis.index.get(release) ?? 0) + 0.5) / n) * width;
  const order: [string, string][] = [
    ["handoff", "handoff"],
    ["split", "event"],
    ["merge", "event"],
    ["replaced", "history"],
    ["version", "history"],
    ["remap", "history"],
  ];
  const tallest = [...totals].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6);
  const named = (release: number) => groupedInteger(rows.get(release) ?? 0);
  const placed = width
    ? place(
        tallest.map(([release]) => ({
          key: String(release),
          anchor: x(release),
          forms: [named(release)],
          align: "center" as const,
          rows: ["top"],
        })),
        { bounds: [0, width], gap: 6 },
      )
    : new Map<string, PlacedLabel>();
  return (
    <div className="events" ref={ref} role="img" aria-label={label}>
      {width ? (
        <svg className="events__plot" width={width} height={height} aria-hidden="true">
          {bands.map((band, i) =>
            i % 2 ? (
              <rect
                key={`r-${band.first}`}
                className="travel__band"
                x={band.left * width}
                y={0}
                width={band.width * width}
                height={base}
              />
            ) : null,
          )}
          {bands.map((band, i) =>
            i ? (
              <line
                key={band.first}
                className="travel__edge"
                x1={band.left * width}
                x2={band.left * width}
                y1={0}
                y2={base}
              />
            ) : null,
          )}
          {columns.map(([release, kinds]) => {
            let y = base;
            const cx = x(release);
            return (
              <g key={release}>
                {order.map(([kind, hue]) => {
                  const count = kinds.get(kind) ?? 0;
                  if (!count) return null;
                  const h = Math.max(1.5, scale(count));
                  y -= h;
                  return (
                    <rect
                      key={kind}
                      className={`events__bar events__bar--${hue}`}
                      x={cx - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={h}
                    />
                  );
                })}
              </g>
            );
          })}
          <line className="travel__axis" x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} />
        </svg>
      ) : null}
      {tallest.map(([release, total]) => {
        const p = placed.get(String(release));
        if (!p) return null;
        return (
          <span
            key={release}
            className="travel__count"
            style={{
              left: `${(p.t0 - 1).toFixed(2)}px`,
              top: `${Math.max(0, base - scale(total) - 15).toFixed(2)}px`,
            }}
            aria-hidden="true"
          >
            {named(release)}
          </span>
        );
      })}
    </div>
  );
}

const sumOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** The exact releases of a lane in words, for its row: every release is in the text. */
export function RangesText({ releases, children }: { releases: readonly number[]; children?: ReactNode }) {
  return (
    <span className="rlane-text mono">
      {releaseRanges(releases)}
      {children}
    </span>
  );
}
