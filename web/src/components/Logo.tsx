// IDTrack's mark (a graph of identifiers), in the current text colour.
import { MARK_EDGES, MARK_HEIGHT, MARK_NODES, MARK_STROKE, MARK_WIDTH } from "./logoPaths";

function MarkShapes() {
  return (
    <>
      <path d={MARK_EDGES} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="round" />
      <g fill="currentColor">
        {MARK_NODES.map(([cx, cy, r]) => (
          <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </>
  );
}

/** The mark alone (decorative unless given a title). */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <MarkShapes />
    </svg>
  );
}
