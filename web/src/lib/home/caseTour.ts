// Where an answer stands among the cases of the graph's showcase, read from the showcase's queries alone
// (`GET .../showcase/queries`): the verdict's top line (components/home/CaseTour.tsx).
import { api } from "../../api/client";
import type { ConvertParameters } from "../convertParameters";
import { caseIndex } from "../showcase";
import { useRequest } from "../useRequest";
import { isCaseKind, type CaseKind } from "./caseKinds";
import type { caseQueryOf } from "./links";

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
  const cases = queries.answer.data.cases.flatMap((c) =>
    isCaseKind(c.kind) ? [{ kind: c.kind, query: c.query }] : [],
  );
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
