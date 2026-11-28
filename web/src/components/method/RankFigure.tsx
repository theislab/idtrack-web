// Stage d on a real answer, drawn: IDTrack's criteria as a ladder in the order they decide (the api's vocabulary), the
// best answer and the runner-up side by side on each rung, a thread beside the ladder that runs as one while the two are
// equal, parts at the rung that decides (`decided_by`: the best answer's dot filled, the runner-up's open) and runs on
// faint below it, where nothing is compared, as IDTrack's ranking defines it. The runner-up is the first candidate that
// is not best (IDTrack's results name no runner-up); the values are the api's, by their type. The rungs are grouped as
// IDTrack's documentation groups them (the gene's own version; the lineage: which entry gene; the successors of one
// entry gene); each criterion's name opens what it compares (a hover card).
import { Fragment, useMemo } from "react";
import type { ConversionResult } from "../../api/types";
import { buildModel } from "../../lib/pathModel";
import { criterionValue, firstWords } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { firstSentence, readerText } from "../../lib/method/readerText";
import { groupedInteger } from "../../lib/numbers";
import { Mono, Prose } from "../ui";
import { Defined } from "./Defined";

/** The group of the criterion at `i` of the order, as IDTrack's documentation groups them. */
function groupOf(i: number): { key: string; words: string } {
  if (i === 0) return { key: "own", words: "The gene's own version" };
  if (i <= 5) return { key: "lineage", words: "The lineage: which entry gene" };
  return { key: "successors", words: "The successors of one entry gene" };
}

export function RankFigure({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const decision = useMemo(() => buildModel(result).decision, [result]);
  if (!decision || !vocabulary.criteria.length) {
    return <p className="muted">The api&apos;s answer or vocabulary gives no decision to draw.</p>;
  }
  const at = vocabulary.criteria.findIndex((c) => c.code === decision.key);
  const deciding = vocabulary.criteria.find((c) => c.code === decision.key);
  const best = decision.best.api;
  const runner = decision.runnerUp.api;
  const reached = result.candidates.length;
  return (
    <div className="rank-fig">
      <p className="rank-fig__reached">
        <Mono>{groupedInteger(reached)}</Mono> candidates reached; the best answer beside the runner-up
      </p>
      <table className="rank-fig__table">
        <caption className="visually-hidden">
          The best answer and the runner-up on each of IDTrack&apos;s criteria, in the order they decide
        </caption>
        <thead>
          <tr>
            <th scope="col" className="rank-fig__rail-head">
              <span className="visually-hidden">The thread of the two</span>
            </th>
            <th scope="col">Criterion</th>
            <th scope="col">
              Best answer <Mono strong>{best.gene}</Mono>
            </th>
            <th scope="col">
              Runner-up <Mono>{runner.gene}</Mono>
            </th>
            <th scope="col">
              <span className="visually-hidden">Outcome</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {vocabulary.criteria.map((c, i) => {
            const state = i < at ? "equal" : i === at ? "decides" : "after";
            const a = criterionValue(c, best);
            const b = criterionValue(c, runner);
            const group = groupOf(i);
            const opens = i === 0 || groupOf(i - 1).key !== group.key;
            const last = i === vocabulary.criteria.length - 1;
            return (
              <Fragment key={c.code}>
                {opens ? (
                  <tr className="rank-fig__group">
                    <td
                      aria-hidden="true"
                      className={`rank-fig__rail rank-fig__rail--${i <= at ? "equal" : "after"}`}
                    />
                    <th scope="rowgroup" colSpan={4}>
                      {group.words}
                    </th>
                  </tr>
                ) : null}
                <tr className={`rank-fig__row rank-fig__row--${state}${last ? " rank-fig__row--last" : ""}`}>
                  <td className="rank-fig__rail" aria-hidden="true">
                    <span className="rank-fig__dot rank-fig__dot--a" />
                    {state === "decides" ? <span className="rank-fig__dot rank-fig__dot--b" /> : null}
                  </td>
                  <th scope="row" className="rank-fig__code">
                    <Defined code={c.code} meaning={c.meaning}>
                      {c.fields.length ? (
                        <span className="defined__fields">
                          Compares {c.fields.map((f) => firstWords(f)).join("; then ")}
                        </span>
                      ) : null}
                    </Defined>
                  </th>
                  <td className="mono rank-fig__value" data-label="Best">
                    {state === "after" ? "" : a.text}
                  </td>
                  <td className="mono rank-fig__value" data-label="Runner-up">
                    {state === "after" ? "" : b.text}
                  </td>
                  <td className="rank-fig__state">
                    {state === "equal" ? "equal" : state === "decides" ? "decides" : "not compared"}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {deciding?.meaning ? (
        <p className="rank-fig__meaning">
          <span className="rank-fig__meaning-lead">Decided by {spaced(decision.key)}:</span>{" "}
          <Prose text={readerText(firstSentence(deciding.meaning))} />
        </p>
      ) : null}
    </div>
  );
}
