// A caption that says its claim (its first sentence) and the rest on a press ("More about this figure"), at every
// width (DIRECTION.md, rule 4: captions keep their claim; how to read the figure folds). Opened, the rest is the same
// text in the same place, never a different one.
import { useId, useState, type ReactNode } from "react";

export function CaptionMore({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={`caption-more${open ? " is-open" : ""}`}>
      {lead}{" "}
      <span className="caption-more__rest" id={id}>
        {children}
      </span>
      <button
        type="button"
        className="caption-more__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {open ? "Less about this figure" : "More about this figure"}
      </button>
    </span>
  );
}
