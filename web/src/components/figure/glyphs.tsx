// The marks of the figures (DESIGN.md, "The figure grammar"): one glyph for each kind of step, the same in every
// figure, its legend and its note. Hue says the family (Ensembl's history, a split or merge, a crossing through an
// external database, an assembly handoff); the shape says it again, so that colour is never the only code.
import type { ReactNode } from "react";
import { HUE, type Glyph } from "./glyph";

export type Size = "thin" | "thick";

const R = { thin: 3.6, thick: 4.6 };

/** A step's glyph at (x, y) on a horizontal bar. `strong`: on the chosen path; `event`: a handoff that is also a
 *  split or merge carries the dot inside its diamond. */
export function StepGlyph({
  glyph,
  x,
  y,
  size = "thick",
  strong = true,
  event = false,
}: {
  glyph: Glyph;
  x: number;
  y: number;
  size?: Size;
  strong?: boolean;
  event?: boolean;
}): ReactNode {
  const r = R[size];
  const cls = `fig-glyph fig-glyph--${glyph} fig-hue--${HUE[glyph]}${strong ? "" : " fig-glyph--weak"}`;
  switch (glyph) {
    case "version": {
      const h = size === "thick" ? 8 : 5.5;
      return <line className={cls} x1={x} x2={x} y1={y - h} y2={y + h} />;
    }
    case "event":
      return <circle className={cls} cx={x} cy={y} r={r} />;
    case "loop": {
      const w = size === "thick" ? 5 : 3.8;
      const top = size === "thick" ? 17 : 11;
      const foot = size === "thick" ? 6 : 3;
      return (
        <path
          className={cls}
          d={`M${x - w},${y - foot} C${x - w - 1.5},${y - top} ${x + w + 1.5},${y - top} ${x + w},${y - foot}`}
        />
      );
    }
    case "handoff": {
      const d = r + 0.8;
      return (
        <g className={cls}>
          <path className="fig-glyph__shape" d={`M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}Z`} />
          {event ? <circle className="fig-glyph__inner fig-hue--event" cx={x} cy={y} r={r / 2.2} /> : null}
        </g>
      );
    }
    case "read":
    case "bridge":
    case "final": {
      const s = size === "thick" ? 7 : 6;
      return (
        <g className={cls}>
          <rect className="fig-glyph__shape" x={x - s / 2} y={y - s / 2} width={s} height={s} />
          {glyph === "bridge" ? <circle className="fig-glyph__inner" cx={x} cy={y} r={1.3} /> : null}
        </g>
      );
    }
    case "identity":
      return <circle className={cls} cx={x} cy={y} r={r + 3} />;
    case "form":
      return <circle className={cls} cx={x} cy={y} r={size === "thick" ? 4 : 2.6} />;
  }
}

/** A gene over the releases a path holds it: a bar, thin on a figure of many rows, thick on a figure of one path. */
export function GeneBar({
  x0,
  x1,
  y,
  size = "thick",
  strong = true,
  className = "",
}: {
  x0: number;
  x1: number;
  y: number;
  size?: Size;
  strong?: boolean;
  className?: string;
}): ReactNode {
  const h = size === "thick" ? 8 : 1.6;
  const w = Math.max(size === "thick" ? 2 : 1, x1 - x0);
  return (
    <rect
      className={`fig-gene fig-gene--${size}${strong ? "" : " fig-gene--weak"} ${className}`}
      x={x0}
      y={y - h / 2}
      width={w}
      height={h}
      rx={size === "thick" ? 2 : 0.8}
    />
  );
}

/** The swatch of a glyph for a legend (the same component the figures draw). */
export function GlyphSwatch({
  glyph,
  event = false,
}: {
  glyph: Glyph | "gene" | "gene-thin" | "cross";
  event?: boolean;
}) {
  return (
    <svg className="fig-swatch" width={30} height={16} viewBox="0 0 30 16" aria-hidden="true" focusable="false">
      {glyph === "gene" ? (
        <GeneBar x0={2} x1={28} y={8} />
      ) : glyph === "gene-thin" ? (
        <GeneBar x0={2} x1={28} y={8} size="thin" />
      ) : glyph === "cross" ? (
        <>
          <line className="fig-cross" x1={6} x2={24} y1={8} y2={8} />
          <StepGlyph glyph="read" x={5} y={8} size="thin" />
          <StepGlyph glyph="final" x={25} y={8} size="thin" />
        </>
      ) : (
        <>
          {glyph === "version" || glyph === "loop" || glyph === "handoff" || glyph === "event" ? (
            <GeneBar x0={2} x1={28} y={glyph === "loop" ? 12 : 8} size="thin" />
          ) : null}
          <StepGlyph glyph={glyph} x={15} y={glyph === "loop" ? 12 : 8} event={event} />
        </>
      )}
    </svg>
  );
}
