// Panel d of a result: the decision (the best answer and the runner-up compared criterion by criterion in idtrack's
// order, the deciding criterion marked, with its meaning from the vocabulary) and every candidate, ranked, each with its
// whole ranking record on request.
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Candidate, ConversionResult } from "../api/types";
import { databaseLabel } from "../lib/databases";
import type { Highlight } from "../lib/highlight";
import { groupedInteger, pythonFloat } from "../lib/numbers";
import type { Decision } from "../lib/pathModel";
import { ABSENT, criterionValue, firstWords, prose, yesNo } from "../lib/values";
import { criterionOf, spaced, type Criterion } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";
import { RECORD } from "../lib/resultWords";
import { IdMenu, SymbolOf, type IdContext } from "./IdMenu";
import { CriterionValue, Term } from "./ResultParts";
import { Button, Mono, Prose, TableFrame } from "./ui";

export function DecisionText({ decision }: { decision: Decision }) {
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
  const sortKey = criterionValue(criterion, best).sortKey === true;
  return (
    <div className="decision">
      <p className="decision__head">
        <span className="eyebrow">Decided by</span> <strong className="decision__key">{spaced(decision.key)}</strong>
        {at >= 0 && vocabulary.criteria.length ? (
          <span className="decision__position">
            criterion {at + 1} of the {vocabulary.criteria.length} in idtrack&apos;s order
          </span>
        ) : null}
      </p>
      {criterion.meaning ? (
        <p className="decision__meaning">
          <Prose text={criterion.meaning} />
        </p>
      ) : (
        <p className="decision__meaning muted">The api gives no text for this criterion.</p>
      )}
      {criterion.fields.length ? (
        <p className="decision__rule">{criterion.fields.map(firstWords).join("; ")}.</p>
      ) : null}
      <div className="decision__compare">
        <table className="compare">
          <caption>
            The best answer and the runner-up, criterion by criterion in the order in which idtrack compares them; the
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
                    <span title={c.meaning ? prose(c.meaning) : undefined}>{spaced(c.code)}</span>
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
          <span className="tag">as given</span> idtrack gives this value as its sort key; the text above names its
          parts, and the api gives no reading of each part. The values are shown as idtrack wrote them.
        </p>
      ) : null}
      <p className="decision__note muted">
        idtrack names no runner-up: it is the first candidate that is not best, the pair its ranking compares
        {["score", "same_as_query", "annotation"].includes(decision.key)
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
  const meaning = (field: string) => {
    const text = vocabulary.candidateFields.get(field);
    return text ? prose(text) : undefined;
  };
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
            <dt title={c.meaning ? prose(c.meaning) : undefined}>
              <span className="mono record__n">{i + 1}</span> {spaced(c.code)}
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
            <dt title={meaning(field)}>{label}</dt>
            <dd className="mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The candidates of one page of the table (fewer on a phone, where each is a card). */
const PAGE_SIZE = 25;
const PAGE_SIZE_PHONE = 10;

/** The page's width is a phone's (the tables turn into cards). */
function usePhone(): boolean {
  const query = "(max-width: 640px)";
  const media =
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  return useSyncExternalStore(
    (listener) => {
      media?.addEventListener("change", listener);
      return () => media?.removeEventListener("change", listener);
    },
    () => media?.matches ?? false,
  );
}

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
            <span
              className="tag cand__rival"
              title="It is reached by a bridge from the same gene through ids the bridge taken does not pass; it ranks below only by the bridge's gap in releases (see the caution in panel a)."
            >
              bridged too, through other ids
            </span>
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
          <Mono>{pythonFloat(c.score)}</Mono>
        </td>
        {decider ? (
          <td className="is-decided" data-label={spaced(decider.code)}>
            <CriterionValue criterion={decider} candidate={c} />
          </td>
        ) : null}
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
  const columns = 9 + (geneColumn ? 1 : 0) + (decider ? 1 : 0);
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
  const shown = rows.slice(at * size, (at + 1) * size);
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
          />
        </div>
      ) : null}
      <TableFrame label="Candidates, ranked" className="table-frame--cards">
        <table className="table table--candidates table--cards">
          <caption className="visually-hidden">
            Every target the search reached, ranked, with the evidence idtrack compared; the column of the deciding
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
}: {
  at: number;
  pages: number;
  size: number;
  rows: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const first = rows ? at * size + 1 : 0;
  const last = Math.min(rows, (at + 1) * size);
  return (
    <nav className="pager" aria-label="Pages of the candidates">
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
  const bests = result.candidates.filter((c) => c.best).length;
  return (
    <>
      {decision ? (
        <DecisionText decision={decision} />
      ) : (
        <p className="decision-none">
          {result.candidates.length === 1
            ? "One candidate was reached: nothing was compared."
            : bests === result.candidates.length
              ? `The ${groupedInteger(bests)} candidates are equal in every criterion: each is part of the best answer, in ascending order of gene id and target id.`
              : "The api names no deciding criterion for this answer."}
        </p>
      )}
      <h3 className="figure-panel__subtitle" id={listId}>
        {result.no_target
          ? `Genes reached, ranked (no ${databaseLabel(requestedDatabase ?? "ensembl_gene")} for the best answer; the others not looked up)`
          : "Every candidate, ranked"}
      </h3>
      <Candidates result={result} highlight={highlight} context={context} />
    </>
  );
}
