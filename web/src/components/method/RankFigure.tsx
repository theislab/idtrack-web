// Stage d on a real answer: the ranking as a ladder of idtrack's criteria in the order they decide (the api's
// vocabulary), the best answer and the runner-up side by side on each rung: equal on every rung above the one that
// decides (`decided_by`), different on it, and not compared below it, as idtrack's ranking defines it. The runner-up is
// the first candidate that is not best (idtrack's results name no runner-up); the values are the api's, by their type.
import { useMemo } from "react";
import type { ConversionResult } from "../../api/types";
import { buildModel } from "../../lib/pathModel";
import { criterionValue } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { readerText } from "../../lib/method/readerText";
import { Mono, Prose } from "../ui";

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
  return (
    <div className="rank-fig">
      <table className="rank-fig__table">
        <caption className="visually-hidden">
          The best answer and the runner-up on each of idtrack&apos;s criteria, in the order they decide
        </caption>
        <thead>
          <tr>
            <th scope="col" className="rank-fig__n">
              <span className="visually-hidden">Order</span>
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
            return (
              <tr key={c.code} className={`rank-fig__row rank-fig__row--${state}`}>
                <td className="rank-fig__n mono">{i + 1}</td>
                <th scope="row" className="rank-fig__code">
                  <span className="mono">{spaced(c.code)}</span>
                </th>
                <td className="mono rank-fig__value" data-label="Best" title={a.title}>
                  {state === "after" ? "" : a.text}
                </td>
                <td className="mono rank-fig__value" data-label="Runner-up" title={b.title}>
                  {state === "after" ? "" : b.text}
                </td>
                <td className="rank-fig__state">
                  {state === "equal" ? "equal" : state === "decides" ? "decides" : "not compared"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {deciding?.meaning ? (
        <p className="rank-fig__meaning">
          <span className="label">Decided by {spaced(decision.key)}</span> <Prose text={readerText(deciding.meaning)} />
        </p>
      ) : null}
    </div>
  );
}
