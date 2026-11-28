// The verdict's top line where an answer is one of the cases of the graph's showcase: which case it is, and the
// previous and the next case, so that the cases can be read one after another. It reads the showcase's queries alone
// (`GET .../showcase/queries`: each case's query and kind, a small answer held for the page session); every case of
// the showcase is in the tour, whatever its kind. The page draws the answer once the queries are known (or refused), so
// the line never arrives under a drawn verdict; an answer that is no case has no line.
import { api } from "../../api/client";
import type { ConvertParameters } from "../../lib/convertParameters";
import { isCaseKind, type CaseKind } from "../../lib/home/caseKinds";
import { KIND_TEXT } from "../../lib/home/cases";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { caseIndex } from "../../lib/showcase";
import { useRequest } from "../../lib/useRequest";
import { Link } from "../ui";

export interface CaseTourPlace {
  organism: string;
  /** The cases of the showcase, in its order (each with a kind the page knows). */
  cases: { kind: CaseKind; query: Parameters<typeof caseQueryOf>[1] }[];
  /** The index of the answer's case. */
  at: number;
}

/** Whether the showcase's queries are known (or refused: the answer is then shown without a tour), and the answer's
 *  place among the cases, where it is one. */
export function useCaseTour(
  organism: string,
  parameters: ConvertParameters,
): { settled: boolean; place: CaseTourPlace | null } {
  const queries = useRequest(`showcase-queries|${organism}`, (signal, fresh) =>
    api.showcaseQueries(organism, { signal, fresh }),
  );
  if (queries.state !== "done") return { settled: queries.state === "failed", place: null };
  const cases = queries.answer.data.cases.flatMap((c) => (isCaseKind(c.kind) ? [{ kind: c.kind, query: c.query }] : []));
  const at = caseIndex(cases, {
    identifier: parameters.identifier,
    from: parameters.fromRelease as number | null,
    to: parameters.toRelease as number | null,
    db: parameters.finalDatabase,
  });
  // A case is asked as the showcase asks it: a source database named in the address makes another conversion.
  if (at < 0 || parameters.fromDatabase !== null) return { settled: true, place: null };
  return { settled: true, place: { organism, cases, at } };
}

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
        <span className="case-tour__count">
          Case <span className="mono">{at + 1}</span> of <span className="mono">{cases.length}</span> ·{" "}
        </span>
        <strong>{KIND_TEXT[here.kind].title}</strong>
      </p>
      {link(at - 1, "prev")}
      {link(at + 1, "next")}
    </nav>
  );
}
