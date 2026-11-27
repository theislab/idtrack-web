// The evidence of how often the method agrees with its truth, as the benchmark repository publishes it
// (src/generated/benchmarks.json, made from idtrack-reproducibility's files at one commit): (f) each family's rate of
// right answers per organism on the tree of the release, with its counts, its undetermined lines, its interval (per
// line) and its surely weakest stratum (with the interval clustered by the unit that made the lines), what each family is
// judged against, and the one source its truth shares with idtrack; (g) the other tools asked the same lines, each
// beside idtrack on the same logarithmic axis of wrong answers, with their coverage and the repository's own reading.
// Every number is the generated file's, which is the repository's; nothing is rounded here but in a drawing's place,
// and a rate the source rounded to 1 while some answer is wrong is never written as 1.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import {
  BENCHMARK_ORGANISMS,
  BENCHMARKS,
  benchmarkFile,
  cleanStrata,
  familyParts,
  familyRows,
  hardest,
  idtrackWrongShare,
  intervalText,
  judged,
  measuredGraph,
  rateText,
  strataByRate,
  toolWrongShare,
  WRONG_TICKS,
  wrongPosition,
  wrongRatio,
  type Family,
  type FamilyRow,
  type Stratum,
  type ToolCell,
} from "../../lib/benchmarks";
import { groupedInteger } from "../../lib/numbers";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { Disclosure, Link, Mono, Prose, TableFrame } from "../ui";
import "../../styles/benchmarks.css";

const organismWord = (o: string) => commonName(o) ?? organismName(o);
const short = (commit: string) => commit.slice(0, 12);
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

/** "10⁻⁶": a power of ten as it is read. */
function Power({ exponent }: { exponent: number }) {
  if (exponent === 0) return <>1</>;
  return (
    <>
      10<sup>{exponent}</sup>
    </>
  );
}

