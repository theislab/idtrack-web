// An expandable row (DIRECTION.md, "The disclosure components"): a summary on one line (what it is, and a quiet count
// or word) that opens its body below with a height transition. A button with `aria-expanded`; the body a region
// labelled by the summary, drawn only while open. With `expanded`, the page holds the state (a form opens its folded
// settings where one of their values is refused).
import { useId, useState, type ReactNode } from "react";

export function Expandable({
  summary,
  meta,
  children,
  open: initial = false,
  className = "",
  expanded,
  onExpandedChange,
}: {
  summary: ReactNode;
  /** A quiet count or word at the row's end ("3 bridges, 1 taken"). */
  meta?: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
  /** Open or folded, where the page holds the state (with `onExpandedChange`). */
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [own, setOwn] = useState(initial);
  const open = expanded ?? own;
  return (
    <div className={`expandable${open ? " expandable--open" : ""} ${className}`}>
      <button
        type="button"
        className="expandable__summary"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        id={`${id}-summary`}
        onClick={() => {
          if (expanded === undefined) setOwn(!open);
          onExpandedChange?.(!open);
        }}
      >
        <span className="expandable__chevron" aria-hidden="true" />
        <span className="expandable__title">{summary}</span>
        {meta !== undefined && meta !== null ? <span className="expandable__meta">{meta}</span> : null}
      </button>
      <div className="expandable__frame">
        <div className="expandable__clip">
          {open ? (
            <div className="expandable__body" id={`${id}-body`} role="region" aria-labelledby={`${id}-summary`}>
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
