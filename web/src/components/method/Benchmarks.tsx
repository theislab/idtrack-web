// The evidence of how often the method agrees with its truth, as the benchmark repository publishes it
// (src/generated/benchmarks.json, made from idtrack-reproducibility's files at one commit): (f) each family's rate of
// right answers per organism on the code of the release, with its counts, its undetermined lines, its interval (per
// line) and its surely weakest part (with the interval clustered by the unit that made the lines), what each family is
// judged against, and the one source its truth shares with idtrack; (g) the other tools asked the same lines, each
// beside IDTrack on the same logarithmic axis of wrong answers, with their coverage and what the repository's reading of
// their wrong lines found. Every number is the generated file's, which is the repository's; nothing is rounded here but
// in a drawing's place and in an interval computed from the counts where the published one has no width (said so), and
// a rate the source rounded to 1 while some answer is wrong is never written as 1.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import {
  BENCHMARK_ORGANISMS,
  BENCHMARKS,
  benchmarkFile,
  cleanStrata,
  comparable,
  familyParts,
  familyRows,
  hardest,
  idtrackWrongShare,
  judgeWords,
  organismWord,
  powerParts,
  judged,
  measuredGraph,
  rateText,
  shownInterval,
  strataByRate,
  stratumMeaning,
  toolWrongShare,
  WRONG_TICKS,
  wrongOnly,
  wrongOnlyCounts,
  wrongPosition,
  wrongRatio,
  type Family,
  type FamilyRow,
  type Stratum,
  type Tool,
  type ToolCell,
} from "../../lib/benchmarks";
import { groupedInteger } from "../../lib/numbers";
import { useOrganisms } from "../../lib/organisms";
import { Disclosure, Mono, Prose, TableFrame } from "../ui";
import { HoverCard } from "../v2/HoverCard";
import "../../styles/benchmarks.css";

const TREE = BENCHMARKS.tree;
const ANSWERS = TREE.answers;

function PanelHead({ letter, id, title, href }: { letter: string; id: string; title: string; href: string }) {
  return (
    <div className="method-panel__head">
      <span className="panel-letter" aria-hidden="true">
        {letter}
      </span>
      <h2 id={id}>{title}</h2>
      <a className="method-panel__docs" href={href}>
        The benchmarks
      </a>
    </div>
  );
}

/** A tick's label: "10" with its exponent raised (11 px), or "1". */
function AxisLabel({ exponent }: { exponent: number }) {
  const parts = powerParts(exponent);
  return (
    <span className="wrong-axis__label">
      {parts ? (
        <>
          {parts.base}
          <span className="wrong-axis__exp">{parts.exponent}</span>
        </>
      ) : (
        "1"
      )}
    </span>
  );
}

/** The logarithmic axis of wrong shares both panels share: its ticks, labelled or not. */
export function WrongAxis({ labels = false }: { labels?: boolean }) {
  return (
    <span className={`wrong-axis${labels ? " wrong-axis--labels" : ""}`} aria-hidden="true">
      {WRONG_TICKS.map((t) => (
        <span key={t.exponent} className="wrong-axis__tick" style={{ "--at": t.at } as CSSProperties}>
          {labels ? <AxisLabel exponent={t.exponent} /> : null}
        </span>
      ))}
    </span>
  );
}

