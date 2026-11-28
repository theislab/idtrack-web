// Assemblies on a shared release axis, one row per graph (Explore) or per assembly (an organism's page): a solid bar
// over the releases an assembly serves (`serves`: it is the assembly whose annotation counts there), a thin line over
// the releases at which the graph holds data of it (`releases`). Every bar is focusable with its exact releases.
import { useCallback, type ReactNode } from "react";
import type { AssemblyDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { MAPPING_WORDS, type Handoff } from "../../lib/explore/handoffs";
import { runs } from "../../lib/explore/runs";
import { releaseRanges } from "../../lib/numbers";
import { releaseScale } from "../figure/releases";
import { ReleaseTicks } from "../figure/axis";
import { placeLabels, type LabelRequest, type PlacedLabel } from "../figure/labels";
import { FigureNote } from "../figure/FigureNote";
import { useRoving } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

export interface AssemblyRow {
  key: string;
  label: ReactNode;
  assemblies: AssemblyDescription[];
  /** Whose row it is, for the notes ("Homo sapiens"); empty when the row is one assembly. */
  owner?: string;
  primary?: number;
  /** The changes of the serving assembly in the row (a row of one organism), each drawn at its boundary. */
  handoffs?: Handoff[];
}

/** A row's height, and where its bar stands: names inside the bars (the bar at the row's middle), or every name under
 *  its bar on up to two lines (the bar higher). */
const ROW = 54;
const ROW_UNDER = 70;
const BAR_UNDER = 22;
/** The height of each line of names under the bars past the second (a row has as many lines as it has assemblies at
 *  most, so that every name finds one). */
const LINE_UNDER = 14;
const AXIS = 30;

export function AssemblyRows({
  rows,
  first,
  last,
  label,
  held = true,
}: {
  rows: AssemblyRow[];
  first: number;
  last: number;
  label: string;
  /** Draw the releases at which the graph holds data of each assembly (a row of one assembly has room for it). */
  held?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const releases = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const scale = releaseScale(releases, 4, width - 8);
  const items = rows.flatMap((row, i) =>
    row.assemblies.map((a, j) => ({ row, rowIndex: i, assembly: a, shade: j % 2 === 1 })),
  );
  // Every bar is named by its whole name, in one place for the whole figure: inside the bar where every bar has room
  // for its name; else under its bar, from the bar's start (or ending there, where it has no room after it), on the
  // first of as many lines as the row needs where it meets no other name: a name is moved, never shortened, never
  // dropped, and never stands above one bar and below another. The name is also in its note and the table.
  const nameOf = (it: (typeof items)[number]) => it.assembly.name ?? String(it.assembly.assembly);
  const requests: LabelRequest[] = [];
  items.forEach((it, index) => {
    runs(it.assembly.serves).forEach(([p, q], k) => {
      const x0 = scale.x(p - 0.5) + 1;
      const x1 = scale.x(q + 0.5) - 1;
      requests.push({
        key: `in-${index}:${k}`,
        anchor: x0 + 6,
        forms: [nameOf(it)],
        align: "start",
        rows: [`in-${index}:${k}`],
        bounds: [x0 + 5, x1 - 4],
      });
    });
  });
  const fitted = placeLabels(requests, { bounds: [2, width - 2] });
  const under = requests.length > 0 && fitted.size < requests.length;
  const inside = under ? new Map<string, never>() : fitted;
  const below = under
    ? placeLabels(
        items.flatMap((it, index) =>
          runs(it.assembly.serves).map(([p], k) => ({
            key: `up-${index}:${k}`,
            anchor: scale.x(p - 0.5) + 1,
            forms: [nameOf(it)],
            align: "start" as const,
            flip: true,
            rows: Array.from(
              { length: Math.max(2, it.row.assemblies.length) },
              (_, line) => `u${line + 1}-${it.rowIndex}`,
            ),
          })),
        ),
        { bounds: [2, width - 2], gap: 10 },
      )
    : new Map<string, PlacedLabel>();
  // The lines the names take under the bars: a row is as tall as its most crowded row needs.
  const lineOf = (label: PlacedLabel) => Number(/^u(\d+)/.exec(label.row)?.[1] ?? "1");
  const lines = Math.max(2, ...[...below.values()].map(lineOf));
  const rowH = under ? ROW_UNDER + (lines - 2) * LINE_UNDER : ROW;
  const barY = (rowIndex: number) => rowIndex * rowH + (under ? BAR_UNDER : rowH / 2);
  const height = rows.length * rowH + AXIS;
  const above = below;
  const svg = useCallback(() => ref.current?.querySelector("svg") ?? null, [ref]);
  const roving = useRoving(items.length, svg);
  const shown = roving.shown === null ? null : items[roving.shown];
  const centre = (it: (typeof items)[number]) => {
    const r = runs(it.assembly.serves.length ? it.assembly.serves : it.assembly.releases);
    const a = r[0]?.[0] ?? first;
    const b = r[r.length - 1]?.[1] ?? first;
    return (scale.x(a - 0.5) + scale.x(b + 0.5)) / 2;
  };
  return (
    <div className="arows">
      <ul className="arows__labels">
        {rows.map((row) => (
          <li
            key={row.key}
            style={under ? { height: rowH, alignItems: "flex-start", paddingTop: BAR_UNDER - 15 } : { height: rowH }}
          >
            {row.label}
          </li>
        ))}
      </ul>
      <div className="arows__plot" ref={ref} style={{ height }}>
        <svg width={width} height={height} role="group" aria-label={label}>
          {rows.map((row, i) => (
            <line key={row.key} x1={scale.x0} x2={scale.x1} y1={barY(i)} y2={barY(i)} className="arows__track" />
          ))}
          {items.map((it, index) => {
            const y = barY(it.rowIndex);
            const a = it.assembly;
            const name = a.name ?? String(a.assembly);
            const heldRuns = runs(a.releases);
            const serves = runs(a.serves);
            const servesText = a.serves.length ? releaseRanges(a.serves) : "none";
            const aria = `${it.row.owner ? `${it.row.owner}, ` : ""}${name} (assembly ${a.assembly}): serves releases ${servesText}; the graph holds data of it at releases ${releaseRanges(a.releases)}; ${a.external_databases.length} external databases`;
            return (
              <g
                key={`${it.row.key}-${a.assembly}`}
                role="img"
                aria-label={aria}
                className="fig-target"
                {...roving.bind(index)}
              >
                {(held ? heldRuns : []).map(([p, q]) => (
                  <line key={p} x1={scale.x(p - 0.5)} x2={scale.x(q + 0.5)} y1={y} y2={y} className="arows__held" />
                ))}
                {serves.map(([p, q], k) => {
                  const x = scale.x(p - 0.5) + 1;
                  const w = Math.max(2, scale.x(q + 0.5) - scale.x(p - 0.5) - 2);
                  const inner = inside.get(`in-${index}:${k}`);
                  const outer = above.get(`up-${index}:${k}`);
                  return (
                    <g key={p}>
                      <rect
                        x={x}
                        y={y - 9}
                        width={w}
                        height={18}
                        rx={3}
                        className={`arows__serve${it.shade ? " arows__serve--b" : ""}`}
                      />
                      {inner ? (
                        <text x={inner.x} y={y + 3.8} className="arows__name">
                          {inner.text}
                        </text>
                      ) : null}
                      {outer ? (
                        <text
                          x={outer.x}
                          y={y + 23 + (lineOf(outer) - 1) * LINE_UNDER}
                          textAnchor={outer.anchor}
                          className="fig-text arows__name--out"
                        >
                          {outer.text}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {shown === it ? (
                  <rect
                    x={scale.x((serves[0]?.[0] ?? heldRuns[0]?.[0] ?? first) - 0.5) - 2}
                    y={y - 12}
                    width={
                      scale.x((serves[serves.length - 1]?.[1] ?? heldRuns[heldRuns.length - 1]?.[1] ?? first) + 0.5) -
                      scale.x((serves[0]?.[0] ?? heldRuns[0]?.[0] ?? first) - 0.5) +
                      4
                    }
                    height={24}
                    rx={5}
                    className="arows__focus"
                  />
                ) : null}
              </g>
            );
          })}
          {rows.flatMap((row, i) =>
            (row.handoffs ?? []).map((h) => {
              const x = scale.x(h.release - 0.5);
              const y = barY(i);
              return (
                <path
                  key={`${row.key}-h${h.release}`}
                  d={`M${x},${y - 6} L${x + 5},${y} L${x},${y + 6} L${x - 5},${y} Z`}
                  className={`arows__handoff arows__handoff--${h.mapping}`}
                  aria-hidden="true"
                />
              );
            }),
          )}
          <ReleaseTicks scale={scale} y={rows.length * rowH + 4} releases={releases} />
        </svg>
        {shown ? (
          <FigureNote x={centre(shown)} y={barY(shown.rowIndex) + 16} width={width}>
            <p className="fig-note__title">
              {shown.row.owner ? `${shown.row.owner} · ` : ""}
              {shown.assembly.name ?? shown.assembly.assembly}{" "}
              <span className="mono fig-note__quiet">({shown.assembly.assembly})</span>
              {shown.row.primary === shown.assembly.assembly ? " · primary" : ""}
            </p>
            <p>
              Serves releases{" "}
              <span className="mono">
                {shown.assembly.serves.length ? releaseRanges(shown.assembly.serves) : "none"}
              </span>
            </p>
            <p>
              Holds data at <span className="mono">{releaseRanges(shown.assembly.releases)}</span>
            </p>
            {(shown.row.handoffs ?? [])
              .filter((h) => h.to.assembly === shown.assembly.assembly)
              .map((h) => (
                <p key={h.release}>
                  From {h.from.name} at release <span className="mono">{h.release}</span>: {MAPPING_WORDS[h.mapping]}.
                </p>
              ))}
            <p className="fig-note__quiet">
              {shown.assembly.external_databases.length} external databases:{" "}
              {shown.assembly.external_databases.map(databaseLabel).join(", ")}
            </p>
          </FigureNote>
        ) : null}
      </div>
    </div>
  );
}
