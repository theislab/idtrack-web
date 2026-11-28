// Panel d of a result: the decision (the best answer and the runner-up compared criterion by criterion in idtrack's
// order, the deciding criterion marked, with its meaning from the vocabulary) and every candidate, ranked, each with its
// whole ranking record on request.
import { startTransition, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Candidate, ConversionResult } from "../api/types";
import { databaseLabel } from "../lib/databases";
import type { Highlight } from "../lib/highlight";
import { groupedInteger } from "../lib/numbers";
import type { Decision } from "../lib/pathModel";
import { ABSENT, criterionValue, firstWords, yesNo } from "../lib/values";
import { criterionOf, spaced, type Criterion } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { RECORD, shortScore, SUCCESSOR_CRITERIA } from "../lib/resultWords";
import { IdMenu, SymbolOf, type IdContext } from "./IdMenu";
import { CriterionTerm, CriterionValue, ScoreValue, Term } from "./ResultParts";
import { Toggletip } from "./Toggletip";
import { usePhone } from "../lib/usePhone";
import { navigate } from "../lib/router";
import { Button, Mono, Prose, TableFrame } from "./ui";

/** The candidates of the first ranks that every drawing of the path holds (a phone's drawing holds four): each of them
 *  can be drawn strong on the Path tab from its row. */
const ON_PATH = 4;

/** Open the answer's Path tab (the first: the address without `tab`). */
function showPath() {
  const search = new URLSearchParams(window.location.search);
  search.delete("tab");
  const text = search.toString();
  navigate(`${window.location.pathname}${text ? `?${text}` : ""}`, { replace: true });
}

/** A value as the sentence of the decision writes it: every decimal of more than six significant digits cut after
 *  its sixth with "…" (never rounded), the whole value as IDTrack gave it a press or a pointing away. */
function SentenceValue({ text, title }: { text: string; title?: string | undefined }) {
  const cut = text.replace(/\d+\.\d+/g, (m) => shortScore(Number(m)).text);
  if (cut === text && !title) return <Mono>{text}</Mono>;
  return (
    <Toggletip
      className="decision__value value-tip"
      tip={
        <span className="term__card">
          As IDTrack gave it: <span className="mono">{text}</span>
          {title ? (
            <>
              . <span className="term__meaning">{title}</span>
            </>
          ) : null}
        </span>
      }
    >
      <span className="mono" aria-hidden="true">
        {cut}
      </span>
      <span className="visually-hidden">{text}</span>
    </Toggletip>
  );
}