/** The provenance in roles, with every commit and the repository's own words on request. */
function Provenance() {
  const { organisms } = useOrganisms();
  const held = organisms.filter((o) => BENCHMARK_ORGANISMS.includes(o.organism));
  const same = held.filter((o) => measuredGraph(o.organism, o.content_digest));
  return (
    <dl className="bench-dl">
      <div>
        <dt>Measured</dt>
        <dd>IDTrack&apos;s code at its release {ANSWERS.release}, whose answers are the release&apos;s</dd>
      </div>
      <div className="bench__graphs">
        <dt>Graphs</dt>
        <dd>
          {held.length && same.length === held.length ? (
            <>
              <strong>Measured on the graphs this server holds:</strong> the {held.length} graphs of this server have
              the content digests of the graphs the benchmarks asked.
            </>
          ) : (
            <>
              <strong>Measured on other graphs</strong> for{" "}
              {held
                .filter((o) => !same.includes(o))
                .map((o) => organismWord(o.organism))
                .join(", ") || "every organism"}
              : this server&apos;s content digest differs from the benchmarks&apos; graph.
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Results</dt>
        <dd>
          published by <a href={`${BENCHMARKS.repository}/tree/${BENCHMARKS.commit}`}>idtrack-reproducibility</a>, the
          totals each family&apos;s document states for the code of the release{" "}
          <Disclosure summary="The exact commits and the repository's words">
            <ul className="bench-commits small">
              <li>
                Results: idtrack-reproducibility at <Mono>{BENCHMARKS.commit}</Mono>
              </li>
              <li>
                The code measured: the tree <Mono>{TREE.name}</Mono>, IDTrack <Mono>{TREE.commit}</Mono>; in the
                repository&apos;s words, <Prose text={TREE.what} />
              </li>
              <li>
                The release whose answers it has: {ANSWERS.release}, IDTrack <Mono>{ANSWERS.commit}</Mono>
              </li>
              <li>
                The two judges of B and E, in the repository&apos;s words: <Mono>now</Mono>,{" "}
                <Prose text={BENCHMARKS.judges.now} />; <Mono>decided</Mono>, <Prose text={BENCHMARKS.judges.decided} />{" "}
                (where <Prose text={BENCHMARKS.judges.when} />)
              </li>
            </ul>
          </Disclosure>
        </dd>
      </div>
    </dl>
  );
}

/** A rate written as `rateText` writes it, with the published text on focus where the two differ. */
function Rate({
  published,
  counts,
  digits,
  className,
}: {
  published: string;
  counts: { right: number; wrong: number };
  digits?: number;
  className: string;
}) {
  const r = rateText(published, counts, digits);
  if (!r.rounded) return <span className={`${className} mono`}>{r.text}</span>;
  return (
    <HoverCard className="bench__rounded" triggerClassName={`${className} bench__rounded-button mono`} trigger={r.text}>
      <span className="bench__rounded-card">
        Published as <span className="mono">{r.published}</span>
        {counts.wrong ? (
          <>
            ; <span className="mono">{groupedInteger(counts.wrong)}</span> wrong, so it is written below 1
          </>
        ) : null}
        .
      </span>
    </HoverCard>
  );
}

/** A stratum by what it asks, in its document's words; its code (the repository's name of it) in a hover card on the
 *  words, opened by pointing, focus or a press. A stratum the document does not describe is its code. */
function StratumName({ family, stratum }: { family: Family; stratum: string }) {
  const meaning = stratumMeaning(family, stratum);
  if (!meaning) return <code className="mono bench__code">{stratum}</code>;
  return (
    <HoverCard className="bench__stratum" triggerClassName="bench__stratum-button" trigger={<Prose text={meaning} />}>
      <span className="bench__stratum-card">
        Its code in the benchmarks: <code className="mono">{stratum}</code>
      </span>
    </HoverCard>
  );
}

/** A family row's interval, published, or from its counts where the published one has no width (said so). */
function RowInterval({ row }: { row: FamilyRow }) {
  const shown = shownInterval(row);
  return (
    <>
      <span className="mono">{shown.text}</span> per line
      {shown.method === "published" ? null : (
        <span className="bench__method"> ({shown.method === "exact" ? "exact" : "Wilson"}, from the counts)</span>
      )}
    </>
  );
}

/** A stratum's interval: the published one, or the one computed from its counts where the published one has no width. */
function StratumInterval({ stratum }: { stratum: Stratum }) {
  const shown = shownInterval(stratum);
  return (
    // The values in the monospaced face, the method in words beside them: the line may break between the two.
    <span className="bench__interval-of">
      (<span className="mono">{shown.text}</span>
      {shown.method === "published" ? null : (
        <span className="bench__method"> {shown.method === "exact" ? "exact" : "Wilson"}</span>
      )}
      )
    </span>
  );
}

function RateCell({
  family,
  row,
  label,
  headline,
  organism,
}: {
  family: Family;
  row: FamilyRow | undefined;
  label: string;
  /** The family's headline judge: its weakest part and its lines that can only be judged wrong are said. */
  headline: boolean;
  organism: string;
}) {
  if (!row)
    return (
      <td className="bench__cell bench__cell--none" data-label={label}>
        <span className="muted">no such set</span>
      </td>
    );
  const { judged: n, wrongShare } = judged(row);
  const at = wrongPosition(wrongShare);
  const weakest = headline ? hardest(family, organism) : null;
  const apart = headline ? wrongOnlyCounts(family, organism) : null;
  return (
    <td className="bench__cell" data-label={label}>
      <span className="bench__headline">
        <Rate published={row.rate} counts={row} className="bench__rate" />
        <span className="bench__what">right / judged</span>
      </span>
      <span className="bench__interval">
        <RowInterval row={row} />
      </span>
      <span className="bench__track" aria-hidden="true">
        <WrongAxis />
        {at === null ? (
          <span className="bench__dot bench__dot--none" />
        ) : (
          <span className="bench__dot" style={{ "--at": at } as CSSProperties} />
        )}
      </span>
      <span className="bench__axis-phone" aria-hidden="true">
        <WrongAxis labels />
      </span>
      <span className="bench__counts bench__counts--dot">
        {row.wrong ? <span className="bench__dot-key" aria-hidden="true" /> : null}
        wrong <span className="mono">{groupedInteger(row.wrong)}</span> of{" "}
        <span className="mono">{groupedInteger(n)}</span> judged
      </span>
      {headline ? (
        <>
          <span className="bench__und" aria-hidden="true">
            <span style={{ inlineSize: `${(row.undetermined / Math.max(1, row.n)) * 100}%` }} />
          </span>
          <span className="bench__counts">
            undetermined <span className="mono">{groupedInteger(row.undetermined)}</span> of{" "}
            <span className="mono">{groupedInteger(row.n)}</span> lines, not counted
          </span>
        </>
      ) : null}
      {weakest ? (
        <span className="bench__hard">
          <span className="bench__hard-lead">Weakest part:</span>{" "}
          <StratumName family={family} stratum={weakest.stratum} />:{" "}
          <Rate published={weakest.rate} counts={weakest} className="bench__hard-rate" />{" "}
          <StratumInterval stratum={weakest} />, wrong <span className="mono">{groupedInteger(weakest.wrong)}</span> of{" "}
          <span className="mono">{groupedInteger(weakest.right + weakest.wrong)}</span> judged
        </span>
      ) : null}
      {apart?.strata ? (
        <span className="bench__apart">
          <span className="bench__hard-lead">Not rated:</span>{" "}
          <span className="mono">{groupedInteger(apart.wrong)}</span> of{" "}
          <span className="mono">{groupedInteger(apart.n)}</span> lines answered wrong in{" "}
          {apart.strata === 1 ? "a part" : `${apart.strata} parts`} where no answer can be judged right
        </span>
      ) : null}
    </td>
  );
}

/** What a family is judged against, in its document's words. */
function Truth({ family }: { family: Family }) {
  const t = family.truth;
  return (
    <Disclosure summary="What it is judged against">
      <p className="bench__truth">
        <Prose text={t.opening} />
      </p>
      {t.items.length ? (
        <ul className="bench__truth-items">
          {t.items.map((item) => (
            <li key={item.lead}>
              <strong>
                <Prose text={item.lead} />
              </strong>
              : <Prose text={item.text} />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="small">
        <a href={benchmarkFile(t.source)} className="bench__link">
          Its truth, in full
        </a>
      </p>
    </Disclosure>
  );
}

const SHOWN_STRATA = 5;

/** A disclosure whose body is made only once it is first opened (and kept after), so that the page's first layout
 *  does not pay for the tables folded in it; the same markup and behaviour as the shared `Disclosure`. */
function FoldedOnce({ summary, children }: { summary: ReactNode; children: () => ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="disclosure"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">{opened ? children() : null}</div>
    </details>
  );
}

function StrataTable({ family, rows }: { family: Family; rows: Stratum[] }) {
  return (
    <TableFrame label="Parts with a wrong answer" className="table-frame--cards bench-strata__frame">
      <table className="table table--cards bench-strata">
        <thead>
          <tr>
            <th scope="col">Part (what its lines ask)</th>
            <th scope="col">Organism</th>
            <th scope="col">Right / judged (interval)</th>
            <th scope="col" className="num">
              Wrong / judged
            </th>
            <th scope="col" className="num">
              Undetermined
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.organism}-${s.stratum}`}>
              <td data-label="Part">
                <StratumName family={family} stratum={s.stratum} />
              </td>
              <td data-label="Organism">{organismWord(s.organism)}</td>
              <td data-label="Right / judged">
                {wrongOnly(family, s.stratum) ? (
                  <span className="muted">not rated: no answer can be judged right</span>
                ) : (
                  <>
                    <Rate published={s.rate} counts={s} className="" /> <StratumInterval stratum={s} />
                  </>
                )}
              </td>
              <td data-label="Wrong / judged" className="num">
                <span className="mono">
                  {groupedInteger(s.wrong)} / {groupedInteger(s.right + s.wrong)}
                </span>
              </td>
              <td data-label="Undetermined" className="num">
                <span className="mono">{groupedInteger(s.undetermined)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** Every part (stratum) of a family with a wrong answer: those surely the weakest first, five at once, the rest on
 *  request; then the parts where no answer can be judged right, as counts. */
function Strata({ family }: { family: Family }) {
  const all = strataByRate(family);
  const rated = all.filter((s) => !wrongOnly(family, s.stratum));
  const apart = all.filter((s) => wrongOnly(family, s.stratum));
  const clean = cleanStrata(family);
  if (!all.length) return null;
  const judge = family.strata.judge;
  return (
    <FoldedOnce summary={`Its ${rated.length} parts with a wrong answer, the surely weakest first`}>
      {() => (
        <>
          <StrataTable family={family} rows={rated.slice(0, SHOWN_STRATA)} />
          {rated.length > SHOWN_STRATA ? (
            <FoldedOnce summary={`and ${rated.length - SHOWN_STRATA} more`}>
              {() => <StrataTable family={family} rows={rated.slice(SHOWN_STRATA)} />}
            </FoldedOnce>
          ) : null}
          {apart.length ? (
            <>
              <p className="small bench__note">
                Parts where no line is judged right in any organism, said as counts and never as a rate
                {family.truth.openWithin ? (
                  <>
                    {" "}
                    (their lines are open: in the family&apos;s words, <Prose text={family.truth.openWithin} />)
                  </>
                ) : null}
                :
              </p>
              <StrataTable family={family} rows={apart} />
            </>
          ) : null}
          <p className="small muted bench__note">
            Parts without a wrong answer: {clean.map(([o, k]) => `${organismWord(o)} ${k}`).join(", ")}.
            {judge ? ` Judged ${judgeWords(judge)}.` : ""} Intervals clustered by the unit that made the lines; where
            the published interval has no width, the interval from the counts (exact where every judged line is right or
            every one wrong, else Wilson). Each part&apos;s words are its family&apos;s document&apos;s (
            <a href={benchmarkFile(family.strata.source)}>its sets</a>), its code on focus.
          </p>
        </>
      )}
    </FoldedOnce>
  );
}

function JudgeLabel({ judge, read }: { judge: string; read: boolean }) {
  return (
    <span className="bench__judge">
      Judged {judgeWords(judge)}
      {read ? <span className="bench__judge-read"> — the rate its document says to read</span> : null}
    </span>
  );
}

export function AccuracyPanel() {
  const captionId = useId();
  const intervals = BENCHMARKS.intervals;
  return (
    <section className="panel method-panel" aria-labelledby="method-evidence">
      <PanelHead
        letter="f"
        id="method-evidence"
        title="How often IDTrack agrees with Ensembl's records and the authorities"
        href={BENCHMARKS.repository}
      />
      <p className="method-panel__lede bench-lede">
        IDTrack&apos;s answers are measured by the benchmarks of{" "}
        <a href={BENCHMARKS.repository}>idtrack-reproducibility</a>, each family a kind of question asked of every line
        its sets hold. In the repository&apos;s words: <Prose text={BENCHMARKS.truth} />
      </p>
      <p className="bench-caveat" role="note">
        <strong>What a truth shares with IDTrack.</strong> In the benchmarks&apos; words:{" "}
        <Prose text={BENCHMARKS.historyCaveat} /> The families whose truth walks Ensembl&apos;s history say so under
        their name.
      </p>
      <Provenance />
      <TableFrame label="Accuracy of the benchmark families" className="bench-frame table-frame--cards">
        <table className="bench table--cards" aria-describedby={captionId}>
          <thead>
            <tr>
              <th scope="col">Family</th>
              {BENCHMARK_ORGANISMS.map((o) => (
                <th key={o} scope="col">
                  {organismWord(o)}
                </th>
              ))}
            </tr>
            <tr className="bench__axis-row">
              <td>
                <span className="bench__key">
                  <span className="bench__key-line">
                    <strong>Number</strong>: right / judged, its 95 % interval per line
                  </span>
                  <span className="bench__key-line">
                    <strong>Dot</strong>: wrong / judged, log scale
                  </span>
                </span>
              </td>
              {BENCHMARK_ORGANISMS.map((o) => (
                <td key={o}>
                  <WrongAxis labels />
                </td>
              ))}
            </tr>
          </thead>
          {BENCHMARKS.families.map((family) => {
            const groups = familyRows(family);
            const parts = familyParts(family);
            return (
              <tbody key={family.key} className="bench__family">
                {groups.map(({ judge, rows }, gi) => (
                  <tr key={judge ?? "all"} className={gi ? "bench__second" : undefined}>
                    <th scope="row" className="bench__name">
                      {gi === 0 ? (
                        <>
                          <a href={benchmarkFile(family.source)} className="bench__title">
                            {family.title}
                          </a>
                          <span className="bench__measures">
                            <Prose text={family.measures} />
                          </span>
                          {family.truth.history ? (
                            <span className="bench__history">Its truth walks Ensembl&apos;s history</span>
                          ) : null}
                          <Truth family={family} />
                        </>
                      ) : null}
                      {judge ? <JudgeLabel judge={judge} read={gi === 0 && family.readJudge === judge} /> : null}
                      {gi === groups.length - 1 && parts.length ? (
                        <span className="bench__parts">
                          {parts.length === 1 ? "One part" : `${parts.length} parts`} measured apart: in its document
                        </span>
                      ) : null}
                    </th>
                    {BENCHMARK_ORGANISMS.map((o) => (
                      <RateCell
                        key={o}
                        family={family}
                        row={rows.get(o)}
                        label={organismWord(o)}
                        headline={gi === 0}
                        organism={o}
                      />
                    ))}
                  </tr>
                ))}
                {family.strata.rows.length ? (
                  <tr className="bench__strata">
                    <td colSpan={BENCHMARK_ORGANISMS.length + 1}>
                      <Strata family={family} />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            );
          })}
        </table>
      </TableFrame>
      <ul className="fig-legend" aria-label="Legend">
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="bench__dot" style={{ "--at": 0.5 } as CSSProperties} />
          </span>
          The wrong share of the answers judged (wrong / judged), on a logarithmic axis from one in a million (left) to
          all (right)
        </li>
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="bench__dot bench__dot--none" />
          </span>
          No wrong answer
        </li>
        <li>
          <span className="bench__und bench__und--legend" aria-hidden="true">
            <span style={{ inlineSize: "40%" }} />
          </span>
          The share of the lines that are undetermined (linear, of all lines)
        </li>
      </ul>
      <div className="fig-caption bench-caption" id={captionId}>
        <p>
          <strong>f</strong> Each family&apos;s totals on the code of the release, per organism, as its methods document
          states them (linked by the family&apos;s name). The number is the rate of right answers among those judged
          right or wrong, with its Wilson 95 % interval; the dot is the other share, wrong / judged, on a logarithmic
          axis, and its counts are written beside it. Undetermined answers (where the truth cannot decide) are apart and
          never counted.
        </p>
        <p>
          The interval is per line: one identifier gives many lines, which are not independent (in the methods&apos;
          words, &ldquo;
          <Prose text={intervals.wilson} />
          &rdquo;), and a line scored under two views counts twice. Under it, the family&apos;s surely weakest part (the
          lowest upper end of its interval), with the interval of the cluster bootstrap,{" "}
          <Prose text={intervals.cluster} /> A part in which no line can be judged right in any organism is said as a
          count, never as the weakest rate.
        </p>
        <p>
          Families B and E score the same answers under two judges; the first row is the one the family&apos;s document
          says to read for this code where it says so, else the document&apos;s first. Rates as idtrack-reproducibility
          publishes them (5 decimals here, 4 in the parts and in g); a rate it rounds to 1 while some answer is wrong is
          written &quot;&gt; 0.99999&quot;; every count is exact. Every total was checked, when the page was built,
          against the result files it sums (<span className="mono">results/index.tsv</span>, B&apos;s{" "}
          <span className="mono">report_b.tsv</span>, E&apos;s <span className="mono">e_summary.tsv</span>). &quot;No
          such set&quot;: the family has no set for the organism.
        </p>
      </div>
    </section>
  );
}

const TASKS = Object.entries(BENCHMARKS.tools.tasks);

/** A tool's wrong share beside IDTrack's on the same lines, on the logarithmic axis of panel f. */
function ToolStrip({ cell }: { cell: ToolCell }) {
  const tool = toolWrongShare(cell);
  const ours = idtrackWrongShare(cell);
  const at = (share: number) => wrongPosition(share) ?? 0;
  const a = at(tool);
  // IDTrack's share where none is wrong: at the left end; where a published 1 bounds it only, at that bound.
  const b = ours.share === 0 && ours.bounded ? at(0.5e-4) : at(ours.share);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return (
    <span className="bench__track tools__strip" aria-hidden="true">
      <WrongAxis />
      <span className="tools__segment" style={{ "--lo": lo, "--hi": hi } as CSSProperties} />
      <span className="tools__tool" style={{ "--at": a } as CSSProperties} />
      <span
        className={`tools__idtrack${ours.share === 0 ? " tools__idtrack--none" : ""}`}
        style={{ "--at": b } as CSSProperties}
      />
    </span>
  );
}

function Coverage({ cell }: { cell: ToolCell }) {
  return (
    <span className="tools__kept">
      <span className="mono">{groupedInteger(cell.kept)}</span> lines kept of{" "}
      <span className="mono">{groupedInteger(cell.posed)}</span> posed; coverage{" "}
      <Rate published={cell.coverage} counts={{ right: 0, wrong: 0 }} digits={4} className="" /> (kept lines with an
      answer)
      {cell.notAnswered ? (
        <>
          ; <span className="mono">{groupedInteger(cell.notAnswered)}</span> not answered by the service
        </>
      ) : null}
    </span>
  );
}

function ToolValues({ cell }: { cell: ToolCell }): ReactNode {
  const tool = toolWrongShare(cell);
  const ours = idtrackWrongShare(cell);
  const ratio = wrongRatio(tool, ours.share);
  return (
    <>
      <span className="tools__values">
        <Rate
          published={cell.rate}
          counts={{ right: cell.right, wrong: cell.wrong + cell.error }}
          digits={4}
          className="tools__tool-rate"
        />
        <span className="tools__vs"> · IDTrack </span>
        <Rate
          published={cell.idtrack}
          counts={{ right: 1, wrong: ours.bounded ? 1 : 0 }}
          digits={4}
          className="tools__idtrack-rate"
        />
      </span>
      <span className="tools__ratio">
        {ours.share === 0
          ? ours.bounded
            ? "IDTrack's wrong share under 1 in 10 000"
            : "IDTrack: none wrong"
          : ratio
            ? `${ratio} IDTrack's wrong share`
            : "the tool: none wrong"}
      </span>
      <Coverage cell={cell} />
    </>
  );
}

/** A cell that cannot be set beside IDTrack's: no kept line has an answer. */
function NotComparable({ cell }: { cell: ToolCell }) {
  return (
    <>
      <span className="tools__apart">
        Not compared: no kept line has an answer, so its right lines (
        <Rate
          published={cell.rate}
          counts={{ right: cell.right, wrong: cell.wrong + cell.error }}
          digits={4}
          className=""
        />
        ) are those whose truth is nothing.{" "}
        <a href={benchmarkFile(BENCHMARKS.tools.readingSource)}>Why, in the family&apos;s reading</a>
      </span>
      <Coverage cell={cell} />
    </>
  );
}

/** What the family's reading of a sample of the tool's wrong lines found, per task (every organism together). */
function ToolReading({ tool }: { tool: Tool }) {
  const r = tool.reading;
  if (!r) return null;
  const pc = (n: number) => `${n}\u00a0%`;
  return (
    <span className="tools__reading">
      Of <span className="mono">{groupedInteger(r.read)}</span> sampled wrong lines (weighted shares, every organism):{" "}
      {pc(r.truly)} truly wrong, {pc(r.another)} right under another reading, {pc(r.notClaimed)} not a question it
      claims{r.failed ? `, ${pc(r.failed)} the service failed` : ""}
    </span>
  );
}

/** That family G is no ranking of the tools, and why: said first, before any comparison. */
export function NotRanking() {
  return (
    <p className="bench-caveat bench-caveat--first" role="note">
      <strong>Not a ranking of the tools.</strong> The lines ask what IDTrack answers: a string as the release it was
      read at named it. Most tools read today&apos;s tables, so many of their disagreements with the truth are questions
      they do not claim to answer; under each tool, the family&apos;s reading of a sample of them says how many (
      <a href={benchmarkFile(BENCHMARKS.tools.readingSource)}>the reading of the disagreements</a>).
    </p>
  );
}

export function ToolsPanel() {
  const [task, setTask] = useState(TASKS.find(([t]) => t === "c")?.[0] ?? TASKS[0]?.[0] ?? "a");
  const captionId = useId();
  const tools = BENCHMARKS.tools;
  const rows = tools.tools.filter((t) => t.task === task);
  return (
    <section className="panel method-panel" aria-labelledby="method-tools">
      <PanelHead
        letter="g"
        id="method-tools"
        title="The same lines asked of other tools"
        href={benchmarkFile(tools.table)}
      />
      <p className="method-panel__lede bench-lede">
        Family G asks the tools people use the same questions on the same lines, judged by the same truth and the same
        scorer as IDTrack, from their responses as fetched and stored. Each tool&apos;s wrong share is drawn beside
        IDTrack&apos;s on the same lines (those the tool could be asked and the rule of equal truth kept), by the task
        of the line, on the axis of panel f.
      </p>
      <div className="tool-tasks" role="radiogroup" aria-label="The task of the lines">
        {TASKS.map(([code, words]) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={task === code}
            className={`tool-tasks__item${task === code ? " tool-tasks__item--on" : ""}`}
            onClick={() => {
              setTask(code);
            }}
          >
            <span className="mono">{code}</span> {words}
          </button>
        ))}
      </div>
      <TableFrame label="Tools against IDTrack on the same lines" className="bench-frame table-frame--cards">
        <table className="tools table--cards" aria-describedby={captionId}>
          <thead>
            <tr>
              <th scope="col">Tool</th>
              {tools.organisms.map((o) => (
                <th key={o} scope="col">
                  {organismWord(o)}
                </th>
              ))}
            </tr>
            <tr className="bench__axis-row">
              <td>
                <span className="bench__key">
                  <span className="bench__key-line">
                    <strong>Numbers</strong>: right / judged, the tool&apos;s · IDTrack&apos;s
                  </span>
                  <span className="bench__key-line">
                    <strong>Marks</strong>: wrong / judged, log scale
                  </span>
                </span>
              </td>
              {tools.organisms.map((o) => (
                <td key={o}>
                  <WrongAxis labels />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subject}>
                <th scope="row" className="tools__name">
                  <Prose text={r.tool} />
                  <ToolReading tool={r} />
                </th>
                {r.cells.map((c, i) =>
                  c ? (
                    <td key={c.organism} className="tools__cell" data-label={organismWord(c.organism)}>
                      {comparable(c) ? (
                        <>
                          <ToolStrip cell={c} />
                          <span className="bench__axis-phone" aria-hidden="true">
                            <WrongAxis labels />
                          </span>
                          <ToolValues cell={c} />
                        </>
                      ) : (
                        <NotComparable cell={c} />
                      )}
                    </td>
                  ) : (
                    <td
                      key={tools.organisms[i]}
                      className="tools__cell tools__cell--none"
                      data-label={organismWord(tools.organisms[i] ?? "")}
                    >
                      <span className="muted">not posed: the tool cannot ask it for this organism</span>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <ul className="fig-legend" aria-label="Legend">
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="tools__tool" style={{ "--at": 0.5 } as CSSProperties} />
          </span>
          The tool&apos;s wrong share (an open circle)
        </li>
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="tools__idtrack" style={{ "--at": 0.5 } as CSSProperties} />
          </span>
          IDTrack&apos;s on the same lines (a filled dot)
        </li>
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="tools__idtrack tools__idtrack--none" style={{ "--at": 0 } as CSSProperties} />
          </span>
          IDTrack with no wrong answer (a ring at the left end); where a published 1 only bounds it, the ring stands at
          that bound
        </li>
      </ul>
      <div className="fig-caption bench-caption" id={captionId}>
        <p>
          <strong>g</strong> The rate of right answers of each tool and IDTrack&apos;s on the same kept lines (the
          reading of the input <span className="mono">best</span>, the view <span className="mono">all</span>: in the
          document&apos;s words, <Prose text={tools.viewAll} />
          ), from{" "}
          <a href={benchmarkFile(tools.source)}>
            <span className="mono">{tools.source}</span>
          </a>{" "}
          as the family&apos;s document shows it, every rate to 4 decimals as published; drawn as the wrong share (one
          minus the rate) on the logarithmic axis of panel f, the tool&apos;s from its counts, IDTrack&apos;s from its
          published rate.
        </p>
        <p>
          Their ratio is the range that half a unit of IDTrack&apos;s last decimal leaves, or one value
          (&quot;about&quot;) where that range is narrow. Coverage, in the document&apos;s words:{" "}
          <Prose text={tools.coverage} />; a right line may hold no answer where the truth is nothing, so a tool whose
          kept lines hold no answer is not compared. The lines a service did not answer on the dates asked are never
          scored. &quot;Not posed&quot;: the tool cannot pose the task for the organism.
        </p>
        <p>
          In the repository&apos;s words: <Prose text={tools.reading} />
        </p>
      </div>
    </section>
  );
}
