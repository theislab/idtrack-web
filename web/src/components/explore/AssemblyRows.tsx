// Assemblies on a shared release axis, one row per graph (Explore) or per assembly (an organism's page): a solid bar
// over the releases an assembly serves (`serves`: it is the assembly whose annotation counts there), a thin line over
// the releases at which the graph holds data of it (`releases`). Every bar is focusable with its exact releases.
import { useCallback, type ReactNode } from "react";
import type { AssemblyDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { MAPPING_WORDS, type Handoff } from "../../lib/explore/handoffs";
import { runs } from "../../lib/explore/runs";
import { releaseRanges } from "../../lib/numbers";
import { releaseScale, shortNames } from "../figure/releases";
import { ReleaseTicks } from "../figure/axis";
import { placeLabels, type LabelRequest } from "../figure/labels";
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

const ROW = 54;
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
  const height = rows.length * ROW + AXIS;
  const items = rows.flatMap((row, i) =>
    row.assemblies.map((a, j) => ({ row, rowIndex: i, assembly: a, shade: j % 2 === 1 })),
  );
  // Every bar is named, by one rule: its name inside it where it has room, else its short name inside it, else its
  // name (or short name) just above it, or just below it; the full name is always in its note and the table.
  const shorts = shortNames(items.map((it) => it.assembly.name ?? String(it.assembly.assembly)));
  const requests: LabelRequest[] = [];
  items.forEach((it, index) => {
    const name = it.assembly.name ?? String(it.assembly.assembly);
    const short = shorts.get(name) ?? name;
    runs(it.assembly.serves).forEach(([p, q], k) => {
      const x0 = scale.x(p - 0.5) + 1;
      const x1 = scale.x(q + 0.5) - 1;
      const key = `${index}:${k}`;
      requests.push({
        key: `in-${key}`,
        anchor: x0 + 6,
        forms: [name, short],
        align: "start",
        rows: [`in-${key}`],
        bounds: [x0 + 5, x1 - 4],
      });
    });
  });
  const inside = placeLabels(requests, { bounds: [2, width - 2] });
  // A name that has no room inside its bar stands above it, in its full or short form; only where neither fits above
  // (another name holds the place) below it: one consistent place, so that the rows keep their rhythm.
  const outside = (rowOf: (rowIndex: number) => string) =>
    items.flatMap((it, index) => {
      const name = it.assembly.name ?? String(it.assembly.assembly);
      return runs(it.assembly.serves).flatMap(([p, q], k) =>
        inside.has(`in-${index}:${k}`)
          ? []
          : [
              {
                key: `up-${index}:${k}`,
                anchor: (scale.x(p - 0.5) + scale.x(q + 0.5)) / 2,
                forms: [name, shorts.get(name) ?? name],
                align: "center" as const,
                rows: [rowOf(it.rowIndex)],
              },
            ],
      );
    });
  const first_ = placeLabels(
    outside((r) => `up-${r}`),
    { bounds: [2, width - 2], gap: 8 },
  );
  const second = placeLabels(
    outside((r) => `down-${r}`).filter((request) => !first_.has(request.key)),
    { bounds: [2, width - 2], gap: 8 },
  );
  const above = new Map([...first_, ...second]);
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
          <li key={row.key} style={{ height: ROW }}>
            {row.label}
          </li>
        ))}
      </ul>
      <div className="arows__plot" ref={ref} style={{ height }}>
        <svg width={width} height={height} role="group" aria-label={label}>
          {rows.map((row, i) => (
            <line
              key={row.key}
              x1={scale.x0}
              x2={scale.x1}
              y1={i * ROW + ROW / 2}
              y2={i * ROW + ROW / 2}
              className="arows__track"
            />
          ))}
          {items.map((it, index) => {
            const y = it.rowIndex * ROW + ROW / 2;
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
                          y={outer.row.startsWith("up") ? y - 14 : y + 23}
                          textAnchor="middle"
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
              const y = i * ROW + ROW / 2;
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
          <ReleaseTicks scale={scale} y={rows.length * ROW + 4} releases={releases} />
        </svg>
        {shown ? (
          <FigureNote x={centre(shown)} y={shown.rowIndex * ROW + ROW / 2 + 16} width={width}>
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
