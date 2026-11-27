// The idtrack logo: the mark (a graph of identifiers) and the wordmark, in the current text colour.
import { LOGO_VIEWBOX, MARK_EDGES, MARK_HEIGHT, MARK_NODES, MARK_STROKE, MARK_WIDTH, WORDMARK } from "./logoPaths";

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

/** The mark and the wordmark. */
export function Logo({ className, title = "idtrack" }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox={LOGO_VIEWBOX} role="img" aria-label={title} focusable="false">
      <MarkShapes />
      <path fill="currentColor" d={WORDMARK} />
    </svg>
  );
}
