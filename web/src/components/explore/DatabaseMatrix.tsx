// What a conversion to each release can end in: one row per database, one column per release, a mark where the
// release's final databases include the database; the assembly bands behind the columns. The matrix is one tab stop:
// the arrow keys move from cell to cell (Home and End along a row), and the cell's value is announced and shown; the
// pointer shows the same note.
import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import type { DatabaseMatrix as Matrix } from "../../lib/explore/databaseMatrix";
import { runs } from "../../lib/explore/runs";
import { releaseRanges } from "../../lib/numbers";
import { assemblyBands, releaseScale } from "../figure/releases";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { useWidth } from "../figure/useWidth";
import { Button } from "../ui";

const HEAD = 34;
const FOOT = 30;
/** Below this width the matrix is drawn in one column, each database named above its row, so that every release
 *  fits the screen (no sideways scroll). */
const STACKED = 640;

export function DatabaseMatrix({ matrix: full, description }: { matrix: Matrix; description: GraphDescription }) {
  // The databases of every release repeat one fact: folded into one band under the rows that differ, shown on request.
  const every = full.databases.length - full.partial;
  const foldable = full.partial > 0 && every > 1;
  const [unfolded, setUnfolded] = useState(false);
  const folded = foldable && !unfolded;
  const sample = full.databases[full.partial];
  const matrix = useMemo(
    () =>
      folded && sample
        ? {
            ...full,
            databases: [
              ...full.databases.slice(0, full.partial),
              {
                ...sample,
                name: `${every} databases at every release`,
                form: null,
              },
            ],
          }
        : full,
    [full, folded, every, sample],
  );
  const { ref, width: viewport } = useWidth<HTMLDivElement>(900);
  const { ref: outerRef, width: outerWidth } = useWidth<HTMLDivElement>(900);
  const stacked = outerWidth < STACKED;
  const ROW = stacked ? 30 : 20;
  const releases = matrix.releases;
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  const columns = last - first + 1;
  const room = stacked ? outerWidth : viewport;
  const cell = stacked ? (room - 8) / Math.max(1, columns) : Math.max(9, Math.floor((room - 8) / Math.max(1, columns)));
  const width = columns * cell + 8;
  const height = HEAD + matrix.databases.length * ROW + FOOT;
  /** The centre of a row's strip. */
  const stripY = (i: number) => HEAD + i * ROW + (stacked ? 21 : ROW / 2);
  const scale = releaseScale(releases, 4, 4 + columns * cell);
  const bands = assemblyBands(description);
  const sets = useMemo(() => matrix.databases.map((d) => new Set(d.releases)), [matrix]);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [scrolled, setScrolled] = useState(0);
  const shown = hover ?? (focused ? (active ?? { row: 0, col: 0 }) : null);

  const words = useCallback(
    (row: number, col: number) => {
      const db = matrix.databases[row];
      const release = first + col;
      if (!db) return "";
      const can = sets[row]?.has(release) ?? false;
      return `${databaseLabel(db.name)} at release ${release}: ${can ? "a conversion to this release can end in it" : "not a database a conversion to this release can end in"}`;
    },
    [matrix, sets, first],
  );

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const at = active ?? { row: 0, col: 0 };
    const rows = matrix.databases.length;
    const moves: Record<string, () => { row: number; col: number }> = {
      ArrowRight: () => ({ row: at.row, col: Math.min(columns - 1, at.col + 1) }),
      ArrowLeft: () => ({ row: at.row, col: Math.max(0, at.col - 1) }),
      ArrowDown: () => ({ row: Math.min(rows - 1, at.row + 1), col: at.col }),
      ArrowUp: () => ({ row: Math.max(0, at.row - 1), col: at.col }),
      Home: () => ({ row: at.row, col: 0 }),
      End: () => ({ row: at.row, col: columns - 1 }),
      PageDown: () => ({ row: rows - 1, col: at.col }),
      PageUp: () => ({ row: 0, col: at.col }),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setHover(null);
    const next = move();
    setActive(next);
    // Keep the cell in view in a matrix that scrolls sideways.
    const frame = ref.current;
    if (frame) {
      const x = scale.x(first + next.col);
      if (x < frame.scrollLeft + 20) frame.scrollLeft = x - 40;
      else if (x > frame.scrollLeft + frame.clientWidth - 20) frame.scrollLeft = x - frame.clientWidth + 40;
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const col = Math.floor((x - 4) / cell);
    const row = Math.floor((y - HEAD) / ROW);
    if (col < 0 || col >= columns || row < 0 || row >= matrix.databases.length) setHover(null);
    else if (hover?.row !== row || hover.col !== col) setHover({ row, col });
  };

  const shownDb = shown ? matrix.databases[shown.row] : undefined;
  const noteX = shown ? scale.x(first + shown.col) - scrolled : 0;

  const label = (i: number, name: string) => (folded && i === matrix.databases.length - 1 ? name : databaseLabel(name));
  return (
    <>
      <div className={`dbm fig${stacked ? " dbm--stacked" : ""}`} ref={outerRef}>
        {stacked ? null : (
          <ul className="dbm__labels" style={{ paddingTop: HEAD }} aria-hidden="true">
            {matrix.databases.map((d, i) => (
              <li
                key={d.name}
                style={{ height: ROW }}
                className={`${shown?.row === i ? "dbm__label--on" : ""}${i === matrix.partial && i > 0 ? " dbm__label--every" : ""}`}
              >
                {label(i, d.name)}
              </li>
            ))}
          </ul>
        )}
        <div className="dbm__frame-outer">
          <div
            className="dbm__frame"
            ref={ref}
            onScroll={(e) => {
              setScrolled(e.currentTarget.scrollLeft);
            }}
          >
            <svg
              width={width}
              height={height}
              tabIndex={0}
              role="group"
              aria-label={`Release by database: ${matrix.databases.length} databases, releases ${first} to ${last}. Arrow keys move from cell to cell.`}
              className="dbm__svg"
              onKeyDown={onKeyDown}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              onPointerMove={onPointerMove}
              onPointerDown={onPointerMove}
              onPointerLeave={() => {
                setHover(null);
              }}
            >
              <Bands bands={bands} scale={scale} top={0} bottom={height - FOOT + 4} labelY={13} outerY={27} />
              {matrix.databases.map((d, i) => (
                <g key={d.name}>
                  {i % 2 === 0 ? (
                    <rect
                      x={scale.x0}
                      y={HEAD + i * ROW}
                      width={scale.x1 - scale.x0}
                      height={ROW}
                      className="dbm__zebra"
                    />
                  ) : null}
                  {runs(d.releases).map(([a, b]) => (
                    <rect
                      key={a}
                      x={scale.x(a - 0.5) + 0.5}
                      y={stripY(i) - 2}
                      width={Math.max(1, scale.x(b + 0.5) - scale.x(a - 0.5) - 1)}
                      height={4}
                      rx={1}
                      className="dbm__run"
                    />
                  ))}
                  {stacked ? (
                    <text
                      x={scale.x0}
                      y={HEAD + i * ROW + 13}
                      className={`fig-text fig-text--sans dbm__name${shown?.row === i ? " dbm__name--on" : ""}`}
                    >
                      {label(i, d.name)}
                    </text>
                  ) : null}
                </g>
              ))}
              {matrix.partial > 0 && matrix.partial < matrix.databases.length ? (
                <line
                  x1={scale.x0}
                  x2={scale.x1}
                  y1={HEAD + matrix.partial * ROW}
                  y2={HEAD + matrix.partial * ROW}
                  className="dbm__divide"
                />
              ) : null}
              <ReleaseTicks scale={scale} y={height - FOOT + 4} releases={releases} />
              {shown ? (
                <rect
                  x={scale.x(first + shown.col - 0.5)}
                  y={HEAD + shown.row * ROW + 1}
                  width={cell}
                  height={ROW - 2}
                  className="dbm__focus"
                  aria-hidden="true"
                />
              ) : null}
            </svg>
          </div>
          {shown && shownDb ? (
            <FigureNote x={noteX} y={HEAD + shown.row * ROW + ROW + 4} width={Math.min(viewport, width)}>
              <p className="fig-note__title">
                {databaseLabel(shownDb.name)} · release {first + shown.col}
              </p>
              <p>
                {sets[shown.row]?.has(first + shown.col)
                  ? "A conversion to this release can end in it."
                  : "A conversion to this release cannot end in it."}
              </p>
              <p className="fig-note__quiet">
                Releases <span className="mono">{releaseRanges(shownDb.releases)}</span>
                {shownDb.form ? ` · through the ${shownDb.form}` : ""}
              </p>
            </FigureNote>
          ) : null}
        </div>
        <p className="visually-hidden" aria-live="polite">
          {focused && active && !hover ? words(active.row, active.col) : ""}
        </p>
        <ul className="visually-hidden" aria-label="The matrix, one database a line">
          {full.databases.map((d) => (
            <li key={d.name}>
              {databaseLabel(d.name)}: releases {releaseRanges(d.releases)}
            </li>
          ))}
        </ul>
      </div>
      {foldable ? (
        <p className="dbm__fold">
          {folded ? (
            <>
              The last row stands for {every} databases a conversion can end in at every release:{" "}
              {full.databases
                .slice(full.partial, full.partial + 6)
                .map((d) => databaseLabel(d.name))
                .join(", ")}
              {every > 6 ? `, and ${every - 6} more` : ""}.{" "}
            </>
          ) : null}
          <Button
            variant="quiet"
            onClick={() => {
              setUnfolded(!unfolded);
            }}
          >
            {folded ? `Show the ${every} rows` : `Fold the ${every} databases of every release into one row`}
          </Button>
        </p>
      ) : null}
    </>
  );
}
