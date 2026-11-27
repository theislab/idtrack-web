// The score of Ensembl's history steps, the one encoding of every figure (DESIGN.md, "The figure grammar"): a track
// under the genes' bars, 1.0 at its top and a floor below (0.9, or the tenth under the lowest score drawn), a stem from
// 1.0 down to each step's score in the hue of the step's kind, an open circle on 1.0 for a step Ensembl gave no score.
// The digits are not drawn: the exact value, as the api sent it, is in the step's note on focus and in the reading.
import { pythonFloat } from "../../lib/numbers";
import { scoreFloor } from "./score";

export interface ScoreItem {
  key: string;
  x: number;
  weight: number | null;
  hue: "history" | "event";
  strong?: boolean;
}

/** The track between `top` (1.0) and `bottom` (the floor), from x0 to x1, named in the gutter left of `labelX`. On a
 *  timeline that runs down the page (`vertical`), the same track turned: `x` of each item is its place down the page,
 *  1.0 at `top` (an x) and the floor at `bottom`, named above it at `labelX` (a y). */
export function ScoreTrack({
  items,
  x0,
  x1,
  top,
  bottom,
  labelX,
  vertical = false,
  name = "score",
}: {
  items: ScoreItem[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  labelX: number;
  vertical?: boolean;
  /** The track's name above its 1.0 (none where the figure names the track itself). */
  name?: string | null;
}) {
  const floor = scoreFloor(items.map((i) => i.weight));
  const y = (w: number) => top + ((1 - w) / (1 - floor || 1)) * (bottom - top);
  if (vertical) {
    const at = (w: number) => y(Math.max(floor, Math.min(1, w)));
    return (
      <g className="fig-score" aria-hidden="true">
        <line x1={top} x2={top} y1={x0} y2={x1} className="fig-score__line" />
        <line x1={bottom} x2={bottom} y1={x0} y2={x1} className="fig-score__floor" />
        <text x={top} y={labelX} textAnchor="middle" className="fig-score__tick">
          1.0
        </text>
        <text x={bottom} y={labelX} textAnchor="middle" className="fig-score__tick">
          {pythonFloat(floor)}
        </text>
        {items.map((item) =>
          item.weight === null ? (
            <circle key={item.key} cx={top} cy={item.x} r={2.6} className="fig-score__none" />
          ) : (
            <g key={item.key} className={`fig-score__stem fig-hue--${item.hue}`}>
              <line x1={top} x2={at(item.weight)} y1={item.x} y2={item.x} />
              <circle cx={at(item.weight)} cy={item.x} r={2.4} />
            </g>
          ),
        )}
      </g>
    );
  }
  return (
    <g className="fig-score" aria-hidden="true">
      <line x1={x0} x2={x1} y1={top} y2={top} className="fig-score__line" />
      <line x1={x0} x2={x1} y1={bottom} y2={bottom} className="fig-score__floor" />
      {name ? (
        <text x={labelX} y={top - 12} textAnchor="end" className="fig-score__tick fig-score__name">
          {name}
        </text>
      ) : null}
      <text x={labelX} y={top + 4} textAnchor="end" className="fig-score__tick">
        1.0
      </text>
      <text x={labelX} y={bottom + 4} textAnchor="end" className="fig-score__tick">
        {pythonFloat(floor)}
      </text>
      {items.map((item) =>
        item.weight === null ? (
          <circle
            key={item.key}
            cx={item.x}
            cy={top}
            r={2.6}
            className={`fig-score__none${item.strong === false ? " fig-score--weak" : ""}`}
          />
        ) : (
          <g
            key={item.key}
            className={`fig-score__stem fig-hue--${item.hue}${item.strong === false ? " fig-score--weak" : ""}`}
          >
            <line x1={item.x} x2={item.x} y1={top} y2={y(Math.max(floor, Math.min(1, item.weight)))} />
            <circle cx={item.x} cy={y(Math.max(floor, Math.min(1, item.weight)))} r={2.4} />
          </g>
        ),
      )}
    </g>
  );
}
