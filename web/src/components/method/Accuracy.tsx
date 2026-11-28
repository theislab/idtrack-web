// How often IDTrack is right, on the Method page. The section's lede says first, measured and scoped, how often IDTrack
// agrees with an independent reading of Ensembl's records and the authorities. Then tabs: one organism at a time (a
// segmented control, the organism kept in the address), each benchmark family's rate of right answers under the judge
// its document says to read, the share of its lines judged beside it, and its wrong share as a mark on one labelled
// logarithmic axis shared by every row; what each family is judged against and what it asks in a hover card on its
// name, the families whose truth walks Ensembl's history tagged. Behind tabs: every organism at once (the matrix), each
// family drawn whole (Benchmarks.tsx, AccuracyPanel) and the other tools on the same lines (ToolsPanel, first that it is
// not a ranking, then how they compare in words). Every number is the benchmarks' published results'
// (src/generated/benchmarks.json).
import type { CSSProperties } from "react";
import {
  BENCHMARK_ORGANISMS,
  BENCHMARKS,
  benchmarkFile,
  familyRows,
  judged,
  judgedText,
  judgeWords,
  organismWord,
  rateRange,
  rateText,
  taskComparison,
  taskWords,
  truthFromIdtrack,
  wrongPosition,
  type FamilyRow,
} from "../../lib/benchmarks";
import { firstSentence } from "../../lib/method/readerText";
import { groupedInteger } from "../../lib/numbers";
import { useOrganisms } from "../../lib/organisms";
import { navigate, useLocation } from "../../lib/router";
import { Prose } from "../ui";
import { HoverCard } from "../v2/HoverCard";
import { Segmented } from "../v2/Segmented";
import { Tabs } from "../v2/Tabs";
import { AccuracyPanel, NotRanking, ToolsPanel, WrongAxis } from "./Benchmarks";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const plural = (n: number, one: string, many = `${one}s`) => `${groupedInteger(n)} ${n === 1 ? one : many}`;

type Family = (typeof BENCHMARKS.families)[number];

/** The benchmark's organisms in the site's order (the server's list of its graphs), those it does not hold after. */
function useSiteOrder(): string[] {
  const { organisms } = useOrganisms();
  const held = organisms.map((o) => o.organism).filter((o) => BENCHMARK_ORGANISMS.includes(o));
  return [...held, ...BENCHMARK_ORGANISMS.filter((o) => !held.includes(o))];
}

/** A family's name, with what it is judged against and what it asks in a hover card (also on focus and on a press);
 *  the families whose truth walks Ensembl's history tagged. */
function FamilyName({ family }: { family: Family }) {
  const [first] = familyRows(family);
  const shared = truthFromIdtrack(family);
  const t = family.truth;
  return (
    <span className="accuracy__family">
      <span className="accuracy__family-name">{family.title}</span>
      <HoverCard
        className="accuracy__about"
        triggerClassName="accuracy__about-button"
        label={`What ${family.title} is judged against`}
        trigger={
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
          </svg>
        }
      >
        <span className="accuracy__measures">
          <span className="accuracy__card-line">
            <strong>Judged against:</strong> <Prose text={t.opening} />
            {t.items.length ? (
              <>
                {" "}
                Its parts: <Prose text={t.items.map((i) => i.lead).join("; ")} />.
              </>
            ) : null}
          </span>
          {t.history ? (
            <span className="accuracy__card-line">
              <strong>Its truth walks Ensembl&apos;s history.</strong> In the benchmarks&apos; words:{" "}
              <Prose text={BENCHMARKS.historyCaveat} />
            </span>
          ) : null}
          {shared.map((item) => (
            <span key={item.lead} className="accuracy__card-line">
              <strong>
                <Prose text={capitalised(item.lead)} />:
              </strong>{" "}
              <Prose text={firstSentence(item.text)} />
            </span>
          ))}
          <span className="accuracy__card-line">
            <strong>What it asks:</strong> <Prose text={family.measures} />
            {first?.judge ? `; judged ${judgeWords(first.judge).split(":")[0] ?? ""}` : ""}.
          </span>
          <a className="accuracy__card-link" href={benchmarkFile(t.source)}>
            Its truth, in full
          </a>
        </span>
      </HoverCard>
      {t.history ? <span className="accuracy__tag">truth from Ensembl&apos;s history</span> : null}
    </span>
  );
}

