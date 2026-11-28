// The verdict's top line where an answer is one of the cases of the graph's showcase: which case it is, and the
// previous and the next case, so that the cases can be read one after another. It reads the showcase's queries alone
// (`GET .../showcase/queries`: each case's query and kind, a small answer held for the page session); every case of
// the showcase is in the tour, whatever its kind. The page draws the answer once the queries are known (or refused), so
// the line never arrives under a drawn verdict; an answer that is no case has no line.
import type { CaseTourPlace } from "../../lib/home/caseTour";
import { KIND_TEXT } from "../../lib/home/cases";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { Link } from "../ui";

/** The line: "Case 4 of 14 · A split", then the previous and the next case by the kind their answer shows. */
export function CaseTour({ place }: { place: CaseTourPlace }) {
  const { organism, cases, at } = place;
  const here = cases[at];
  if (!here) return null;
  const link = (i: number, rel: "prev" | "next") => {
    const c = cases[i];
    if (!c) return <span className={`case-tour__${rel} case-tour__none`} aria-hidden="true" />;
    return (
      <Link to={caseHref(caseQueryOf(organism, c.query))} className={`case-tour__${rel}`}>
        {rel === "prev" ? <span aria-hidden="true">← </span> : null}
        <span className="visually-hidden">{rel === "prev" ? "Previous case: " : "Next case: "}</span>
        <span className="case-tour__kind">{KIND_TEXT[c.kind].title}</span>
        {rel === "next" ? <span aria-hidden="true"> →</span> : null}
      </Link>
    );
  };
  return (
    <nav className="case-tour" aria-label="The cases of this graph">
      <p className="case-tour__here">
        {/* On a phone the count is said to a screen reader only (the kinds of the cases name the way). */}
        <span className="case-tour__count">
          Case <span className="mono">{at + 1}</span> of <span className="mono">{cases.length}</span> ·{" "}
        </span>
        <span className="case-tour__count-narrow visually-hidden">{`Case ${at + 1} of ${cases.length}: `}</span>
        <strong>{KIND_TEXT[here.kind].title}</strong>
      </p>
      {link(at - 1, "prev")}
      {link(at + 1, "next")}
    </nav>
  );
}
