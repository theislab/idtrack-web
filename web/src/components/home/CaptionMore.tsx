// A caption that says its first sentence on a narrow screen (a phone, a tablet) and the rest on a press ("More about
// this figure"); on a wider screen the whole caption stands, and the button is not drawn. The rest is in the page either way (a reader of the
// page's text, a search, a screen reader with the rest shown), never a different text.
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