/** The share of a row's lines judged, with its counts on focus, pointing or a press. */
function Judged({ row }: { row: FamilyRow }) {
  return (
    <HoverCard
      className="accuracy__judged"
      triggerClassName="accuracy__judged-button mono"
      trigger={<>judged {judgedText(row)}</>}
    >
      <span className="accuracy__judged-card">
        <span className="mono">{groupedInteger(row.right + row.wrong)}</span> of{" "}
        <span className="mono">{groupedInteger(row.n)}</span> lines judged right or wrong;{" "}
        <span className="mono">{groupedInteger(row.undetermined)}</span> undetermined (the truth cannot decide), not
        counted. Wrong: <span className="mono">{groupedInteger(row.wrong)}</span>.
      </span>
    </HoverCard>
  );
}

/** A rate as published, with the published text and its counts on focus where the page writes it otherwise. */
function RateValue({ row, className = "" }: { row: FamilyRow; className?: string }) {
  const r = rateText(row.rate, row);
  if (!r.rounded) return <span className={`accuracy__rate mono ${className}`}>{r.text}</span>;
  return (
    <HoverCard
      className="accuracy__rated"
      triggerClassName={`accuracy__rate accuracy__rate--rounded mono ${className}`}
      trigger={r.text}
    >
      <span className="accuracy__judged-card">
        Published as <span className="mono">{r.published}</span>;{" "}
        <span className="mono">{groupedInteger(row.wrong)}</span> wrong of{" "}
        <span className="mono">{groupedInteger(row.right + row.wrong)}</span> judged, so the rate is written below 1.
      </span>
    </HoverCard>
  );
}

/** A wrong share's mark on the shared axis. */
function Mark({ row }: { row: FamilyRow }) {
  const at = wrongPosition(judged(row).wrongShare);
  return (
    <span className="accuracy__mark" aria-hidden="true" style={{ "--at": at ?? 0 } as CSSProperties}>
      <WrongAxis />
      {at === null ? (
        <span className="bench__dot bench__dot--none" />
      ) : (
        <>
          <span className="accuracy__stem" />
          <span className="bench__dot" />
        </>
      )}
    </span>
  );
}

/** The axis's head: the measure and its labelled ticks, once for every row under it. */
function AxisHead() {
  return (
    <span className="accuracy__axis-head">
      <span className="accuracy__axis-name">Wrong / judged, log scale</span>
      <WrongAxis labels />
    </span>
  );
}

/** The organism of the accuracy chosen: the address's (`?organism=`) where the benchmarks measured it, else the
 *  organism in view where they did, else the first. */
function useAccuracyOrganism(order: readonly string[]): [string, (organism: string) => void] {
  const { current } = useOrganisms();
  const location = useLocation();
  const asked = location.search.get("organism");
  const organism =
    asked && BENCHMARK_ORGANISMS.includes(asked)
      ? asked
      : current && BENCHMARK_ORGANISMS.includes(current.organism)
        ? current.organism
        : (order[0] ?? "");
  const choose = (next: string) => {
    const search = new URLSearchParams(window.location.search);
    search.set("organism", next);
    navigate(`${window.location.pathname}?${search.toString()}`, { replace: true });
  };
  return [organism, choose];
}