function DecisionText({ decision, context }: { decision: Decision; context: IdContext }) {
  const vocabulary = useVocabulary();
  const criterion: Criterion = criterionOf(vocabulary, decision.key) ?? {
    code: decision.key,
    meaning: null,
    fields: [],
  };
  const [meanings, setMeanings] = useState(false);
  const criteria = vocabulary.criteria.length ? vocabulary.criteria : RECORD;
  const at = criteria.findIndex((c) => c.code === decision.key);
  const best = decision.best.api;
  const runner = decision.runnerUp.api;
  const bestValue = criterionValue(criterion, best);
  const runnerValue = criterionValue(criterion, runner);
  const sortKey = bestValue.sortKey === true;
  return (
    <div className="decision">
      {/* The decision in one sentence: the pair compared, the criterion that decided (its meaning and how it ranks a
          press or a pointing away), and the values it compared. */}
      <p className="decision__sentence">
        <Mono strong>{best.target}</Mono> ranks before the runner-up{" "}
        <IdMenu id={runner.target} release={context.toRelease} context={context} />
        <SymbolOf gene={runner.gene} context={context} except={runner.target} lead=" " /> (rank{" "}
        {decision.runnerUp.index + 1}), decided by{" "}
        <Toggletip
          className="decision__key"
          tip={
            <span className="term__card">
              {criterion.meaning ? (
                <span className="term__meaning decision__meaning">
                  <Prose text={criterion.meaning} />
                </span>
              ) : (
                <span className="term__meaning decision__meaning muted">The api gives no text for this criterion.</span>
              )}
              {criterion.fields.length ? (
                <span className="decision__rule">{criterion.fields.map(firstWords).join("; ")}.</span>
              ) : null}{" "}
              <code className="term__code mono">{criterion.code}</code>
            </span>
          }
        >
          {spaced(decision.key)}
        </Toggletip>
        {at >= 0 && vocabulary.criteria.length ? (
          <>
            , criterion {at + 1} of the {vocabulary.criteria.length} in IDTrack&apos;s order
          </>
        ) : null}
        : <SentenceValue text={bestValue.text} title={bestValue.note} /> against{" "}
        <SentenceValue text={runnerValue.text} title={runnerValue.note} />.
      </p>
      <div className="decision__compare">
        <table className="compare">
          <caption>
            The best answer and the runner-up, criterion by criterion in the order in which IDTrack compares them; the
            first criterion in which they differ decides, and no criterion after it is compared.
            {vocabulary.criteria.length ? (
              <>
                {" "}
                <Button
                  variant="quiet"
                  className="compare__toggle"
                  aria-expanded={meanings}
                  onClick={() => setMeanings((m) => !m)}
                >
                  {meanings ? "Hide what each criterion means" : "Show what each criterion means"}
                </Button>
              </>
            ) : null}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="compare__n">
                #
              </th>
              <th scope="col">Criterion</th>
              <th scope="col">
                Best answer <Mono strong>{best.target}</Mono>
              </th>
              <th scope="col">
                Runner-up <Mono>{runner.target}</Mono>{" "}
                <span className="muted">(rank {decision.runnerUp.index + 1})</span>
              </th>
              <th scope="col">Compared</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c, i) => {
              const state = at < 0 ? "unknown" : i < at ? "equal" : i === at ? "decides" : "after";
              return (
                <tr key={c.code} className={`compare__row compare__row--${state}`}>
                  <td className="compare__n mono">{i + 1}</td>
                  <th scope="row" className="compare__criterion">
                    <CriterionTerm criterion={c} />
                    {meanings && c.meaning ? (
                      <span className="compare__meaning">
                        <Prose text={c.meaning} />
                      </span>
                    ) : null}
                  </th>
                  <td data-label="Best answer">
                    <CriterionValue criterion={c} candidate={best} />
                  </td>
                  <td data-label={`Runner-up (rank ${decision.runnerUp.index + 1})`}>
                    <CriterionValue criterion={c} candidate={runner} />
                  </td>
                  <td className="compare__state" data-label="Compared">
                    {state === "equal" ? (
                      "equal"
                    ) : state === "decides" ? (
                      <span className="tag tag--decides">decides</span>
                    ) : state === "after" ? (
                      <span className="muted">not compared</span>
                    ) : (
                      ABSENT
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sortKey ? (
        <p className="decision__fallback">
          <span className="tag">as given</span> IDTrack gives this value as its sort key; the text above names its
          parts, and the api gives no reading of each part. The values are shown as IDTrack wrote them.
        </p>
      ) : null}
      <p className="decision__note muted">
        The runner-up is the first candidate after the best answer: the pair IDTrack&apos;s ranking compares (its result
        names no runner-up)
        {SUCCESSOR_CRITERIA.includes(decision.key)
          ? "; within one lineage the best answer compared is the one that descends from the runner-up's own entry gene"
          : ""}
        .
      </p>
    </div>
  );
}

/** The fields of a candidate shown in its row; the rest of its record opens below it. */
function RecordGrid({
  candidate,
  criteria,
  decided,
}: {
  candidate: Candidate;
  criteria: Criterion[];
  decided: string | null;
}) {
  const vocabulary = useVocabulary();
  const meaning = (field: string) => vocabulary.candidateFields.get(field) ?? null;
  const extra: [string, string, string][] = [
    ["best", yesNo(candidate.best), "best"],
    ["name authority", yesNo(candidate.authority), "authority"],
    ["display name", yesNo(candidate.display_name), "display_name"],
    ["external steps", String(candidate.external_steps), "external_steps"],
    ["history steps", String(candidate.history_steps), "history_steps"],
    ["path", `${candidate.path.length} step${candidate.path.length === 1 ? "" : "s"} to the gene`, "path"],
    [
      "final path",
      candidate.final_path.length
        ? `${candidate.final_path.length} step${candidate.final_path.length === 1 ? "" : "s"} to the target`
        : "none: the gene is the target",
      "final_path",
    ],
  ];
  return (
    <div className="record">
      <p className="record__head">Ranking record, in the order in which the criteria decide</p>
      <dl className="record__grid">
        {criteria.map((c, i) => (
          <div key={c.code} className={c.code === decided ? "record__item is-decided" : "record__item"}>
            <dt>
              <span className="mono record__n">{i + 1}</span> <CriterionTerm criterion={c} />
              {c.code === decided ? <span className="tag tag--decides">decides</span> : null}
            </dt>
            <dd>
              <CriterionValue criterion={c} candidate={candidate} />
            </dd>
          </div>
        ))}
      </dl>
      <dl className="record__grid record__grid--more">
        {extra.map(([label, value, field]) => (
          <div key={label} className="record__item">
            <dt>
              <Term code={field} meaning={meaning(field)} words={label} />
            </dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The rows of a page drawn in the first task (the rest in the next). */
const FIRST_ROWS = 10;

/** The candidates of one page of the table (fewer on a phone, where each is a card). */
const PAGE_SIZE = 25;
const PAGE_SIZE_PHONE = 10;

function CandidateRow({
  c,
  i,
  rival,
  decided,
  decider,
  geneColumn,
  columns,
  criteria,
  highlight,
  context,
  onPath,
}: {
  c: Candidate;
  i: number;
  /** The candidate a bridge from the same gene reaches, ranked below the best answer by the bridge's gap alone. */
  rival: boolean;
  decided: string | null;
  decider: Criterion | undefined;
  geneColumn: boolean;
  columns: number;
  criteria: Criterion[];
  highlight: Highlight;
  context: IdContext;
  /** Draw this candidate strong on the Path tab and open it (none: no path is drawn, or the drawing may not hold it). */
  onPath: (() => void) | null;
}) {
  const vocabulary = useVocabulary();
  const [expanded, setExpanded] = useState(false);
  const lit = useSyncExternalStore(highlight.subscribe, () => highlight.candidate() === i);
  const fieldText = (field: string) => vocabulary.candidateFields.get(field) ?? null;
  return (
    <tbody className={`cand ${c.best ? "is-best" : ""} ${lit ? "is-highlighted" : ""} ${expanded ? "is-open" : ""}`}>
      <tr
        className={`cand__row ${c.best ? "is-best" : ""} ${lit ? "is-highlighted" : ""}`}
        onPointerEnter={() => highlight.setCandidate(i)}
        onPointerLeave={() => highlight.setCandidate(null)}
      >
        <td className="num cand__rank" data-label="Rank">
          <span className="mono">{i + 1}</span>
          {c.best ? <span className="tag tag--best">best</span> : null}
        </td>
        <td data-label="Target">
          <IdMenu id={c.target} release={context.toRelease} context={context} strong={c.best} answer />
          {rival ? (
            <Toggletip
              className="tag cand__rival"
              tip={
                <span className="term__card">
                  It is reached by a bridge from the same gene through ids the bridge taken does not pass; it ranks
                  below only by the bridge&apos;s gap in releases (the verdict&apos;s caution says so).
                </span>
              }
            >
              bridged too, through other ids
            </Toggletip>
          ) : null}
          {c.target === c.gene ? (
            <>
              {" "}
              <SymbolOf gene={c.gene} context={context} />
            </>
          ) : null}
        </td>
        {geneColumn ? (
          <td data-label="Gene">
            <IdMenu id={c.gene} release={context.toRelease} context={context} />{" "}
            <SymbolOf gene={c.gene} context={context} except={c.target} />
          </td>
        ) : null}
        <td data-label="Entry gene">
          <IdMenu id={c.entry_gene} release={null} context={context} />
        </td>
        <td data-label="Read through" className="cand__through">
          {c.entry_databases.length ? c.entry_databases.map(databaseLabel).join(", ") : ABSENT}
          {c.authority ? (
            <>
              {" "}
              <Term code="authority" meaning={fieldText("authority")} words={<span className="tag">authority</span>} />
            </>
          ) : null}
        </td>
        <td className="num" data-label="History steps">
          <Mono>{c.history_steps}</Mono>
        </td>
        <td className="num" data-label="Cross-reference steps">
          <Mono>{c.external_steps}</Mono>
        </td>
        <td className={`num ${decided === "score" ? "is-decided" : ""}`} data-label="Unscored steps">
          <Mono>{c.unscored_steps}</Mono>
        </td>
        <td className={`cand__score ${decided === "score" ? "is-decided" : ""}`} data-label="Score">
          <ScoreValue score={c.score} />
        </td>
        {decider ? (
          <td className="is-decided" data-label={spaced(decider.code)}>
            <CriterionValue criterion={decider} candidate={c} />
          </td>
        ) : null}
        <td className="cand__path" data-label="On the path">
          {onPath ? (
            <button
              type="button"
              className="cand__on-path"
              aria-label={`Draw candidate ${i + 1}, ${c.target}, strong on the path`}
              onClick={onPath}
            >
              <span className="cand__on-path-dot" aria-hidden="true" />
            </button>
          ) : null}
        </td>
        <td className="cand__more" data-label="">
          <Button
            variant="quiet"
            className="cand__toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} the ranking record of candidate ${i + 1}, ${c.target}`}
            onClick={() => setExpanded((e) => !e)}
            onFocus={() => highlight.setCandidate(i)}
            onBlur={() => highlight.setCandidate(null)}
          >
            <span aria-hidden="true">{expanded ? "Record ▴" : "Record ▾"}</span>
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="cand__detail">
          <td colSpan={columns} data-label="">
            <RecordGrid candidate={c} criteria={criteria} decided={decided} />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function Candidates({
  result,
  highlight,
  context,
}: {
  result: ConversionResult;
  highlight: Highlight;
  context: IdContext;
}) {
  const vocabulary = useVocabulary();
  const decided = result.decided_by;
  // The path is drawn (its tab exists): a candidate of the first ranks, which every drawing holds, can be shown on it.
  const drawn = (result.path?.steps.length ?? 0) > 0;
  // The criteria in the order in which they decide, as the api gives them (the record of every candidate).
  const criteria = vocabulary.criteria.length ? vocabulary.criteria : RECORD;
  const score = criteria.find((c) => c.code === "score") ?? { code: "score", meaning: null, fields: [] };
  const decider = decided && decided !== "score" ? criteria.find((c) => c.code === decided) : undefined;
  // Decided by the bridge's gap: the first candidate below the best that a bridge reaches too (lib/evidence.ts).
  const rivalIndex =
    decided === "bridge_gap" && result.candidates.some((c) => c.best && c.bridges > 0)
      ? result.candidates.findIndex((c) => !c.best && c.bridges > 0)
      : -1;
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const size = usePhone() ? PAGE_SIZE_PHONE : PAGE_SIZE;
  const fieldText = (field: string) => vocabulary.candidateFields.get(field) ?? null;
  // The gene column only where a target is not the gene itself (a database other than Ensembl's).
  const geneColumn = result.candidates.some((c) => c.target !== c.gene);
  const columns = 10 + (geneColumn ? 1 : 0) + (decider ? 1 : 0);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = result.candidates.map((c, i) => ({ c, i }));
    if (!needle) return all;
    return all.filter(({ c }) =>
      [c.target, c.gene, c.entry_gene, ...(context.symbols?.of.get(c.gene) ?? [])].some((v) =>
        v.toLowerCase().includes(needle),
      ),
    );
  }, [result.candidates, filter, context.symbols]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const pageRows = rows.slice(at * size, (at + 1) * size);
  // A page is drawn in two parts, each in a task of its own: its first rows at once, the rest just after (a page of
  // records and menus is a long commit for a phone).
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    if (whole) return;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setWhole(true);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [whole]);
  const shown = whole ? pageRows : pageRows.slice(0, FIRST_ROWS);
  const paged = result.candidates.length > size;
  const head = (label: string, field: string, className?: string) => (
    <th scope="col" className={className}>
      <Term code={field} meaning={fieldText(field)} words={label} />
    </th>
  );
  return (
    <>
      {paged ? (
        <div className="cand__tools">
          <label className="field__label" htmlFor={`${context.organism}-cand-filter`}>
            Find a candidate
          </label>
          <input
            id={`${context.organism}-cand-filter`}
            className="input input--mono cand__filter"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="target, gene or symbol"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          />
          <Pager
            at={at}
            pages={pages}
            size={size}
            rows={rows.length}
            total={result.candidates.length}
            onPage={setPage}
            where="above"
          />
        </div>
      ) : null}
      <TableFrame label="Candidates, ranked" className="table-frame--cards">
        <table className="table table--candidates table--cards">
          <caption className="visually-hidden">
            Every target the search reached, ranked, with the evidence IDTrack compared; the column of the deciding
            criterion is marked; each row opens its whole ranking record.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="cand__rank">
                #
              </th>
              <th scope="col">Target</th>
              {geneColumn ? <th scope="col">Gene</th> : null}
              {head("Entry gene", "entry_gene")}
              {head("Read through", "entry_databases")}
              {head("History steps", "history_steps", "num")}
              {head("Cross-ref. steps", "external_steps", "num")}
              {head("Unscored steps", "unscored_steps", `num ${decided === "score" ? "is-decided" : ""}`)}
              <th scope="col" className={decided === "score" ? "is-decided" : undefined}>
                <Term code="score" meaning={score.meaning} words="Score" />
                {decided === "score" ? <span className="cand__decides"> decides</span> : null}
              </th>
              {decider ? (
                <th scope="col" className="is-decided">
                  <Term code={decider.code} meaning={decider.meaning} /> <span className="cand__decides">decides</span>
                </th>
              ) : null}
              <th scope="col" className="cand__path">
                Path
              </th>
              <th scope="col" className="cand__more">
                <span className="visually-hidden">Ranking record</span>
              </th>
            </tr>
          </thead>
          {shown.map(({ c, i }) => (
            <CandidateRow
              key={`${c.gene}|${c.target}|${i}`}
              c={c}
              i={i}
              rival={rivalIndex === i}
              decided={decided}
              decider={decider}
              geneColumn={geneColumn}
              columns={columns}
              criteria={criteria}
              highlight={highlight}
              context={context}
              onPath={
                drawn && i < ON_PATH
                  ? () => {
                      highlight.setCandidate(i);
                      showPath();
                    }
                  : null
              }
            />
          ))}
        </table>
      </TableFrame>
      {paged ? (
        <div className="cand__tools cand__tools--foot">
          <Pager
            at={at}
            pages={pages}
            size={size}
            rows={rows.length}
            total={result.candidates.length}
            onPage={setPage}
            where="below"
          />
        </div>
      ) : null}
      <p className="cand__note muted">
        Unscored steps count the history steps between two different stable ids to which Ensembl gave no score; a step
        without a score between two versions of one stable id is not counted (its score is taken as 1). A path with such
        a step ranks below every path whose scores are measured, before the score compares them.
      </p>
    </>
  );
}

function Pager({
  at,
  pages,
  size,
  rows,
  total,
  onPage,
  where,
}: {
  at: number;
  pages: number;
  size: number;
  rows: number;
  total: number;
  onPage: (page: number) => void;
  /** Above or below the table: each pager is named apart. */
  where: "above" | "below";
}) {
  const first = rows ? at * size + 1 : 0;
  const last = Math.min(rows, (at + 1) * size);
  return (
    <nav className="pager" aria-label={`Pages of the candidates, ${where} the table`}>
      <span className="pager__where mono" aria-live="polite">
        {groupedInteger(first)}–{groupedInteger(last)} of {groupedInteger(rows)}
        {rows !== total ? ` (of ${groupedInteger(total)})` : ""}
      </span>
      <Button variant="quiet" disabled={at === 0} onClick={() => onPage(at - 1)}>
        <span aria-hidden="true">← </span>Previous
      </Button>
      <Button variant="quiet" disabled={at >= pages - 1} onClick={() => onPage(at + 1)}>
        Next<span aria-hidden="true"> →</span>
      </Button>
    </nav>
  );
}

/** Why no criterion decided: one candidate, or a tie. A tie of candidates of different entry genes is equal in the
 *  criteria of lineage, and the criteria that compare successors of one entry gene (the score among them) never rank
 *  them: their scores may differ, and the page says so beside them. */
function NoDecision({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const bests = result.candidates.filter((c) => c.best);
  if (result.candidates.length === 1)
    return <p className="decision-none">One candidate was reached: nothing was compared.</p>;
  if (bests.length !== result.candidates.length)
    return <p className="decision-none">The api names no deciding criterion for this answer.</p>;
  const entries = new Set(bests.map((c) => c.entry_gene));
  const criteria = (vocabulary.criteria.length ? vocabulary.criteria : RECORD).map((c) => c.code);
  const successor = criteria.filter((c) => SUCCESSOR_CRITERIA.includes(c));
  const lineage = criteria.filter((c) => !SUCCESSOR_CRITERIA.includes(c));
  const scores = [...new Set(bests.map((c) => c.score))];
  if (entries.size < 2)
    return (
      <p className="decision-none">
        The {groupedInteger(bests.length)} candidates are equal in every criterion: each is part of the best answer, in
        ascending order of gene id and target id.
      </p>
    );
  return (
    <p className="decision-none">
      The {groupedInteger(bests.length)} candidates are equal in the {lineage.length} criteria of lineage (
      {lineage.map(spaced).join(", ")}). They descend from {groupedInteger(entries.size)} different entry genes, and{" "}
      {listWords(successor.map(spaced))}, which compare only successors of one entry gene, do not rank them
      {scores.length > 1 ? (
        <>
          {" "}
          (their scores differ:{" "}
          {scores.map((score, i) => (
            <span key={score}>
              {i ? ", " : ""}
              <ScoreValue score={score} />
            </span>
          ))}
          )
        </>
      ) : null}
      : each is part of the best answer, in ascending order of gene id and target id.
    </p>
  );
}

const listWords = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;

export function DecisionPanelBody({
  result,
  decision,
  highlight,
  requestedDatabase,
  listId,
  context,
}: {
  listId: string;
  result: ConversionResult;
  decision: Decision | null;
  highlight: Highlight;
  requestedDatabase: string | null;
  context: IdContext;
}) {
  return (
    <>
      {decision ? <DecisionText decision={decision} context={context} /> : <NoDecision result={result} />}
      <h3 className="figure-panel__subtitle" id={listId}>
        {result.no_target
          ? `Genes reached, ranked (no ${databaseLabel(requestedDatabase ?? "ensembl_gene")} for the best answer; the others not looked up)`
          : "Every candidate, ranked"}
      </h3>
      <Candidates result={result} highlight={highlight} context={context} />
    </>
  );
}
