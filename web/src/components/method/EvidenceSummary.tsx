// How often idtrack is right, on one screen at the top of the Method page: every benchmark family's rate of right
// answers per organism (the judge its document says to read, else its first), each beside a quiet mark of its wrong
// share on panel f's axis, and, per task of family G, how idtrack's wrong share compares with the other tools' on the
// same lines. Every number is the benchmarks' published results' (src/generated/benchmarks.json), linked to panels f
// and g, where each is drawn whole with its counts and intervals.
import { useId, type CSSProperties } from "react";
import {
  BENCHMARK_ORGANISMS,
  BENCHMARKS,
  familyRows,
  judged,
  judgeWords,
  organismWord,
  rateText,
  taskComparison,
  wrongPosition,
} from "../../lib/benchmarks";
import { groupedInteger } from "../../lib/numbers";
import { Prose } from "../ui";
import { WrongAxis } from "./Benchmarks";

const plural = (n: number, one: string, many = `${one}s`) => `${groupedInteger(n)} ${n === 1 ? one : many}`;

/** One task's comparisons in words: who is wrong more often, and the range of the ratios of the wrong shares. */
function taskWords(c: ReturnType<typeof taskComparison>): string {
  const where = (x: { tool: string; organism: string }) =>
    c.tools === 1 ? organismWord(x.organism) : `${x.tool}, ${organismWord(x.organism)}`;
  const counts = [
    c.more ? `wrong more often than idtrack in ${groupedInteger(c.more)}` : null,
    c.same ? `as often in ${groupedInteger(c.same)}` : null,
    c.fewer ? `less often in ${groupedInteger(c.fewer)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lead =
    c.tools === 1
      ? `${c.only ?? "One tool"}, the one tool that poses it, is ${c.more === c.compared ? "wrong more often than idtrack in every organism" : `${counts} of ${plural(c.compared, "organism")}`}`
      : `Of ${plural(c.tools, "tool")} asked on the same lines, ${c.more === c.compared ? `every one is wrong more often than idtrack, in each of ${plural(c.compared, "organism comparison")}` : `${counts} of ${plural(c.compared, "tool and organism comparison")}`}`;
  const range =
    c.least && c.most
      ? c.least.ratio === c.most.ratio
        ? `: ${c.most.ratio} idtrack's wrong share (${where(c.most)})`
        : `: from ${c.least.ratio} idtrack's wrong share (${where(c.least)}) to ${c.most.ratio} (${where(c.most)})`
      : "";
  const apart = c.apart ? `; ${plural(c.apart, "cell")} not compared, no kept line having an answer` : "";
  return `${lead}${range}${apart}.`;
}

function TaskLine({ task, words }: { task: string; words: string }) {
  const c = taskComparison(task);
  if (!c.compared && !c.apart) return null;
  return (
    <li className="evidence__task">
      <span className="evidence__task-name">
        <span className="mono">{task}</span> {words}
      </span>
      <span className="evidence__task-words">{taskWords(c)}</span>
    </li>
  );
}

export function EvidenceSummary() {
  const id = useId();
  return (
    <section className="evidence" aria-labelledby={`${id}-title`}>
      <div className="evidence__head">
        <h2 id={`${id}-title`} className="evidence__title">
          How often it is right
        </h2>
        <p className="evidence__lede">
          The benchmarks of idtrack-reproducibility ask every line of their sets and judge each answer against
          Ensembl&apos;s own files and the authorities, never against idtrack. Right / judged per organism, the
          undetermined apart; each family drawn whole in <a href="#method-evidence">panel f</a>, the other tools in{" "}
          <a href="#method-tools">panel g</a>.
        </p>
      </div>
      <div className="evidence__frame" role="region" aria-label="Right / judged per family and organism" tabIndex={0}>
        <table className="evidence__table">
          <thead>
            <tr>
              <th scope="col">Family: what it asks</th>
              {BENCHMARK_ORGANISMS.map((o) => (
                <th key={o} scope="col" className="num">
                  {organismWord(o)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.families.map((family) => {
              const [first] = familyRows(family);
              if (!first) return null;
              return (
                <tr key={family.key}>
                  <th scope="row">
                    <span className="evidence__family">{family.title}</span>
                    <span className="evidence__measures">
                      <Prose text={family.measures} />
                      {first.judge ? `; judged ${judgeWords(first.judge).split(":")[0] ?? ""}` : ""}
                    </span>
                  </th>
                  {BENCHMARK_ORGANISMS.map((o) => {
                    const row = first.rows.get(o);
                    if (!row)
                      return (
                        <td key={o} className="num evidence__none" data-label={organismWord(o)}>
                          <span className="muted">no set</span>
                        </td>
                      );
                    const at = wrongPosition(judged(row).wrongShare);
                    return (
                      <td key={o} className="num" data-label={organismWord(o)}>
                        <span className="evidence__rate mono">{rateText(row.rate, row).text}</span>
                        <span className="evidence__mark" aria-hidden="true">
                          <WrongAxis />
                          {at === null ? (
                            <span className="bench__dot bench__dot--none" />
                          ) : (
                            <span className="bench__dot" style={{ "--at": at } as CSSProperties} />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 className="evidence__sub">The same lines asked of other tools</h3>
      <ul className="evidence__tasks">
        {Object.entries(BENCHMARKS.tools.tasks).map(([task, words]) => (
          <TaskLine key={task} task={task} words={words} />
        ))}
      </ul>
      <p className="evidence__note small">
        The mark beside each rate is its wrong share, wrong / judged, on panel f&apos;s logarithmic axis (one in a
        million at the left, all at the right). Many of another tool&apos;s wrong lines are questions it does not claim
        to answer: panel g says how many, tool by tool.
      </p>
    </section>
  );
}