/** The logarithmic axis of wrong shares both panels share: its ticks, labelled or not. */
function WrongAxis({ labels = false }: { labels?: boolean }) {
  return (
    <span className={`wrong-axis${labels ? " wrong-axis--labels" : ""}`} aria-hidden="true">
      {WRONG_TICKS.map((t) => (
        <span key={t.exponent} className="wrong-axis__tick" style={{ "--at": t.at } as CSSProperties}>
          {labels ? (
            <span className="wrong-axis__label">
              <Power exponent={t.exponent} />
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** The measured idtrack and the graphs, in plain words, with the repository's own words of its tree on request. */
function provenanceWords() {
  return {
    idtrack: (
      <>
        idtrack <Mono>{TREE.commit}</Mono>, whose answers are those of the release <Mono>{ANSWERS.release}</Mono> (
        <Mono>{ANSWERS.commit}</Mono>)
      </>
    ),
    results: (
      <>
        <a href={`${BENCHMARKS.repository}/tree/${BENCHMARKS.commit}`}>idtrack-reproducibility</a> at{" "}
        <Mono>{short(BENCHMARKS.commit)}</Mono>
      </>
    ),
  };
}

/** Whether the benchmarks measured a graph, for one organism's page: the graph of this content digest, the idtrack
 *  measured and the results read, in one short paragraph with a link to the rates. */
export function BenchmarkProvenance({ organism, digest }: { organism?: string; digest?: string | null }) {
  const words = provenanceWords();
  const same = organism !== undefined && measuredGraph(organism, digest ?? null);
  const asked = organism !== undefined && BENCHMARK_ORGANISMS.includes(organism);
  return (
    <span className="bench-provenance">
      {organism === undefined ? null : same ? (
        <>This graph: the benchmarks asked a graph of this content digest, </>
      ) : asked ? (
        <>Another graph: the benchmarks asked a graph of this organism with another content digest, </>
      ) : (
        <>The benchmarks asked no graph of this organism. They measured </>
      )}
      with {words.idtrack}; their results: {words.results}.{" "}
      {asked ? <Link to="/method#method-evidence">How often it agrees with its truth</Link> : null}
    </span>
  );
}

function Provenance() {
  const { organisms } = useOrganisms();
  const words = provenanceWords();
  const held = organisms.filter((o) => BENCHMARK_ORGANISMS.includes(o.organism));
  const same = held.filter((o) => measuredGraph(o.organism, o.content_digest));
  return (
    <dl className="bench-dl">
      <div>
        <dt>Measured</dt>
        <dd>{words.idtrack}</dd>
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
          {words.results}, the totals each family&apos;s document states for the tree of the release{" "}
          <Disclosure summary="The repository's words for the tree">
            <p className="small">
              <span className="mono">{TREE.name}</span>: <Prose text={TREE.what} />
            </p>
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
    <span
      className={`${className} mono`}
      title={`Published as ${r.published}; ${groupedInteger(counts.wrong)} wrong`}
      aria-label={`${r.text}, published as ${r.published}`}
    >
      {r.text}
    </span>
  );
}

function RateCell({
  row,
  label,
  stratum,
  axis = false,
}: {
  row: FamilyRow | undefined;
  label: string;
  stratum: Stratum | null;
  /** The labelled axis under the strip (on a phone, where the table's head is not shown). */
  axis?: boolean;
}) {
  if (!row)
    return (
      <td className="bench__cell bench__cell--none" data-label={label}>
        <span className="muted">no such set</span>
      </td>
    );
  const { judged: n, wrongShare } = judged(row);
  const at = wrongPosition(wrongShare);
  return (
    <td className="bench__cell" data-label={label}>
      <Rate published={row.rate} counts={row} className="bench__rate" />
      <span className="bench__interval">
        <span className="mono">{intervalText(row)}</span> per line
      </span>
      <span className="bench__track" aria-hidden="true">
        <WrongAxis />
        {at === null ? (
          <span className="bench__dot bench__dot--none" />
        ) : (
          <span className="bench__dot" style={{ "--at": at } as CSSProperties} />
        )}
      </span>
      {axis ? (
        <span className="bench__axis-phone" aria-hidden="true">
          <WrongAxis labels />
        </span>
      ) : null}
      <span className="bench__counts">
        wrong <span className="mono">{groupedInteger(row.wrong)}</span> /{" "}
        <span className="mono">{groupedInteger(n)}</span> judged
      </span>
      <span className="bench__und" aria-hidden="true">
        <span style={{ inlineSize: `${(row.undetermined / Math.max(1, row.n)) * 100}%` }} />
      </span>
      <span className="bench__counts">
        undetermined <span className="mono">{groupedInteger(row.undetermined)}</span> of{" "}
        <span className="mono">{groupedInteger(row.n)}</span> lines, not counted
      </span>
      {stratum ? (
        <span className="bench__hard">
          weakest stratum <code className="mono">{codeBreaks(stratum.stratum)}</code>:{" "}
          <Rate published={stratum.rate} counts={stratum} className="bench__hard-rate" />{" "}
          <span className="mono">({intervalText(stratum)})</span>, wrong{" "}
          <span className="mono">{groupedInteger(stratum.wrong)}</span> /{" "}
          <span className="mono">{groupedInteger(stratum.right + stratum.wrong)}</span> judged of{" "}
          <span className="mono">{groupedInteger(stratum.n)}</span> lines
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
        <a href={benchmarkFile(t.source)}>Its truth, in full</a>
      </p>
    </Disclosure>
  );
}

const SHOWN_STRATA = 5;

function StrataTable({ rows }: { rows: Stratum[] }) {
  return (
    <TableFrame label="Strata with a wrong answer" className="table-frame--cards bench-strata__frame">
      <table className="table table--cards bench-strata">
        <thead>
          <tr>
            <th scope="col">Stratum</th>
            <th scope="col">Organism</th>
            <th scope="col">Rate (interval)</th>
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
              <td data-label="Stratum">
                <code className="mono">{codeBreaks(s.stratum)}</code>
              </td>
              <td data-label="Organism">{organismWord(s.organism)}</td>
              <td data-label="Rate">
                <Rate published={s.rate} counts={s} className="" />{" "}
                <span className="mono muted">({intervalText(s)})</span>
                {s.interval === "cluster" ? null : <span className="muted"> Wilson</span>}
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

/** A code name that may break after each underscore, and only there (`b9_early_uniprot_genename`). */
function codeBreaks(code: string) {
  return code.split("_").map((part, i, all) => (
    <span key={i}>
      {part}
      {i < all.length - 1 ? (
        <>
          _<wbr />
        </>
      ) : null}
    </span>
  ));
}

/** Every stratum of a family with a wrong answer, the lowest rate first: five at once, the rest on request. */
function Strata({ family }: { family: Family }) {
  const rows = strataByRate(family);
  const clean = cleanStrata(family);
  const twoJudges = familyRows(family).length > 1;
  if (!rows.length) return null;
  return (
    <Disclosure summary={`Its ${rows.length} strata with a wrong answer, the surely weakest first`}>
      <StrataTable rows={rows.slice(0, SHOWN_STRATA)} />
      {rows.length > SHOWN_STRATA ? (
        <Disclosure summary={`and ${rows.length - SHOWN_STRATA} more`}>
          <StrataTable rows={rows.slice(SHOWN_STRATA)} />
        </Disclosure>
      ) : null}
      <p className="small muted">
        Strata without a wrong answer: {clean.map(([o, k]) => `${organismWord(o)} ${k}`).join(", ")}.
        {twoJudges ? " Strata as the first judge scores them." : ""} Intervals clustered by the unit that made the
        lines.
      </p>
    </Disclosure>
  );
}

function JudgeLabel({ judge }: { judge: string }) {
  const words = judge === "now" ? BENCHMARKS.judges.now : judge === "decided" ? BENCHMARKS.judges.decided : judge;
  return (
    <span className="bench__judge" title={`judge ${judge}`}>
      Judged by <Prose text={words} />
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
        title="How often idtrack agrees with Ensembl's records and the authorities"
        href={BENCHMARKS.repository}
      />
      <p className="method-panel__lede">
        idtrack&apos;s answers are measured by the benchmarks of{" "}
        <a href={BENCHMARKS.repository}>idtrack-reproducibility</a>, each family a kind of question asked of every line
        its sets hold, first the lists users bring. In the repository&apos;s words: <Prose text={BENCHMARKS.truth} />
      </p>
      <p className="bench-caveat" role="note">
        <strong>What a truth shares with idtrack.</strong> In the benchmarks&apos; words:{" "}
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
                <span className="small muted">Wrong share of the answers judged</span>
              </td>
              {BENCHMARK_ORGANISMS.map((o) => (
                <td key={o}>
                  <WrongAxis labels />
                </td>
              ))}
            </tr>
          </thead>
          {BENCHMARKS.families.map((family, fi) => {
            const groups = familyRows(family);
            const parts = familyParts(family);
            return (
              <tbody key={family.key} className="bench__family">
                {groups.map(({ judge, rows }, gi) => (
                  <tr key={judge ?? "all"}>
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
                      {judge ? <JudgeLabel judge={judge} /> : null}
                      {gi === groups.length - 1 && parts.length ? (
                        <span className="bench__parts">
                          {parts.length === 1 ? "One part" : `${parts.length} parts`} measured apart: in its document
                        </span>
                      ) : null}
                    </th>
                    {BENCHMARK_ORGANISMS.map((o) => (
                      <RateCell
                        key={o}
                        row={rows.get(o)}
                        label={organismWord(o)}
                        stratum={judge === null || judge === "now" ? hardest(family, o) : null}
                        axis={fi === 0 && gi === 0}
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
          The wrong share of the answers judged, on a logarithmic axis from one in a million (left) to all (right),
          ticks at 10⁻⁶, 10⁻⁴, 10⁻² and 1
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
      <p className="fig-caption fig-caption--wide" id={captionId}>
        <strong>f</strong> Each family&apos;s totals on the tree of the release, per organism, as its methods document
        states them (linked by the family&apos;s name): the rate of right answers among those judged right or wrong,
        with its Wilson 95 % interval, and the counts it rests on; undetermined answers (where the truth cannot decide)
        are apart and never counted. The interval is per line: one identifier gives many lines, which are not
        independent (in the methods&apos; words, &ldquo;
        <Prose text={intervals.wilson} />
        &rdquo;), and a line scored under two views counts twice. Under it, the family&apos;s surely weakest stratum
        (the lowest upper end of its interval), with the interval of the cluster bootstrap,{" "}
        <Prose text={intervals.cluster} /> Every stratum with a wrong answer is listed under each family. Families B and
        E score the same answers under two judges, which their documents define. Rates as idtrack-reproducibility
        publishes them (5 decimals here, 4 in the strata and in g); a rate it rounds to 1 while some answer is wrong is
        written &quot;&gt; 0.99999&quot;; every count is exact. Every total was checked, when the page was built,
        against the result files it sums (<span className="mono">results/index.tsv</span>, B&apos;s{" "}
        <span className="mono">report_b.tsv</span>, E&apos;s <span className="mono">e_summary.tsv</span>). &quot;No such
        set&quot;: the family has no set for the organism.
      </p>
    </section>
  );
}

const TASKS = Object.entries(BENCHMARKS.tools.tasks);

/** A tool's wrong share beside idtrack's on the same lines, on the logarithmic axis of panel f. */
function ToolStrip({ cell }: { cell: ToolCell }) {
  const tool = toolWrongShare(cell);
  const ours = idtrackWrongShare(cell);
  const at = (share: number) => wrongPosition(share) ?? 0;
  const a = at(tool);
  // idtrack's share where none is wrong: at the left end; where a published 1 bounds it only, at that bound.
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
        <span className="tools__vs"> · idtrack </span>
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
            ? "idtrack's wrong share under 1 in 10 000"
            : "idtrack: none wrong"
          : ratio
            ? `${ratio} idtrack's wrong share`
            : "the tool: none wrong"}
      </span>
      <span className="tools__kept">
        <span className="mono">{groupedInteger(cell.kept)}</span> lines kept of{" "}
        <span className="mono">{groupedInteger(cell.posed)}</span> posed; coverage{" "}
        <Rate published={cell.coverage} counts={{ right: 0, wrong: 0 }} digits={4} className="" />
        {cell.notAnswered ? (
          <>
            ; <span className="mono">{groupedInteger(cell.notAnswered)}</span> not answered by the service
          </>
        ) : null}
      </span>
    </>
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
      <p className="method-panel__lede">
        Family G asks the tools people use for the same questions the same lines, judged by the same truth and the same
        scorer as idtrack, from their responses as fetched and stored. Each tool&apos;s wrong share is drawn beside
        idtrack&apos;s on the same lines (those the tool could be asked and the rule of equal truth kept), by the task
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
      <TableFrame label="Tools against idtrack on the same lines" className="bench-frame table-frame--cards">
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
                <span className="small muted">Wrong share on the same lines</span>
              </td>
              {tools.organisms.map((o) => (
                <td key={o}>
                  <WrongAxis labels />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.subject}>
                <th scope="row">
                  <Prose text={r.tool} />
                </th>
                {r.cells.map((c, i) =>
                  c ? (
                    <td key={c.organism} className="tools__cell" data-label={organismWord(c.organism)}>
                      <ToolStrip cell={c} />
                      {ri === 0 ? (
                        <span className="bench__axis-phone" aria-hidden="true">
                          <WrongAxis labels />
                        </span>
                      ) : null}
                      <ToolValues cell={c} />
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
          idtrack&apos;s on the same lines (a filled dot)
        </li>
        <li>
          <span className="bench__track bench__track--legend" aria-hidden="true">
            <WrongAxis />
            <span className="tools__idtrack tools__idtrack--none" style={{ "--at": 0 } as CSSProperties} />
          </span>
          idtrack with no wrong answer (a ring at the left end); where a published 1 only bounds it, the ring stands at
          that bound
        </li>
      </ul>
      <p className="fig-caption fig-caption--wide" id={captionId}>
        <strong>g</strong> The rate of right answers of each tool and idtrack&apos;s on the same kept lines (the reading
        of the input <span className="mono">best</span>, the view <span className="mono">all</span>: in the
        document&apos;s words, <Prose text={tools.viewAll} />
        ), from{" "}
        <a href={benchmarkFile(tools.source)}>
          <span className="mono">{tools.source}</span>
        </a>{" "}
        as the family&apos;s document shows it, every rate to 4 decimals as published; drawn as the wrong share (one
        minus the rate) on the logarithmic axis of panel f, the tool&apos;s from its counts, idtrack&apos;s from its
        published rate; their ratio is the range that half a unit of idtrack&apos;s last decimal leaves, or one value
        (&quot;about&quot;) where that range is narrow. Coverage, in the document&apos;s words:{" "}
        <Prose text={tools.coverage} />; the lines a service did not answer on the dates asked are never scored.
        &quot;Not posed&quot;: the tool cannot pose the task for the organism. In the repository&apos;s words:{" "}
        <Prose text={tools.reading} />
      </p>
    </section>
  );
}
