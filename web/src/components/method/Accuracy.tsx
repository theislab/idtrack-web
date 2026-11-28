// How often IDTrack is right, on the Method page: one organism at a time (a segmented control), each benchmark family's
// rate of right answers under the judge its document says to read, beside a quiet mark of its wrong share on the axis
// of the families' whole figure; what each family asks in a hover card on its name. Behind tabs: every organism at
// once (the matrix), each family drawn whole (Benchmarks.tsx, AccuracyPanel) and the other tools on the same lines
// (ToolsPanel, with how they compare in words above it). Every number is the benchmarks' published results'
// (src/generated/benchmarks.json).
import { useState, type CSSProperties } from "react";
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
import { useOrganisms } from "../../lib/organisms";
import { Prose } from "../ui";
import { HoverCard } from "../v2/HoverCard";
import { Segmented } from "../v2/Segmented";
import { Tabs } from "../v2/Tabs";
import { AccuracyPanel, ToolsPanel, WrongAxis } from "./Benchmarks";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const plural = (n: number, one: string, many = `${one}s`) => `${groupedInteger(n)} ${n === 1 ? one : many}`;

type Family = (typeof BENCHMARKS.families)[number];

/** One task's comparisons in words: who is wrong more often, and the range of the ratios of the wrong shares. */
function taskWords(c: ReturnType<typeof taskComparison>): string {
  const where = (x: { tool: string; organism: string }) =>
    c.tools === 1 ? organismWord(x.organism) : `${x.tool}, ${organismWord(x.organism)}`;
  const counts = [
    c.more ? `wrong more often than IDTrack in ${groupedInteger(c.more)}` : null,
    c.same ? `as often in ${groupedInteger(c.same)}` : null,
    c.fewer ? `less often in ${groupedInteger(c.fewer)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lead =
    c.tools === 1
      ? `${c.only ?? "One tool"}, the one tool that poses it, is ${c.more === c.compared ? "wrong more often than IDTrack in every organism" : `${counts} of ${plural(c.compared, "organism")}`}`
      : `Of ${plural(c.tools, "tool")} asked on the same lines, ${c.more === c.compared ? `every one is wrong more often than IDTrack, in each of ${plural(c.compared, "organism comparison")}` : `${counts} of ${plural(c.compared, "tool and organism comparison")}`}`;
  const range =
    c.least && c.most
      ? c.least.ratio === c.most.ratio
        ? `: ${c.most.ratio} IDTrack's wrong share (${where(c.most)})`
        : `: from ${c.least.ratio} IDTrack's wrong share (${where(c.least)}) to ${c.most.ratio} (${where(c.most)})`
      : "";
  const apart = c.apart ? `; ${plural(c.apart, "cell")} not compared, no kept line having an answer` : "";
  return `${lead}${range}${apart}.`;
}

/** A family's name, with what it asks and how it is judged in a hover card (also on focus and on a press). */
function FamilyName({ family }: { family: Family }) {
  const [first] = familyRows(family);
  return (
    <span className="accuracy__family">
      <span className="accuracy__family-name">{family.title}</span>
      <HoverCard
        className="accuracy__about"
        triggerClassName="accuracy__about-button"
        label={`What ${family.title} asks`}
        trigger={
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
          </svg>
        }
      >
        <span className="accuracy__measures">
          <Prose text={family.measures} />
          {first?.judge ? `; judged ${judgeWords(first.judge).split(":")[0] ?? ""}` : ""}.
        </span>
      </HoverCard>
    </span>
  );
}

/** A rate and its wrong share's mark, as one cell. */
function Rate({ family, organism }: { family: Family; organism: string }) {
  const [first] = familyRows(family);
  const row = first?.rows.get(organism);
  if (!row) return <span className="muted accuracy__none">no set</span>;
  const at = wrongPosition(judged(row).wrongShare);
  return (
    <>
      <span className="accuracy__rate mono">{rateText(row.rate, row).text}</span>
      <span className="accuracy__mark" aria-hidden="true">
        <WrongAxis />
        {at === null ? (
          <span className="bench__dot bench__dot--none" />
        ) : (
          <span className="bench__dot" style={{ "--at": at } as CSSProperties} />
        )}
      </span>
    </>
  );
}

/** Every family's rate for one organism, chosen with a segmented control (the organism in view, where measured). */
function OneOrganism() {
  const { current } = useOrganisms();
  // The organism in view where the benchmarks measured it, until another is chosen.
  const [chosen, setOrganism] = useState<string | null>(null);
  const organism =
    chosen ??
    (current && BENCHMARK_ORGANISMS.includes(current.organism) ? current.organism : (BENCHMARK_ORGANISMS[0] ?? ""));
  return (
    <div className="accuracy__one">
      <Segmented
        className="accuracy__organisms"
        label="The organism measured"
        value={organism}
        onChange={setOrganism}
        options={BENCHMARK_ORGANISMS.map((o) => ({ value: o, label: capitalised(organismWord(o)) }))}
      />
      <div className="accuracy__frame" role="region" aria-label={`Right / judged per family, ${organismWord(organism)}`}>
        <table className="accuracy__table">
          <thead>
            <tr>
              <th scope="col">Family</th>
              <th scope="col" className="num">
                Right / judged, {capitalised(organismWord(organism))}
              </th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.families.map((family) =>
              familyRows(family).length ? (
                <tr key={family.key}>
                  <th scope="row">
                    <FamilyName family={family} />
                  </th>
                  <td className="num">
                    <Rate family={family} organism={organism} />
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every family's rate in every organism (the matrix). */
function AllOrganisms() {
  return (
    <div className="accuracy__frame" role="region" aria-label="Right / judged per family and organism" tabIndex={0}>
      <table className="accuracy__table accuracy__table--all">
        <thead>
          <tr>
            <th scope="col">Family</th>
            {BENCHMARK_ORGANISMS.map((o) => (
              <th key={o} scope="col" className="num">
                {capitalised(organismWord(o))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BENCHMARKS.families.map((family) =>
            familyRows(family).length ? (
              <tr key={family.key}>
                <th scope="row">
                  <FamilyName family={family} />
                </th>
                {BENCHMARK_ORGANISMS.map((o) => (
                  <td key={o} className="num" data-label={organismWord(o)}>
                    <Rate family={family} organism={o} />
                  </td>
                ))}
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The other tools on the same lines: per task, in words, then the table of panel g. */
function OtherTools() {
  return (
    <>
      <ul className="accuracy__tasks">
        {Object.entries(BENCHMARKS.tools.tasks).map(([task, words]) => {
          const c = taskComparison(task);
          if (!c.compared && !c.apart) return null;
          return (
            <li key={task} className="accuracy__task">
              <span className="accuracy__task-name">
                <span className="mono">{task}</span> {words}
              </span>
              <span className="accuracy__task-words">{taskWords(c)}</span>
            </li>
          );
        })}
      </ul>
      <ToolsPanel />
    </>
  );
}

/** The section "How often it is right": its lede, then the tabs. `?accuracy=` keeps the tab in the address. */
export function Accuracy() {
  return (
    <section className="accuracy" aria-labelledby="accuracy-title">
      <div className="method-section__head">
        <h2 id="accuracy-title">How often it is right</h2>
        <p className="method-section__lede">
          The benchmarks ask every line of their sets and judge each answer against Ensembl&apos;s own files and the
          authorities, never against IDTrack.
        </p>
      </div>
      <Tabs
        label="How often it is right"
        param="accuracy"
        className="accuracy__tabs"
        items={[
          { id: "organism", label: "One organism", panel: () => <OneOrganism /> },
          { id: "all", label: "All organisms", panel: () => <AllOrganisms /> },
          { id: "family", label: "Each family whole", panel: () => <AccuracyPanel /> },
          { id: "tools", label: "Other tools", panel: () => <OtherTools /> },
        ]}
      />
      <p className="accuracy__note small">
        The rate is right / judged, the undetermined lines apart; the mark beside it is the wrong share, wrong / judged,
        on a logarithmic axis (one in a million at the left, all at the right). Many of another tool&apos;s wrong lines
        are questions it does not claim to answer: Other tools says how many, tool by tool.
      </p>
    </section>
  );
}
