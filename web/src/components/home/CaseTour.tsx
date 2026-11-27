// Above an answer that is one of the cases of the graph's showcase: which case it is, and the previous and the next
// case, so the cases can be read one after another. It reads the showcase the home already asked for (one answer per
// page session); an answer that is no case shows nothing.
import type { ConvertParameters } from "../../lib/convertParameters";
import { isCaseKind } from "../../lib/home/caseKinds";
import { KIND_TEXT } from "../../lib/home/cases";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { caseIndex, useShowcase } from "../../lib/showcase";
import { Link } from "../ui";

export function CaseTour({ organism, parameters }: { organism: string; parameters: ConvertParameters }) {
  const answer = useShowcase(organism);
  if (answer.state !== "done") return null;
  const cases = answer.answer.data.cases.filter((c) => c.result && isCaseKind(c.kind) && c.kind !== "lineage");
  const at = caseIndex(cases, {
    identifier: parameters.identifier,
    from: parameters.fromRelease as number | null,
    to: parameters.toRelease as number | null,
    db: parameters.finalDatabase,
  });
  const here = cases[at];
  if (!here || !isCaseKind(here.kind) || parameters.fromDatabase !== null) return null;
  const link = (i: number, rel: "prev" | "next") => {
    const c = cases[i];
    if (!c || !isCaseKind(c.kind)) return <span className="case-tour__none" aria-hidden="true" />;
    return (
      <Link to={caseHref(caseQueryOf(organism, c.query))} className={`case-tour__${rel}`}>
        {rel === "prev" ? "← " : ""}
        <span className="case-tour__dir">{rel === "prev" ? "Previous" : "Next"}:</span> {KIND_TEXT[c.kind].title}
        {rel === "next" ? " →" : ""}
      </Link>
    );
  };
  return (
    <nav className="case-tour" aria-label="The cases of this graph">
      <p className="case-tour__here">
        <span className="case-tour__count mono">
          {at + 1} / {cases.length}
        </span>{" "}
        A case of this graph: <strong>{KIND_TEXT[here.kind].title}</strong>
      </p>
      {link(at - 1, "prev")}
      {link(at + 1, "next")}
    </nav>
  );
}