/** Every family's rate for one organism, chosen with a segmented control (kept in the address). */
function OneOrganism() {
  const order = useSiteOrder();
  const [organism, choose] = useAccuracyOrganism(order);
  return (
    <div className="accuracy__one">
      <Segmented
        className="accuracy__organisms"
        label="The organism measured"
        value={organism}
        onChange={choose}
        options={order.map((o) => ({ value: o, label: capitalised(organismWord(o)) }))}
      />
      <div
        className="accuracy__frame"
        role="region"
        aria-label={`Right / judged per family, ${organismWord(organism)}`}
      >
        <table className="accuracy__table">
          <thead>
            <tr>
              <th scope="col">Family</th>
              <th scope="col" className="num accuracy__rate-head">
                Right / judged
              </th>
              <th scope="col" className="accuracy__judged-head">
                <span className="visually-hidden">Share of the lines judged</span>
              </th>
              <th scope="col" className="accuracy__axis-col">
                <AxisHead />
              </th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.families.map((family) => {
              const [first] = familyRows(family);
              if (!first) return null;
              const row = first.rows.get(organism);
              return (
                <tr key={family.key}>
                  <th scope="row">
                    <FamilyName family={family} />
                  </th>
                  {row ? (
                    <>
                      <td className="num">
                        <RateValue row={row} />
                      </td>
                      <td className="accuracy__judged-cell">
                        <Judged row={row} />
                      </td>
                      <td className="accuracy__axis-col">
                        <Mark row={row} />
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted accuracy__none">
                      no set for this organism
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every family's rate in every organism (the matrix), each cell's mark on the axis labelled at its column's head. */
function AllOrganisms() {
  const order = useSiteOrder();
  return (
    <div className="accuracy__frame" role="region" aria-label="Right / judged per family and organism" tabIndex={0}>
      <table className="accuracy__table accuracy__table--all">
        <thead>
          <tr>
            <th scope="col">Family</th>
            {order.map((o) => (
              <th key={o} scope="col" className="num">
                {capitalised(organismWord(o))}
              </th>
            ))}
          </tr>
          <tr className="accuracy__axis-row">
            <td>
              <span className="accuracy__axis-name">Right / judged; judged share; wrong / judged, log scale</span>
            </td>
            {order.map((o) => (
              <td key={o}>
                <WrongAxis labels />
              </td>
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
                  <FamilyName family={family} />
                </th>
                {order.map((o) => {
                  const row = first.rows.get(o);
                  return (
                    <td key={o} className="num" data-label={organismWord(o)}>
                      {row ? (
                        <>
                          <RateValue row={row} />
                          <Judged row={row} />
                          <Mark row={row} />
                        </>
                      ) : (
                        <span className="muted accuracy__none">no set</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The other tools on the same lines: first that it is not a ranking, then per task in words, then panel g. */
function OtherTools() {
  return (
    <>
      <NotRanking />
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

/** The section's first sentence: the range of the headline rates, with its scope, measured. */
function AccuracyLede() {
  const range = rateRange();
  if (!range) return null;
  const at = (x: NonNullable<typeof range>["low"]) =>
    `${x.family.title.split(",")[0] ?? x.family.title}, ${organismWord(x.organism)}`;
  return (
    <p className="method-section__lede">
      Over {plural(range.families, "family", "families")} of questions in {plural(range.organisms, "organism")},
      IDTrack&apos;s answers agree with an independent reading of Ensembl&apos;s records and the authorities on{" "}
      <span className="mono">{rateText(range.low.row.rate, range.low.row).text}</span> ({at(range.low)}) to{" "}
      <span className="mono">{rateText(range.high.row.rate, range.high.row).text}</span> ({at(range.high)}) of the lines
      judged. Where a family&apos;s truth walks Ensembl&apos;s history, it tests IDTrack&apos;s use of that history, not
      the history.
    </p>
  );
}

/** The section "How often it is right": its lede, then the tabs. `?accuracy=` keeps the tab in the address. */
export function Accuracy() {
  return (
    <section className="accuracy" id="accuracy" aria-labelledby="accuracy-title">
      <div className="method-section__head">
        <h2 id="accuracy-title">How often it is right</h2>
        <AccuracyLede />
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
        The rate is right / judged; the lines the truth cannot decide (undetermined) are not counted, and how many were
        judged stands beside it. The mark is the wrong share on one logarithmic axis.
      </p>
    </section>
  );
}
