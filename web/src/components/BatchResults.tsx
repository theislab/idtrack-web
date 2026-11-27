// The answer of a batch as a figure: a, what came back (the statuses as one proportional bar with each status's meaning,
// and the counts that say how the batch was answered and how strongly); b, the results, one row per identifier with the
// gene at the target release and its symbol, its id in the database asked, how it was read, what decided it and the
// evidence it rests on, sortable and filterable, each row opening to every candidate and the decision between the
// first two; c, the identifiers' way through the releases (the release each was read at, and the steps of Ensembl's
// history their paths crossed); d, the files to download. Every number is counted from the api's answer or read from
// its headers; the api's JSON is its bytes, and every other file says where it came from.
import {
  Fragment,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { api } from "../api/client";
import type { BatchRequest, Candidate, ConversionResult, GraphDescription } from "../api/types";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { Evidence } from "./Evidence";
import { bestWords, noTargetOf } from "../lib/noTarget";
import { groupedInteger, pythonFloat } from "../lib/numbers";
import { convertHref } from "../lib/convertParameters";
import { parseServerTiming } from "../lib/serverTiming";
import { batchProvenance, rowTable, type BatchProvenance, type BatchSource, type GeneNames } from "../lib/batchExport";
import {
  batchRow,
  batchRows,
  countBy,
  linkShared,
  CROSSINGS,
  eventCount,
  EVENT_WORDS,
  filterRows,
  leadsToOthers,
  matchLabel,
  READ_WORDS,
  readAtCounts,
  releaseHow,
  sortRows,
  spreadsheetDate,
  statusCounts,
  statusFill,
  summaryOf,
  type BatchRow,
  type BatchSummary,
  type Crossing,
  type ReadKind,
  type Sort,
  type SortKey,
} from "../lib/batchTable";
import { axisOf, bandsOf } from "./figure/releases";
import { GlyphSwatch } from "./figure/glyphs";
import { useRowWindow } from "../lib/useRowWindow";
import { organismName } from "../lib/organismNames";
import { saveText } from "../lib/save";
import { useAction, useRequest } from "../lib/useRequest";
import { ABSENT, criterionValue, firstWords, yesNo } from "../lib/values";
import { criterionOf, matchParts, spaced, statusTitle, type Vocabulary } from "../lib/vocabulary";
import { useLimits, useVocabulary } from "../lib/vocabularyContext";
import { readDraft, writeDraft, isText } from "../lib/drafts";
import { authorityOf } from "../lib/symbols";
import { limitationAt, LIMITATION_OF } from "../lib/evidence";
import { EventStrip, ReleaseScale, TravelArcs } from "./ReleaseScale";
import { ErrorPanel } from "./ErrorPanel";
import { Toggletip } from "./Toggletip";
import { Button, Link, Mono, Prose, Select, StatusBadge, TableFrame, TextInput } from "./ui";

/** How many ids a cell shows before "and N more" (the rest are in the opened row). */
const SHOWN = 3;

/** The first sentence of a text (a meaning shown in a cell; the whole on a press). */
const firstSentence = (text: string) =>
  /^.*?[.;:](\s|$)/
    .exec(text)?.[0]
    .replace(/[;:]\s*$/, ".")
    .trim() ?? text;

export interface BatchAnswer {
  results: ConversionResult[];
  /** The api's `count`. */
  count: number;
  request: Required<BatchRequest>;
  /** The api's answer as sent. */
  raw: string;
  serverTiming: string | null;
  requestId: string | null;
  /** When the answer came (ISO 8601), for the provenance. */
  answeredAt: string | null;
  /** The column of the list or table the identifiers were read from, with the person's own cells. */
  source: BatchSource | null;
  /** The paths were asked and the server would not send them (its code and message). */
  pathsRefused: { code: string; message: string } | null;
}

export function BatchResults({ description, answer }: { description: GraphDescription; answer: BatchAnswer }) {
  const { count, request, serverTiming, requestId, pathsRefused } = answer;
  // The head is drawn with the answer's first frame; the panels, which read every result and its paths, in a
  // transition after it, so that a large answer never holds the page in one long task.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTransition(() => {
      setReady(true);
    });
  }, []);
  const target = request.to_release ?? description.snapshot_release;
  const timing = parseServerTiming(serverTiming);
  const app = timing.find((t) => t.name === "app" && t.dur !== null);
  return (
    <div className="batch-results">
      <header className="batch-figure-head">
        <p className="eyebrow">The batch</p>
        <h2 className="batch-figure-head__title" tabIndex={-1}>
          {groupedInteger(count)} {count === 1 ? "identifier" : "identifiers"} of{" "}
          <i>{organismName(description.organism)}</i>
        </h2>
        <p className="batch-figure-head__setting">
          <Setting label="read at">
            {request.from_release === null ? "the release inferred for each" : <Mono>{request.from_release}</Mono>}
          </Setting>
          <Setting label="to release">
            <Mono>{target}</Mono>
          </Setting>
          <Setting label="in">{databaseLabel(request.final_database ?? "ensembl_gene")}</Setting>
          <Setting label="from">
            {request.from_database === null ? "any database" : databaseLabel(request.from_database)}
          </Setting>
          <Setting label="bridges">{request.allow_bridges ? "allowed" : "not allowed"}</Setting>
          <Setting label="paths">
            {request.explain ? (
              "every path"
            ) : pathsRefused ? (
              <Toggletip
                className="batch-figure-head__refused"
                label="Without the paths: why"
                tip={
                  <span className="toggletip__text">
                    The batch was asked with every path, and the server would not send them:{" "}
                    <Prose text={pathsRefused.message} /> (<span className="code-quiet">{pathsRefused.code}</span>). It
                    was asked again without them, as the api advises: the table is whole, and what the paths crossed
                    (the evidence read from them, panel c) is not shown.
                  </span>
                }
              >
                not sent (why?)
              </Toggletip>
            ) : (
              "not asked"
            )}
          </Setting>
        </p>
        <p className="batch-figure-head__meta">
          {app ? (
            <span className="batch-figure-head__time">
              answered in{" "}
              <Toggletip
                label={`answered in ${app.dur ?? ""} ms on the server: its timings`}
                tip={
                  <span className="toggletip__text">
                    The server&rsquo;s own times of this request (its <Mono>Server-Timing</Mono> header), in
                    milliseconds:{" "}
                    {timing.map((t, i) => (
                      <Fragment key={t.name}>
                        {i ? " · " : ""}
                        {t.name} <Mono>{t.dur ?? ABSENT}</Mono>
                      </Fragment>
                    ))}
                    .
                  </span>
                }
              >
                <span className="nowrap">
                  <Mono>{app.dur}</Mono>&nbsp;ms
                </span>
              </Toggletip>{" "}
              on the server
            </span>
          ) : null}
          {requestId ? (
            <span>
              request <Mono>{requestId}</Mono>
            </span>
          ) : null}
          <button
            type="button"
            className="link-button batch-figure-head__jump"
            onClick={() => {
              const downloads = document.getElementById("batch-downloads");
              if (!downloads) return;
              downloads.focus({ preventScroll: true });
              downloads.scrollIntoView({
                block: "start",
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              });
            }}
          >
            Download the results <span aria-hidden="true">↓</span>
          </button>
        </p>
      </header>
      {ready ? (
        <BatchPanels description={description} answer={answer} />
      ) : (
        <p className="batch-loading">Reading the answer…</p>
      )}
    </div>
  );
}

/** The rows of a batch, read from its results a slice at a time between frames (a few milliseconds each), so that
 *  reading a thousand answers with their paths never holds the page; null until every row is read. */
function useBatchRows(results: ConversionResult[], vocabulary: Vocabulary): BatchRow[] | null {
  const small = results.length <= 150;
  const [read, setRead] = useState<{ results: ConversionResult[]; vocabulary: Vocabulary; rows: BatchRow[] } | null>(
    null,
  );
  const now = useMemo(() => (small ? batchRows(results, vocabulary) : null), [small, results, vocabulary]);
  useEffect(() => {
    if (small) return;
    const rows: BatchRow[] = [];
    let timer = 0;
    const step = () => {
      const until = performance.now() + 12;
      while (rows.length < results.length && performance.now() < until) {
        const i = rows.length;
        const result = results[i];
        if (result) rows.push(batchRow(result, i, vocabulary));
      }
      if (rows.length < results.length) timer = window.setTimeout(step, 0);
      else
        startTransition(() => {
          setRead({ results, vocabulary, rows: linkShared(rows) });
        });
    };
    timer = window.setTimeout(step, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [small, results, vocabulary]);
  if (now) return now;
  return read?.results === results && read.vocabulary === vocabulary ? read.rows : null;
}

/** The panels of a batch's answer: every count, row and figure read from its results. */
function BatchPanels({ description, answer }: { description: GraphDescription; answer: BatchAnswer }) {
  const { results, request } = answer;
  const vocabulary = useVocabulary();
  const statusOrder = useMemo(() => [...vocabulary.statuses.keys()], [vocabulary]);
  const counts = useMemo(() => statusCounts(results, statusOrder), [results, statusOrder]);
  const rows = useBatchRows(results, vocabulary);
  const summary = useMemo(() => summaryOf(rows ?? []), [rows]);
  const names = useGeneNames(description, rows ?? [], request);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const table = useRef<HTMLElement>(null);
  const target = request.to_release ?? description.snapshot_release;
  if (!rows) return <p className="batch-loading">Reading the answer…</p>;
  // A count's rows, shown in the table: the filter set, and the table brought into view.
  const show = (next: Filter) => {
    setFilter(next);
    window.requestAnimationFrame(() => {
      table.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  };
  return (
    <>
      <Summary
        organism={description.organism}
        results={results}
        counts={counts}
        summary={summary}
        request={request}
        filter={filter}
        show={show}
        target={target}
      />
      <ResultsTable
        description={description}
        rows={rows}
        summary={summary}
        counts={counts}
        statusOrder={statusOrder}
        request={request}
        filter={filter}
        setFilter={setFilter}
        names={names}
        frame={table}
      />
      <Releases
        description={description}
        results={results}
        summary={summary}
        request={request}
        filter={filter}
        show={show}
      />
      <Downloads description={description} answer={answer} rows={rows} names={names} />
    </>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="setting">
      <span className="setting__label">{label}</span> {children}
    </span>
  );
}

interface Filter {
  statuses: Set<string>;
  reads: Set<ReadKind>;
  decided: Set<string>;
  crossings: Set<Crossing>;
  care: boolean;
  shared: boolean;
  several: boolean;
  elsewhere: boolean;
  dates: boolean;
}
const NO_FILTER: Filter = {
  statuses: new Set(),
  reads: new Set(),
  decided: new Set(),
  crossings: new Set(),
  care: false,
  shared: false,
  several: false,
  elsewhere: false,
  dates: false,
};
const isFiltered = (f: Filter) =>
  f.statuses.size + f.reads.size + f.decided.size + f.crossings.size > 0 ||
  f.care ||
  f.shared ||
  f.several ||
  f.elsewhere ||
  f.dates;
/** The one filter a count sets, or none when it is already the filter (a second press shows every row). */
type Flag = "care" | "shared" | "several" | "elsewhere" | "dates";
const only = (current: Filter, flag: Flag): Filter =>
  current[flag] && !isFiltered({ ...current, [flag]: false }) ? NO_FILTER : { ...NO_FILTER, [flag]: true };
const onlyCrossing = (current: Filter, kind: Crossing): Filter =>
  current.crossings.has(kind) && current.crossings.size === 1 && !isFiltered({ ...current, crossings: new Set() })
    ? NO_FILTER
    : { ...NO_FILTER, crossings: new Set([kind]) };

// ---- The names of the genes in another database ------------------------------------------------------------------

interface NamesState {
  /** The database whose ids stand beside each gene (by default the organism's name authority), or none. */
  database: string | null;
  /** The organism's name authority at the target release (HGNC Symbol for human genes), where the graph has one. */
  authority: string | null;
  setDatabase: (database: string | null) => void;
  state: "idle" | "loading" | "done" | "failed";
  names: GeneNames | null;
  error: unknown;
  retry: () => void;
}

const NONE = "none";

/**
 * The ids of the genes of the rows (the best answers' and the others reached) in a database, at the target release:
 * by default the organism's name authority (idtrack's `SYMBOL_DATABASES`, the first the graph can convert to there, as
 * the answer page's symbols), else a database the person chooses, or none. One more batch of the same endpoint with
 * the genes as identifiers, read and answered at the target release (each gene is its own answer there; its ids are
 * those the database attaches to it), split into requests of the server's bound; nothing is asked where the database
 * is the one the batch answered in (its answers are those ids). The choice is kept for the organism's session.
 */
function useGeneNames(description: GraphDescription, rows: readonly BatchRow[], request: Required<BatchRequest>) {
  const organism = description.organism;
  const limits = useLimits();
  const key = `batch.names.${organism}`;
  const [chosen, setChosen] = useState<string | null>(() => readDraft(key, isText) ?? null);
  const setDatabase = (value: string | null) => {
    setChosen(value ?? NONE);
    writeDraft(key, value ?? NONE);
  };
  const target = request.to_release ?? description.snapshot_release;
  const matrix = useRequest(`${organism}|databases`, (signal, fresh) => api.databases(organism, { signal, fresh }));
  const authority =
    matrix.state === "done"
      ? authorityOf(matrix.answer.data.symbol_databases, matrix.answer.data.databases, target)
      : null;
  const database = chosen === NONE ? null : (chosen ?? authority);
  const genes = useMemo(
    () => [...new Set(rows.flatMap((r) => [...r.genes, ...r.otherGenes.slice(0, SHOWN)]))].sort(),
    [rows],
  );
  const bound = limits?.batch_max ?? 1000;
  const fromAnswers = database !== null && database === request.final_database;
  const asked =
    database && genes.length && !fromAnswers ? `${organism}|${database}|${String(target)}|${genes.join(",")}` : null;
  const answer = useRequest(asked, async (signal) => {
    const names = new Map<string, string[] | null>();
    let last: { requestId: string | null; serverTiming: string | null } = { requestId: null, serverTiming: null };
    for (let i = 0; i < genes.length; i += bound) {
      const part = genes.slice(i, i + bound);
      const reply = await api.batch(
        organism,
        {
          identifiers: part,
          from_release: target,
          to_release: target,
          final_database: database,
          from_database: null,
          explain: false,
          allow_bridges: false,
          read_copies: false,
        },
        signal,
      );
      last = reply;
      reply.data.results.forEach((r, k) => {
        const gene = part[k];
        if (gene === undefined) return;
        names.set(
          gene,
          r.no_target
            ? []
            : r.candidates.length
              ? [...new Set(r.candidates.filter((c) => c.best).map((c) => c.target))]
              : null,
        );
      });
    }
    return { data: names, raw: "", requestId: last.requestId, serverTiming: last.serverTiming };
  });
  const state: NamesState = {
    database: fromAnswers ? null : database,
    authority,
    setDatabase,
    state:
      asked === null
        ? database && !fromAnswers && matrix.state !== "done" && chosen === null
          ? "loading"
          : "idle"
        : answer.state === "done"
          ? "done"
          : answer.state === "failed"
            ? "failed"
            : "loading",
    names: answer.state === "done" && database ? { database, names: answer.answer.data } : null,
    error: answer.state === "failed" ? answer.error : null,
    retry: answer.retry,
  };
  return state;
}

/** The names of a gene beside it (each once), or none. */
const namesOfGene = (names: NamesState, gene: string): string[] => names.names?.names.get(gene) ?? [];

// ---- Panel a ----------------------------------------------------------------------------------------------------

function Summary({
  organism,
  results,
  counts,
  summary,
  request,
  filter,
  show,
  target,
}: {
  organism: string;
  results: ConversionResult[];
  counts: [string, number][];
  summary: BatchSummary;
  request: Required<BatchRequest>;
  filter: Filter;
  show: (f: Filter) => void;
  target: number;
}) {
  const vocabulary = useVocabulary();
  const total = results.length;
  const gaps = Math.max(0, counts.length - 1);
  const endpoint = `POST /api/v1/organisms/${organism}/convert/batch`;
  const noPaths = "The batch was answered without its paths, so this is not counted.";
  const tiles: (TileProps & { key: string })[] = [
    {
      key: "identifiers",
      label: "Identifiers given",
      value: summary.identifiers,
      sub:
        summary.distinct === summary.identifiers
          ? "each a different identifier"
          : `${groupedInteger(summary.distinct)} different: a repeated one is answered at each of its places`,
      how: (
        <>
          The api&rsquo;s count of results, one per identifier given (<Mono>count</Mono>); the different ones by{" "}
          <Mono>query_id</Mono>.
        </>
      ),
    },
    {
      key: "care",
      label: "Answers that need care",
      value: summary.care,
      sub: "a caution in their evidence (the column Evidence)",
      how: (
        <>
          Answers whose evidence holds a caution: a bridge, a step that puts the gene elsewhere, places not compared
          across assemblies, a step without Ensembl&rsquo;s score, a target attached at another release, a reading at
          another release than the one given, a synonym, letter case or separators ignored, a version newer than the
          graph, another item&rsquo;s copy, another meaning at other releases, another reading.
        </>
      ),
      pressed: filter.care,
      onShow: () => {
        show(only(filter, "care"));
      },
    },
    {
      key: "several",
      label: "Other genes reached",
      value: summary.several,
      sub: "one gene ranked best; the others are named in the row",
      how: (
        <>
          Converted answers whose candidates below the best are other genes (<Mono>candidates[].gene</Mono> where{" "}
          <Mono>best</Mono> is no): the identifier leads to them too, through a split, another reading or a bridge. The
          row names them, and the opened row says what put the best first.
        </>
      ),
      pressed: filter.several,
      onShow: () => {
        show(only(filter, "several"));
      },
    },
    {
      key: "events",
      label: "Through a split or a merge",
      value: summary.paths ? summary.splitOrMerge : null,
      sub: summary.paths ? "a step of Ensembl's history on the best path" : "the paths were not sent",
      how: summary.paths ? (
        <>
          Answers whose best path holds a split or a merge of Ensembl&rsquo;s history (<Mono>path.steps[].reason</Mono>{" "}
          split, merge, or both).
        </>
      ) : (
        noPaths
      ),
      pressed: filter.crossings.has("split") && filter.crossings.has("merge"),
      onShow: summary.paths
        ? () => {
            const on = filter.crossings.has("split") && filter.crossings.has("merge");
            show(on ? NO_FILTER : { ...NO_FILTER, crossings: new Set<Crossing>(["split", "merge"]) });
          }
        : undefined,
    },
    {
      key: "bridge",
      label: "Through a bridge",
      value: summary.bridged,
      sub: "idtrack's inference where Ensembl's history ends",
      how: (
        <>
          Answers whose best candidate crosses a bridge (<Mono>candidates[].bridges</Mono> above 0): an id two genes
          carry, where Ensembl&rsquo;s history gives the first no successor. No record of Ensembl states it.
        </>
      ),
      pressed: filter.crossings.has("bridge") && filter.crossings.size === 1,
      onShow: summary.bridged
        ? () => {
            show(onlyCrossing(filter, "bridge"));
          }
        : undefined,
    },
    {
      key: "shared",
      label: "Answers shared",
      value: summary.shared.answers,
      unit: summary.shared.answers ? `in ${groupedInteger(summary.shared.rows)} rows` : undefined,
      sub: "the best answer of more than one different identifier",
      how: (
        <>
          Targets that are the best answer of several different identifiers: rows that would become one feature of a
          count matrix.
        </>
      ),
      pressed: filter.shared,
      onShow: summary.shared.answers
        ? () => {
            show(only(filter, "shared"));
          }
        : undefined,
    },
    request.from_release === null
      ? {
          key: "elsewhere",
          label: "Read at a release inferred",
          value: summary.inferred,
          sub: "no release given: each read where idtrack infers",
          how: (
            <>
              No release was given, so idtrack chose the release each identifier is read at (
              <Mono>from_release_inferred</Mono>): a symbol is read with its meaning at that release.{" "}
              {limitationAt(LIMITATION_OF.other_release)?.lead ?? ""} For a dataset, give the Ensembl release of its
              annotation.
            </>
          ),
          pressed: filter.elsewhere,
          onShow: summary.inferred
            ? () => {
                show(only(filter, "elsewhere"));
              }
            : undefined,
        }
      : {
          key: "elsewhere",
          label: `Read elsewhere than ${String(request.from_release)}`,
          value: summary.fallback,
          sub: "the graph does not hold them at the release given",
          how: (
            <>
              <Prose
                text={
                  vocabulary.reasons.get("read_at_another_release") ??
                  "The graph does not hold the identifier at the release given."
                }
              />{" "}
              (<Mono>from_release_fallback</Mono>)
            </>
          ),
          pressed: filter.elsewhere,
          onShow: summary.fallback
            ? () => {
                show(only(filter, "elsewhere"));
              }
            : undefined,
        },
  ];
  if (summary.dates)
    tiles.push({
      key: "dates",
      label: "In the form of a date",
      value: summary.dates,
      sub: "a spreadsheet's date made of a symbol: not found",
      how: (
        <>
          Identifiers not found whose text has the form of a date a spreadsheet makes of a cell (<Mono>1-Mar</Mono>,{" "}
          <Mono>Sep-2</Mono>, <Mono>2023-09-02</Mono>): a symbol such as MARCH1 or SEPT2 opened in a spreadsheet becomes
          one. The form alone is judged; no symbol is guessed back.
        </>
      ),
      pressed: filter.dates,
      onShow: () => {
        show(only(filter, "dates"));
      },
    });
  if (summary.copies)
    tiles.push({
      key: "copies",
      label: "Read as another item's copy",
      value: summary.copies,
      sub: "a name with -1, .1 or _1 after another item",
      how: <Prose text={vocabulary.matchPrefixes.get("copy") ?? "Results whose match carries the prefix copy."} />,
    });
  const columns = tiles.length % 4 === 0 ? 4 : tiles.length % 3 === 0 ? 3 : 4;
  return (
    <section className="panel batch-panel" aria-labelledby="batch-summary">
      <div className="panel-head">
        <span className="panel-letter" aria-hidden="true">
          a
        </span>
        <h3 id="batch-summary" className="panel-head__title">
          What came back
        </h3>
      </div>

      <figure className="batch-bar-figure">
        <div className="sbar" role="img" aria-label={counts.map(([s, n]) => `${statusTitle(s)} ${n}`).join(", ")}>
          {counts.map(([status, n]) => (
            <span
              key={status}
              className={`sbar__segment ${statusFill(status)}`}
              style={{ width: `calc((100% - ${String(gaps * 2)}px) * ${String(n)} / ${String(total)})` }}
            >
              {n / total >= 0.07 ? <span className="sbar__count">{groupedInteger(n)}</span> : null}
            </span>
          ))}
        </div>
        <ul className="slegend" aria-label="The statuses and what they mean">
          {counts.map(([status, n]) => {
            const meaning = vocabulary.statuses.get(status);
            return (
              <li key={status} className="slegend__item">
                <span className={`slegend__swatch ${statusFill(status)}`} aria-hidden="true" />
                <span className="slegend__name">{statusTitle(status)}</span>
                <span className="slegend__count mono">{groupedInteger(n)}</span>
                {meaning ? (
                  <span className="slegend__meaning">
                    <Prose text={meaning} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <figcaption className="fig-caption">
          The status of each of the {groupedInteger(total)} results, drawn in proportion: a segment is as wide as the
          share of the identifiers with that status (beside 2 px gaps; a segment of a few identifiers is at least 3 px
          wide). Each status&rsquo;s meaning is the api&rsquo;s (<Mono>GET /api/v1/vocabulary</Mono>).
        </figcaption>
      </figure>

      <ul className="tiles" style={{ "--tiles": columns } as CSSProperties} aria-label="How the batch was answered">
        {tiles.map(({ key, ...t }, i) => (
          <Tile key={key} {...t} lastOdd={tiles.length % 2 === 1 && i === tiles.length - 1} />
        ))}
      </ul>
      <p className="fig-caption">
        Counts of rows, from the answer of <Mono>{endpoint}</Mono> at release <Mono>{target}</Mono>; a count&rsquo;s
        button shows only its rows in panel b, and <em>How</em> says how it is counted.
      </p>
    </section>
  );
}

interface TileProps {
  label: string;
  /** null: not counted (said in `sub`). */
  value: number | null;
  unit?: string | undefined;
  sub: string;
  how: ReactNode;
  pressed?: boolean;
  onShow?: (() => void) | undefined;
}

/** A count: its number in the monospaced face with its unit kept beside it, its name and a line of plain words; how it
 *  is counted on a press; and, where it counts rows, a button that shows only them. */
function Tile({
  label,
  value,
  unit,
  sub,
  how,
  pressed = false,
  onShow,
  lastOdd = false,
}: TileProps & { lastOdd?: boolean }) {
  return (
    <li
      className={`tile ${pressed ? "is-pressed" : ""} ${value === null ? "is-absent" : ""} ${lastOdd ? "is-last-odd" : ""}`}
    >
      <span className="tile__value">
        <span className="mono">{value === null ? ABSENT : groupedInteger(value)}</span>
        {unit ? <span className="tile__unit">{unit}</span> : null}
      </span>
      <span className="tile__label">{label}</span>
      <span className="tile__sub">{sub}</span>
      <span className="tile__actions">
        {onShow && value ? (
          <button
            type="button"
            className="tile__show"
            aria-pressed={pressed}
            aria-label={`Show only these rows: ${label}, ${groupedInteger(value)}`}
            onClick={onShow}
          >
            Show<span className="tile__show-more"> only these</span>
          </button>
        ) : null}
        <Toggletip
          className="tile__how"
          label={`How it is counted: ${label}`}
          tip={<span className="toggletip__text">{how}</span>}
        >
          How
        </Toggletip>
      </span>
    </li>
  );
}

// ---- Panel b ----------------------------------------------------------------------------------------------------

interface Column {
  key: string;
  title: string;
  sort?: SortKey;
  className?: string;
  /** The column's width, in px. */
  width: number;
}

/** The width of a monospaced cell of `chars` characters (13.5 px JetBrains Mono advances 0.6 em), with padding. */
const monoWidth = (chars: number) => Math.round(chars * 8.1 + 26);
const longest = (values: Iterable<string>, floor: number, ceiling: number) => {
  let n = floor;
  for (const v of values) n = Math.max(n, v.length);
  return Math.min(n, ceiling);
};

/** The reading every row shares, where it is one (then said once above the table instead of in a column). */
function sharedReading(rows: readonly BatchRow[]): string | null {
  const first = rows[0];
  if (!first) return null;
  const words = (row: BatchRow) => {
    const r = row.result;
    if (r.from_release === null) return null;
    const how = releaseHow(r);
    return `${READ_WORDS[row.read]} at release ${String(r.from_release)}, ${
      how === "inferred" ? "inferred" : how === "fallback" ? `not ${String(r.from_release_given)} as given` : "as given"
    }`;
  };
  const text = words(first);
  return text !== null && rows.every((r) => words(r) === text) ? text : null;
}

function ResultsTable({
  description,
  rows,
  summary,
  counts,
  statusOrder,
  request,
  filter,
  setFilter,
  names,
  frame,
}: {
  description: GraphDescription;
  rows: BatchRow[];
  summary: BatchSummary;
  counts: [string, number][];
  statusOrder: string[];
  request: Required<BatchRequest>;
  filter: Filter;
  setFilter: (f: Filter) => void;
  names: NamesState;
  frame: RefObject<HTMLElement | null>;
}) {
  const vocabulary = useVocabulary();
  const organism = description.organism;
  const target = request.to_release ?? description.snapshot_release;
  const database = request.final_database ?? "ensembl_gene";
  const [sort, setSort] = useState<Sort>({ key: "order", descending: false });
  const [text, setText] = useState("");
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [flash, setFlash] = useState<number | null>(null);
  const needle = useDeferredValue(text);
  const sorted = useMemo(() => sortRows(rows, sort, statusOrder), [rows, sort, statusOrder]);
  const visible = useMemo(() => filterRows(sorted, { ...filter, text: needle }), [sorted, filter, needle]);
  const reads = useMemo(
    () =>
      countBy<ReadKind>(rows, (r) => r.read, [
        "written",
        "case",
        "separator",
        "synonym",
        "copy",
        "newer_version",
        "not_read",
      ]),
    [rows],
  );
  const criteria = useMemo(
    () =>
      countBy(
        rows,
        (r) => r.result.decided_by ?? "",
        vocabulary.criteria.map((c) => c.code),
      ),
    [rows, vocabulary],
  );
  const reading = useMemo(() => sharedReading(rows), [rows]);
  const anyEvidence = useMemo(() => rows.some((r) => r.evidence.length > 0), [rows]);
  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const toggleRow = (index: number) => {
    setOpen(toggle(open, index));
  };
  const sortBy = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, descending: !s.descending } : { key, descending: false }));
  };
  const table = useRef<HTMLTableElement>(null);
  const keys = useMemo(() => visible.map((row) => row.index), [visible]);
  // A row's height before it is drawn: a card on a phone, a line of the table elsewhere.
  const estimate = useCallback(
    () => (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches ? 170 : 56),
    [],
  );
  const span = useRowWindow(table, keys, estimate);
  // Another row named in a row ("also the answer of #3"): every row shown again if a filter hides it, then the row
  // brought into view, focused and marked for a moment.
  const [going, setGoing] = useState<number | null>(null);
  const goTo = (index: number) => {
    if (!keys.includes(index)) {
      setFilter(NO_FILTER);
      setText("");
    }
    setGoing(index);
  };
  useEffect(() => {
    if (going === null || !keys.includes(going)) return;
    const element = table.current;
    const wrap = element?.closest<HTMLElement>(".table-wrap");
    const offset = span.offsetOf(going);
    const head = element?.tHead?.getBoundingClientRect().height ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drawn = element?.querySelector<HTMLElement>(`[data-row="${String(going)}"]`);
    if (drawn) drawn.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    else if (wrap && offset !== null && getComputedStyle(wrap).overflowY !== "visible") wrap.scrollTop = offset;
    else if (element && offset !== null)
      window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY + head + offset - 120 });
    let frames = 0;
    let handle = 0;
    const focus = () => {
      const row = table.current?.querySelector<HTMLElement>(`[data-row="${String(going)}"] .batch-toggle`);
      if (row) {
        row.focus({ preventScroll: Boolean(drawn) });
        setFlash(going);
        setGoing(null);
        return;
      }
      if (frames++ < 30) handle = requestAnimationFrame(focus);
      else setGoing(null);
    };
    handle = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [going, keys, span]);
  useEffect(() => {
    if (flash === null) return;
    const timer = window.setTimeout(() => {
      setFlash(null);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [flash]);
  // The columns' widths, measured once from every row of the answer (not only the rows drawn), so that nothing moves
  // while a long table scrolls, sorts or filters; again once the names beside the genes come.
  const columns = useMemo((): Column[] => {
    const all = rows.map((r) => r.result);
    const digits = String(rows.length).length;
    const geneChars = longest(
      rows.flatMap((r) => r.genes),
      14,
      24,
    );
    const nameChars =
      names.database && names.names
        ? longest(
            rows.flatMap((r) => r.genes.flatMap((g) => namesOfGene(names, g).slice(0, 1))),
            0,
            18,
          )
        : names.database
          ? 8
          : 0;
    const list: Column[] = [
      { key: "order", title: "#", sort: "order", className: "num", width: Math.round(digits * 8.1 + 52) },
      {
        key: "identifier",
        title: "Identifier",
        sort: "identifier",
        width: monoWidth(
          longest(
            all.flatMap((r) => [r.query_id, r.graph_id ?? ""]),
            10,
            26,
          ),
        ),
      },
      { key: "status", title: "Status", sort: "status", width: 156 },
      {
        key: "gene",
        title: `Gene at ${String(target)}`,
        sort: "answer",
        width: monoWidth(geneChars) + (nameChars ? Math.round(nameChars * 8.1 + 12) : 0),
      },
    ];
    if (database !== "ensembl_gene")
      list.push({
        key: "answer",
        title: `In ${databaseLabel(database)}`,
        width: Math.max(
          120,
          monoWidth(
            longest(
              rows.flatMap((r) => r.answers),
              8,
              22,
            ),
          ),
        ),
      });
    if (!reading) list.push({ key: "read", title: "Read", sort: "release", width: 128 });
    list.push({ key: "decided", title: "Decided by", sort: "decided", width: 112 });
    if (anyEvidence) list.push({ key: "evidence", title: "Evidence", sort: "evidence", width: 172 });
    list.push({ key: "path", title: "", width: 58 });
    return list;
  }, [rows, target, database, names, reading, anyEvidence]);
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  // Each row's place among the rows of the table (the head is row 1; an opened row's candidates are a row too).
  const rowIndex = useMemo(() => {
    const at = new Map<number, number>();
    let n = 2;
    for (const row of visible) {
      at.set(row.index, n);
      n += open.has(row.index) ? 2 : 1;
    }
    return { at, total: n - 1 };
  }, [visible, open]);
  const orderWords =
    sort.key === "order" && !sort.descending
      ? "in input order"
      : sort.key === "order"
        ? "in input order, reversed"
        : `by ${(columns.find((c) => c.sort === sort.key)?.title ?? sort.key).toLowerCase()}, ${sort.descending ? "descending" : "ascending"}`;
  const shownWords = `${visible.length === rows.length ? `All ${groupedInteger(rows.length)}` : `${groupedInteger(visible.length)} of ${groupedInteger(rows.length)}`} rows${isFiltered(filter) || needle.trim() ? " (filtered)" : ""}, ${orderWords}`;
  const finalOptions = useMemo(() => {
    const listed = sortDatabases(description.final_databases).filter((d) => d !== "ensembl_gene" && d !== database);
    const first = names.authority && listed.includes(names.authority) ? [names.authority] : [];
    return [...first, ...listed.filter((d) => d !== names.authority)];
  }, [description, database, names.authority]);
  const crossingCounts = useMemo(
    () =>
      CROSSINGS.flatMap((k): [Crossing, number][] =>
        (summary.crossings.get(k) ?? 0) > 0 ? [[k, summary.crossings.get(k) ?? 0]] : [],
      ),
    [summary],
  );
  const beside = names.database;
  const columnCount = columns.length;
  return (
    <section className="panel batch-panel" aria-labelledby="batch-table" ref={frame}>
      <div className="panel-head">
        <span className="panel-letter" aria-hidden="true">
          b
        </span>
        <h3 id="batch-table" className="panel-head__title">
          The results, one row per identifier
        </h3>
      </div>
      <p className="batch-lead">
        Each row gives the gene at release <Mono>{target}</Mono>
        {beside ? <> with its id in {databaseLabel(beside)} beside it</> : null}
        {database !== "ensembl_gene" ? <>, its id in {databaseLabel(database)}</> : null}, the other genes the
        identifier leads to, how it was read, the criterion that put the best answer before the next, and the evidence
        it rests on where that is more than Ensembl&rsquo;s history of the identifier as written.
        {reading ? <> Every identifier was read {reading.replace(/^as written/, "as written,")}.</> : null}
        {anyEvidence ? null : <> No answer rests on more than Ensembl&rsquo;s history of the identifier as written.</>}
      </p>
      <div className="batch-names">
        <label className="batch-names__label" htmlFor="batch-names">
          Beside each gene, its id in
        </label>
        <Select
          id="batch-names"
          className="batch-names__select"
          value={names.database ?? NONE}
          aria-describedby="batch-names-hint"
          onChange={(e) => {
            names.setDatabase(e.target.value === NONE ? null : e.target.value);
          }}
        >
          {finalOptions.map((d) => (
            <option key={d} value={d}>
              {databaseLabel(d)}
              {d === names.authority ? " (the organism's symbols)" : ""}
            </option>
          ))}
          <option value={NONE}>no other database</option>
        </Select>
        <p className="batch-names__hint" id="batch-names-hint">
          {names.state === "loading"
            ? "Asking the server…"
            : names.state === "failed"
              ? "The server did not give them. "
              : request.final_database !== null && request.final_database === (names.authority ?? "")
                ? `The answers are in ${databaseLabel(request.final_database)}, the organism's symbols: nothing more is asked.`
                : `${names.authority ? `${databaseLabel(names.authority)} gives the organism's symbols. ` : ""}One more request of the same endpoint, with the genes as identifiers, read and answered at release ${String(target)}.`}
          {names.state === "failed" ? (
            <button type="button" className="link-button" onClick={names.retry}>
              Try again
            </button>
          ) : null}
        </p>
      </div>
      <div className="batch-tools">
        <ChipGroup label="Status">
          <button
            type="button"
            className="chip"
            aria-pressed={!isFiltered(filter)}
            onClick={() => {
              setFilter(NO_FILTER);
            }}
          >
            All <span className="chip__count mono">{groupedInteger(rows.length)}</span>
          </button>
          {counts.map(([status, n]) => (
            <button
              key={status}
              type="button"
              className="chip"
              aria-pressed={filter.statuses.has(status)}
              onClick={() => {
                setFilter({ ...filter, statuses: toggle(filter.statuses, status) });
              }}
            >
              <span className={`chip__swatch ${statusFill(status)}`} aria-hidden="true" />
              {statusTitle(status)} <span className="chip__count mono">{groupedInteger(n)}</span>
            </button>
          ))}
        </ChipGroup>
        {reads.length > 1 ? (
          <ChipGroup label="Read">
            {reads.map(([kind, n]) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={filter.reads.has(kind)}
                onClick={() => {
                  setFilter({ ...filter, reads: toggle(filter.reads, kind) });
                }}
              >
                {READ_WORDS[kind]} <span className="chip__count mono">{groupedInteger(n)}</span>
              </button>
            ))}
          </ChipGroup>
        ) : null}
        {criteria.some(([code]) => code !== "") ? (
          <ChipGroup label="Decided by">
            {criteria.map(([code, n]) => (
              <button
                key={code || "none"}
                type="button"
                className="chip"
                aria-pressed={filter.decided.has(code)}
                onClick={() => {
                  setFilter({ ...filter, decided: toggle(filter.decided, code) });
                }}
              >
                {code ? spaced(code) : "no runner-up"} <span className="chip__count mono">{groupedInteger(n)}</span>
              </button>
            ))}
          </ChipGroup>
        ) : null}
        {crossingCounts.length ? (
          <ChipGroup label="Path crosses">
            {crossingCounts.map(([kind, n]) => (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={filter.crossings.has(kind)}
                onClick={() => {
                  setFilter({ ...filter, crossings: toggle(filter.crossings, kind) });
                }}
              >
                {CROSSING_WORDS[kind]} <span className="chip__count mono">{groupedInteger(n)}</span>
              </button>
            ))}
          </ChipGroup>
        ) : null}
        <div className="batch-tools__line">
          <div className="batch-tools__sort">
            <label className="batch-tools__sort-label" htmlFor="batch-sort">
              Sort by
            </label>
            <Select
              id="batch-sort"
              value={`${sort.key}|${sort.descending ? "desc" : "asc"}`}
              onChange={(e) => {
                const [key = "order", direction] = e.target.value.split("|");
                setSort({ key: key as SortKey, descending: direction === "desc" });
              }}
            >
              {columns
                .filter((c) => c.sort)
                .flatMap((c) => [
                  <option key={`${c.key}|asc`} value={`${String(c.sort)}|asc`}>
                    {c.sort === "order" ? "Input order" : `${c.title}, ascending`}
                  </option>,
                  <option key={`${c.key}|desc`} value={`${String(c.sort)}|desc`}>
                    {c.sort === "order" ? "Input order, reversed" : `${c.title}, descending`}
                  </option>,
                ])}
            </Select>
          </div>
          <div className="batch-tools__find">
            <label className="visually-hidden" htmlFor="batch-find">
              Find in the results
            </label>
            <TextInput
              id="batch-find"
              className="input--mono input--small"
              placeholder="Find an identifier or answer"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </div>
        </div>
      </div>
      <p className="batch-tools__shown" aria-live="polite">
        {shownWords}.
      </p>
      <TableFrame
        label={`Results: ${shownWords}`}
        className={`table-frame--cards ${visible.length + open.size * 4 > 24 ? "table-frame--tall" : ""}`}
      >
        <table
          className="table table--batch table--cards"
          ref={table}
          style={{ width: `max(100%, ${String(tableWidth)}px)` }}
          aria-rowcount={span.windowed ? rowIndex.total : undefined}
        >
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: `${String(c.width)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr aria-rowindex={span.windowed ? 1 : undefined}>
              {columns.map((c) =>
                c.sort ? (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.className}
                    aria-sort={sort.key === c.sort ? (sort.descending ? "descending" : "ascending") : undefined}
                  >
                    <button
                      type="button"
                      className="sort"
                      onClick={() => {
                        if (c.sort) sortBy(c.sort);
                      }}
                    >
                      {c.title}
                      {c.key === "gene" && beside ? (
                        <span className="sort__beside"> · {databaseLabel(beside)}</span>
                      ) : null}
                      <span className="sort__mark" aria-hidden="true">
                        {sort.key === c.sort ? (sort.descending ? "↓" : "↑") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : (
                  <th key={c.key} scope="col" className={c.className}>
                    {c.title || <span className="visually-hidden">Path</span>}
                  </th>
                ),
              )}
            </tr>
          </thead>
          {span.above ? <Spacer height={span.above} span={columnCount} /> : null}
          {visible.slice(span.start, span.end).map((row) => (
            <Row
              key={row.index}
              row={row}
              organism={organism}
              request={request}
              database={database}
              names={names}
              columns={columnCount}
              showRead={!reading}
              showEvidence={anyEvidence}
              rowIndex={span.windowed ? rowIndex.at.get(row.index) : undefined}
              open={open.has(row.index)}
              flash={flash === row.index}
              onToggle={() => {
                toggleRow(row.index);
              }}
              goTo={goTo}
              onSize={span.windowed ? span.measured : undefined}
            />
          ))}
          {span.below ? <Spacer height={span.below} span={columnCount} /> : null}
        </table>
      </TableFrame>
      {visible.length === 0 ? <p className="empty empty--small">No result matches the filter.</p> : null}
      <p className="fig-caption">
        <span className="when-table">
          One row per identifier, in the order given (<Mono>#</Mono>); a column&rsquo;s name sorts by it, a chip above
          shows only its rows.
        </span>
        <span className="when-cards">
          One card per identifier, in the order given (<Mono>#</Mono>); the menu above sorts them, a chip shows only its
          cards.
        </span>{" "}
        Under a gene: the other genes the identifier leads to, the splits and merges of Ensembl&rsquo;s history on its
        path, and the other rows (<Mono>#</Mono>) whose answer it is too.{" "}
        {reading ? null : (
          <>
            <em>Read</em> is how the identifier was read (as written, through a synonym, without letter case…) and at
            which release;{" "}
          </>
        )}
        <em>Decided by</em> is idtrack&rsquo;s criterion that put the best answer before the runner-up (press it for the
        order of the criteria)
        {anyEvidence ? (
          <>
            ; <em>Evidence</em> marks what the answer rests on beyond Ensembl&rsquo;s history of the identifier as
            written (its meaning on the mark and in the opened row, with idtrack&rsquo;s documented limitation where
            there is one)
          </>
        ) : null}
        . Open a row for every candidate, ranked as idtrack ranks them; <em>Path</em> opens the conversion with the path
        that leads to each answer.
      </p>
    </section>
  );
}

const CROSSING_WORDS: Record<Crossing, string> = {
  version: "a new version",
  replaced: "another id",
  split: "a split",
  merge: "a merge",
  handoff: "an assembly change",
  remap: "a re-mapping",
  bridge: "a bridge",
  external: "an external database",
};

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="batch-tools__group" role="group" aria-label={`Show the rows by ${label.toLowerCase()}`}>
      <span className="batch-tools__group-label" aria-hidden="true">
        {label}
      </span>
      <div className="batch-tools__filters">{children}</div>
    </div>
  );
}

/** A gene id with its names beside it (each once). */
function GeneWithNames({ gene, names, strong }: { gene: string; names: NamesState; strong?: boolean }) {
  const own = namesOfGene(names, gene);
  return (
    <span className="cell-line gene-line">
      <Mono strong={strong ?? false}>{gene}</Mono>
      {names.database ? (
        names.state === "done" ? (
          own.length ? (
            <span className="gene-line__names mono">
              {own.slice(0, 2).join(", ")}
              {own.length > 2 ? " …" : ""}
            </span>
          ) : null
        ) : (
          <span className="gene-line__names muted">…</span>
        )
      ) : null}
    </span>
  );
}

/** A few genes with their names, then "and N more" (every one is in the opened row). */
function GeneList({ genes, names, strong }: { genes: readonly string[]; names: NamesState; strong?: boolean }) {
  const shown = genes.length > SHOWN + 1 ? genes.slice(0, SHOWN) : genes;
  return (
    <>
      {shown.map((g) => (
        <GeneWithNames key={g} gene={g} names={names} strong={strong ?? false} />
      ))}
      {shown.length < genes.length ? (
        <span className="sub">and {groupedInteger(genes.length - shown.length)} more (open the row)</span>
      ) : null}
    </>
  );
}

/** A few ids, then "and N more" (every one is in the opened row). */
function IdList({ ids, strong }: { ids: readonly string[]; strong?: boolean }) {
  const shown = ids.length > SHOWN + 1 ? ids.slice(0, SHOWN) : ids;
  return (
    <>
      {shown.map((id, k) => (
        <span key={`${id}|${k}`} className="cell-line">
          <Mono strong={strong ?? false}>{id}</Mono>
        </span>
      ))}
      {shown.length < ids.length ? (
        <span className="sub">and {groupedInteger(ids.length - shown.length)} more (open the row)</span>
      ) : null}
    </>
  );
}

/** The criteria in the order in which they decide, the one that decided marked: what "criterion 7 of 9" means. */
function CriteriaOrder({ vocabulary, decided }: { vocabulary: Vocabulary; decided: string }) {
  const criterion = criterionOf(vocabulary, decided);
  return (
    <span className="toggletip__text criteria-tip">
      {criterion?.meaning ? (
        <span className="criteria-tip__meaning">
          <Prose text={criterion.meaning} />
        </span>
      ) : null}
      <span className="criteria-tip__lead">
        idtrack ranks the candidates by these criteria in turn; the first that differs between the best answer and the
        runner-up decides, and the later ones are not compared:
      </span>
      <ol className="criteria-tip__list">
        {vocabulary.criteria.map((c) => (
          <li key={c.code} className={c.code === decided ? "is-decided" : undefined}>
            {spaced(c.code)}
            {c.code === decided ? <span className="visually-hidden"> (decided this answer)</span> : null}
          </li>
        ))}
      </ol>
    </span>
  );
}

function Row({
  row,
  organism,
  request,
  database,
  names,
  columns,
  showRead,
  showEvidence,
  rowIndex,
  open,
  flash,
  onToggle,
  goTo,
  onSize,
}: {
  row: BatchRow;
  organism: string;
  request: Required<BatchRequest>;
  database: string;
  names: NamesState;
  columns: number;
  showRead: boolean;
  showEvidence: boolean;
  rowIndex?: number | undefined;
  open: boolean;
  flash: boolean;
  onToggle: () => void;
  goTo: (index: number) => void;
  /** Told the height of the row (with its candidates when open) once drawn, in a table that draws rows in view. */
  onSize?: ((key: number, height: number) => void) | undefined;
}) {
  const vocabulary = useVocabulary();
  const r = row.result;
  const absent = noTargetOf(r);
  const meaning = r.reason ? vocabulary.reasons.get(r.reason) : null;
  const detailId = `batch-detail-${row.index}`;
  const criterion = criterionOf(vocabulary, r.decided_by);
  const how = releaseHow(r);
  const measure = useCallback(
    (body: HTMLTableSectionElement | null) => {
      if (body && onSize) onSize(row.index, body.getBoundingClientRect().height);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measured again when the row opens or closes
    [onSize, row.index, open],
  );
  const answered = r.candidates.length > 0;
  const eventWords = splitsAndMerges(row);
  return (
    <tbody ref={measure} data-row={row.index} className={flash ? "is-flash" : undefined}>
      <tr className={open ? "is-open" : undefined} aria-rowindex={rowIndex}>
        <td className="num batch-index b-index" data-label="#">
          <button
            type="button"
            className="batch-toggle"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            onClick={onToggle}
          >
            <span className="batch-toggle__mark" aria-hidden="true" />
            <span className="mono batch-toggle__number">{row.index + 1}</span>
            <span className="visually-hidden">{`: ${open ? "close" : "open"} the candidates of ${r.query_id}`}</span>
          </button>
        </td>
        <td className="b-id" data-label="Identifier">
          <Mono>{r.query_id}</Mono>
          {r.graph_id !== null && r.graph_id !== r.query_id ? (
            <span className="sub">
              read as <Mono>{r.graph_id}</Mono>
            </span>
          ) : null}
          {spreadsheetDate(row) ? (
            <span className="sub batch-why batch-why--hint">
              The form of a spreadsheet&rsquo;s date: a symbol such as MARCH1 becomes <Mono>1-Mar</Mono> in a
              spreadsheet. Export the column as text and convert it again.
            </span>
          ) : null}
        </td>
        <td className="b-status" data-label="Status">
          <StatusBadge status={r.status} />
          {r.error ? (
            <span className="sub batch-why">{firstSentence(r.error.message)}</span>
          ) : r.tie ? (
            <span className="sub batch-why">equal in all the evidence: every one is listed</span>
          ) : !answered && meaning ? (
            <span className="sub batch-why">
              <Prose text={firstSentence(meaning)} />
            </span>
          ) : !answered && r.reason ? (
            <span className="sub batch-why">{spaced(r.reason)}</span>
          ) : null}
        </td>
        <td
          className={`b-gene ${absent || row.genes.length || row.shared.length ? "" : "is-absent"}`}
          data-label={`Gene at ${String(r.to_release)}`}
        >
          {absent ? (
            <span className="cell-line">
              <span className="sub-lead">
                No {databaseLabel(database)} for {bestWords(absent.best)}:
              </span>
              <GeneList genes={absent.best} names={names} />
              {absent.others.length ? (
                <span className="sub">{absent.others.length} other genes reached, not looked up in the database</span>
              ) : null}
            </span>
          ) : row.genes.length ? (
            <GeneList genes={row.genes} names={names} strong={database === "ensembl_gene"} />
          ) : (
            <span className="muted" title="No answer">
              {ABSENT}
            </span>
          )}
          {leadsToOthers(row) ? (
            <span className="sub batch-others">
              {row.otherGenes.length === 1
                ? "and 1 other gene reached:"
                : `and ${groupedInteger(row.otherGenes.length)} other genes reached:`}{" "}
              {row.otherGenes.slice(0, row.otherGenes.length > SHOWN + 1 ? SHOWN : SHOWN + 1).map((g, i) => {
                const own = namesOfGene(names, g);
                return (
                  <Fragment key={g}>
                    {i ? ", " : ""}
                    <Mono>{g}</Mono>
                    {own.length ? <span className="gene-line__names mono"> {own[0]}</span> : null}
                  </Fragment>
                );
              })}
              {row.otherGenes.length > SHOWN + 1 ? ` and ${groupedInteger(row.otherGenes.length - SHOWN)} more` : ""}
            </span>
          ) : null}
          {eventWords.length ? (
            <span className="sub batch-events">
              <span className="batch-events__glyph" aria-hidden="true" />
              {eventWords.join("; ")}
            </span>
          ) : null}
          {row.shared.length ? (
            <span className="sub batch-shared">
              also the answer of{" "}
              {row.shared.slice(0, 4).map((j, i) => (
                <Fragment key={j}>
                  {i ? ", " : ""}
                  <button
                    type="button"
                    className="link-button batch-shared__go"
                    onClick={() => {
                      goTo(j);
                    }}
                    aria-label={`Go to row ${String(j + 1)}`}
                  >
                    #{j + 1}
                  </button>
                </Fragment>
              ))}
              {row.shared.length > 4 ? ` and ${groupedInteger(row.shared.length - 4)} more` : ""}
            </span>
          ) : null}
        </td>
        {database !== "ensembl_gene" ? (
          <td className="b-answer" data-label={`In ${databaseLabel(database)}`}>
            {row.answers.length ? (
              <IdList ids={row.answers} strong />
            ) : (
              <span className="muted" title="No answer">
                {ABSENT}
              </span>
            )}
          </td>
        ) : null}
        {showRead ? (
          <td className="b-read" data-label="Read">
            <span>{READ_WORDS[row.read]}</span>
            {r.from_release !== null ? (
              <span className="sub">
                at <Mono>{r.from_release}</Mono>
                {how === "inferred"
                  ? ", inferred"
                  : how === "fallback"
                    ? `, not ${String(r.from_release_given)} as given`
                    : ", as given"}
              </span>
            ) : null}
          </td>
        ) : null}
        <td className={`b-decided ${r.decided_by ? "" : "is-absent"}`} data-label="Decided by">
          {criterion ? (
            <span>
              <Toggletip
                className="b-decided__term"
                label={`Decided by ${spaced(criterion.code)}, criterion ${String(criterion.index + 1)} of ${String(vocabulary.criteria.length)}: the order of the criteria`}
                tip={<CriteriaOrder vocabulary={vocabulary} decided={criterion.code} />}
              >
                {spaced(criterion.code)}
              </Toggletip>
              <span className="sub">
                criterion {criterion.index + 1} of {vocabulary.criteria.length}
              </span>
            </span>
          ) : r.decided_by ? (
            <span>{spaced(r.decided_by)}</span>
          ) : (
            <span className="muted">
              <span aria-hidden="true">{ABSENT}</span>
              <span className="visually-hidden">no runner-up: nothing had to be decided</span>
            </span>
          )}
        </td>
        {showEvidence ? (
          <td className={`b-evidence ${row.evidence.length ? "" : "is-absent"}`} data-label="Evidence">
            {row.evidence.length ? (
              <Evidence result={r} marks={row.evidence} compact max={3} label={`Evidence of ${r.query_id}`} />
            ) : (
              <span className="muted">
                <span aria-hidden="true">{ABSENT}</span>
                <span className="visually-hidden">
                  Ensembl&rsquo;s history of the identifier as written, with no inference beyond it
                </span>
              </span>
            )}
          </td>
        ) : null}
        <td className="b-path" data-label="">
          {r.graph_id !== null ? (
            <Link
              className="row-link"
              to={convertHref(organism, {
                identifier: r.query_id,
                fromRelease: request.from_release,
                toRelease: request.to_release,
                finalDatabase: request.final_database,
                fromDatabase: request.from_database,
                allowBridges: request.allow_bridges,
                explain: true,
              })}
            >
              Path<span className="visually-hidden"> of {r.query_id}</span>
            </Link>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="batch-detail" id={detailId} aria-rowindex={rowIndex === undefined ? undefined : rowIndex + 1}>
          <td colSpan={columns} data-label="">
            <Detail row={row} names={names} />
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

/** The decision between the best answer and the runner-up in words: which criterion decided, each one's values of the
 *  fields it compares, which ranks first, and that the criteria after it are not compared. */
function DecisionWords({ result }: { result: ConversionResult }) {
  const vocabulary = useVocabulary();
  const criterion = criterionOf(vocabulary, result.decided_by);
  if (!criterion || !result.decided_by) return null;
  const runnerUp = result.candidates.find((c) => !c.best);
  const bests = result.candidates.filter((c) => c.best);
  if (!runnerUp) return null;
  // idtrack compares the lineage criteria with the first best answer, and the criteria within a lineage (score, being
  // the query, annotation) with the best successor of the runner-up's own entry gene (as lib/pathModel.ts decisionOf).
  const within = ["score", "same_as_query", "annotation"].includes(result.decided_by);
  const best: Candidate | undefined =
    (within ? bests.find((c) => c.entry_gene === runnerUp.entry_gene) : undefined) ?? bests[0];
  if (!best) return null;
  const a = criterionValue(criterion, best);
  const b = criterionValue(criterion, runnerUp);
  const order = criterion.fields.map(firstWords);
  return (
    <p className="batch-detail__decision">
      <span className="batch-detail__decision-label">Why the best is first</span> Decided by{" "}
      <strong>{spaced(criterion.code)}</strong> (criterion {criterion.index + 1} of {vocabulary.criteria.length}):{" "}
      <Mono>{best.gene}</Mono> has <Mono>{a.text}</Mono>, the runner-up <Mono>{runnerUp.gene}</Mono>{" "}
      <Mono>{b.text}</Mono>
      {order.length ? <> ({order.join("; ")})</> : null}.{" "}
      {criterion.index > 0
        ? `The ${String(criterion.index)} ${criterion.index === 1 ? "criterion" : "criteria"} before it are equal for the two; `
        : ""}
      the criteria after it are not compared.
    </p>
  );
}

/** Everything the result holds beyond its row: its evidence in words, how it was read, the decision, every candidate in
 *  rank order with its names, every reason. */
function Detail({ row, names }: { row: BatchRow; names: NamesState }) {
  const r = row.result;
  const vocabulary = useVocabulary();
  const criterion = criterionOf(vocabulary, r.decided_by);
  const geneIsTarget = r.candidates.every((c) => c.gene === c.target);
  return (
    <div className="batch-detail__body">
      {row.evidence.length ? (
        <ul className="batch-detail__evidence">
          {row.evidence.map((m) => (
            <li key={`${m.kind}|${m.label}`} className={`emark-line emark-line--${m.tone}`}>
              <span className="emark-line__label">
                {m.tone === "caution" ? "Caution" : "Note"}: <Prose text={m.label} />
              </span>{" "}
              <Prose text={m.detail} />
              {m.meaning ? (
                <span className="emark-line__meaning">
                  idtrack: <Prose text={m.meaning} />{" "}
                  <span className="code-quiet" title="The field of the result">
                    {m.code}
                  </span>
                </span>
              ) : null}
              {m.limitation ? (
                <span className="emark-line__limitation">
                  A known limitation of idtrack: {m.limitation.lead}{" "}
                  <a href={m.limitation.href} target="_blank" rel="noreferrer">
                    {m.limitation.title}
                    <span className="visually-hidden"> (idtrack&apos;s documentation, opens in a new tab)</span>
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <DecisionWords result={r} />
      <dl className="batch-detail__facts">
        <Fact label="Read as">
          {r.graph_id === null ? <span className="muted">not in the graph</span> : <Mono>{r.graph_id}</Mono>}
          {r.match ? (
            <span className="batch-detail__match">
              {matchParts(vocabulary, r.match).map((part) => (
                <span key={`${part.role}-${part.code}`} className="tag">
                  {matchLabel(part.code, part.role)}
                </span>
              ))}
            </span>
          ) : null}
        </Fact>
        <Fact label="Read at">
          {r.from_release === null ? (
            <span className="muted">no release</span>
          ) : (
            <>
              <Mono>{r.from_release}</Mono>{" "}
              <span className="muted">
                {r.from_release_fallback
                  ? `(release ${String(r.from_release_given)} was given; the graph does not hold the identifier there)`
                  : r.from_release_inferred
                    ? "(inferred)"
                    : "(given)"}
              </span>
            </>
          )}
        </Fact>
        {r.from_databases.length ? <Fact label="Through">{r.from_databases.map(databaseLabel).join(", ")}</Fact> : null}
        <Fact label="Target">
          release <Mono>{r.to_release}</Mono>
          {r.final_database ? <>, {databaseLabel(r.final_database)}</> : null}
        </Fact>
        {r.decided_by ? (
          <Fact label="Decided by">
            {spaced(r.decided_by)}
            {criterion ? ` (criterion ${String(criterion.index + 1)} of ${String(vocabulary.criteria.length)})` : ""}
          </Fact>
        ) : null}
        {r.tie ? (
          <Fact label="Tie">yes: several best answers equal in all the evidence; every one is listed</Fact>
        ) : null}
        {row.crossed?.events.length ? <Fact label="History on the path">{eventsText(row)}</Fact> : null}
        {r.known_versions.length ? (
          <Fact label="Versions held">
            <Mono>{r.known_versions.join(", ")}</Mono>
          </Fact>
        ) : null}
        {r.alternative_locus_genes.length ? (
          <Fact label="Alternative loci">
            <Mono>{r.alternative_locus_genes.join(", ")}</Mono>
          </Fact>
        ) : null}
        {r.no_target_genes.length ? (
          <Fact label="Without an id there">
            <Mono>{r.no_target_genes.join(", ")}</Mono>
          </Fact>
        ) : null}
        {r.other_readings.length ? (
          <Fact label="Other readings">
            <Mono>{r.other_readings.length}</Mono> <span className="muted">(listed with the path)</span>
          </Fact>
        ) : null}
      </dl>
      {r.reasons.length ? (
        <ul className="batch-detail__reasons">
          {r.reasons.map((reason) => {
            const meaning = vocabulary.reasons.get(reason);
            return <li key={reason}>{meaning ? <Prose text={meaning} /> : spaced(reason)}</li>;
          })}
        </ul>
      ) : null}
      {r.candidates.length ? (
        <TableFrame label={`The candidates of ${r.query_id}`} className="batch-detail__candidates">
          <table className="table table--compact table--batch-candidates">
            <caption className="visually-hidden">The candidates of {r.query_id}, ranked</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  Rank
                </th>
                <th scope="col">{r.no_target ? "Gene (no id in the database)" : geneIsTarget ? "Gene" : "Target"}</th>
                {geneIsTarget ? null : (
                  <th scope="col">
                    <FieldTerm vocabulary={vocabulary} field="gene">
                      Gene
                    </FieldTerm>
                  </th>
                )}
                {names.database ? <th scope="col">{databaseLabel(names.database)}</th> : null}
                <th scope="col">
                  <FieldTerm vocabulary={vocabulary} field="entry_gene">
                    Entry gene
                  </FieldTerm>
                </th>
                <th scope="col" className="num">
                  <FieldTerm vocabulary={vocabulary} field="score">
                    Score
                  </FieldTerm>
                </th>
                <th scope="col" className="num">
                  <FieldTerm vocabulary={vocabulary} field="history_steps">
                    History steps
                  </FieldTerm>
                </th>
                <th scope="col" className="num">
                  <FieldTerm vocabulary={vocabulary} field="bridges">
                    Bridges
                  </FieldTerm>
                </th>
                <th scope="col">Best</th>
              </tr>
            </thead>
            <tbody>
              {r.candidates.map((c, k) => (
                <tr key={`${c.gene}|${c.target}|${k}`} className={c.best ? "is-best" : undefined}>
                  <td className="num">
                    <Mono>{k + 1}</Mono>
                  </td>
                  <td>
                    <Mono strong={c.best}>{c.target}</Mono>
                  </td>
                  {geneIsTarget ? null : (
                    <td>
                      <Mono>{c.gene}</Mono>
                    </td>
                  )}
                  {names.database ? (
                    <td>
                      <Mono>{namesOfGene(names, c.gene).join(", ") || ABSENT}</Mono>
                    </td>
                  ) : null}
                  <td>
                    <Mono>{c.entry_gene}</Mono>
                  </td>
                  <td className="num">
                    <Mono>{pythonFloat(c.score)}</Mono>
                  </td>
                  <td className="num">
                    <Mono>{c.history_steps}</Mono>
                  </td>
                  <td className="num">
                    <Mono>{c.bridges}</Mono>
                  </td>
                  <td>{yesNo(c.best)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      ) : null}
      {r.error ? (
        <p className="batch-detail__error">
          {r.error.message} <span className="code-quiet">{r.error.type}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The splits and merges of a row's best path in words, each event once ("split and merge at 69 → 70"). */
function splitsAndMerges(row: BatchRow): string[] {
  const at = new Map<string, Set<string>>();
  for (const e of row.crossed?.events ?? []) {
    if (e.kind !== "split" && e.kind !== "merge") continue;
    const key = `${String(e.old)} → ${String(e.new)}`;
    at.set(key, (at.get(key) ?? new Set()).add(e.kind));
  }
  return [...at.entries()].map(
    ([releases, kinds]) => `${kinds.size === 2 ? "split and merge" : ([...kinds][0] ?? "")} at ${releases}`,
  );
}

/** The history steps of a row's best path in words, the kinds of one step together ("split and merge at 69 → 70"). */
function eventsText(row: BatchRow): string {
  const at = new Map<string, string[]>();
  for (const e of row.crossed?.events ?? []) {
    const key = `${String(e.old)} → ${String(e.new)}`;
    const kinds = at.get(key) ?? [];
    if (!kinds.includes(EVENT_WORDS[e.kind])) kinds.push(EVENT_WORDS[e.kind]);
    at.set(key, kinds);
  }
  return [...at.entries()].map(([releases, kinds]) => `${kinds.join(" and ")} at ${releases}`).join("; ");
}

/** A column head whose meaning is idtrack's text of the Candidate field, on a press. */
function FieldTerm({ vocabulary, field, children }: { vocabulary: Vocabulary; field: string; children: string }) {
  const meaning = vocabulary.candidateFields.get(field);
  if (!meaning) return <>{children}</>;
  return (
    <Toggletip
      label={`${children}: what it means`}
      tip={
        <span className="toggletip__text">
          <Prose text={meaning} />
        </span>
      }
    >
      {children}
    </Toggletip>
  );
}

/** The room of the rows a long table does not draw. */
function Spacer({ height, span }: { height: number; span: number }) {
  return (
    <tbody aria-hidden="true" className="batch-spacer">
      <tr>
        <td colSpan={span} style={{ height: `${height.toFixed(1)}px` }} />
      </tr>
    </tbody>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt className="fact__label">{label}</dt>
      <dd className="fact__value">{children}</dd>
    </div>
  );
}

// ---- Panel c ----------------------------------------------------------------------------------------------------

/** The glyph of each kind of step a path crosses (DESIGN.md, the figure grammar). */
const CROSSING_GLYPH: Record<
  Crossing,
  { glyph: "version" | "event" | "handoff" | "loop" | "bridge" | "read"; event?: boolean }
> = {
  version: { glyph: "version" },
  replaced: { glyph: "version" },
  split: { glyph: "event" },
  merge: { glyph: "event" },
  handoff: { glyph: "handoff" },
  remap: { glyph: "loop" },
  bridge: { glyph: "bridge" },
  external: { glyph: "read" },
};

const CROSSING_LONG: Record<Crossing, string> = {
  version: "a new version of the same id",
  replaced: "another id (a replacement)",
  split: "a split",
  merge: "a merge",
  handoff: "a change of assembly",
  remap: "a re-mapping of a gene to itself",
  bridge: "a bridge (idtrack's inference)",
  external: "a reading through an external database",
};

function Releases({
  description,
  results,
  summary,
  request,
  filter,
  show,
}: {
  description: GraphDescription;
  results: ConversionResult[];
  summary: BatchSummary;
  request: Required<BatchRequest>;
  filter: Filter;
  show: (f: Filter) => void;
}) {
  const readAt = useMemo(() => readAtCounts(results), [results]);
  const axis = useMemo(() => axisOf(description.releases), [description]);
  const bands = useMemo(() => bandsOf(axis, description), [axis, description]);
  const target = request.to_release ?? description.snapshot_release;
  const endpoint = `POST /api/v1/organisms/${description.organism}/convert/batch`;
  const byRelease = [...readAt.byRelease.entries()].sort((a, b) => b[0] - a[0]);
  const elsewhere = byRelease.filter(([r]) => r !== target);
  const max = Math.max(0, ...elsewhere.map(([, n]) => n));
  const atTarget = readAt.byRelease.get(target) ?? 0;
  const [allPlaced, setAllPlaced] = useState(true);
  const oneRelease = byRelease.length === 1;
  const eventTotal = [...summary.events.values()].reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0);
  const crossed = CROSSINGS.map((k): [Crossing, number] => [k, summary.crossings.get(k) ?? 0]);
  const most = Math.max(1, ...crossed.map(([, n]) => n));
  return (
    <section className="panel batch-panel" aria-labelledby="batch-releases">
      <div className="panel-head">
        <span className="panel-letter" aria-hidden="true">
          c
        </span>
        <h3 id="batch-releases" className="panel-head__title">
          Through the releases
        </h3>
      </div>
      <div className="batch-releases">
        <figure className="batch-readat">
          <figcaption className="batch-readat__title">
            Where each identifier was read, and where its path stepped
          </figcaption>
          {elsewhere.length && !oneRelease ? (
            <TravelArcs
              axis={axis}
              bands={bands}
              counts={readAt.byRelease}
              target={target}
              onPlaced={setAllPlaced}
              describe={(release, n) =>
                `Release ${release}: ${groupedInteger(n)} ${n === 1 ? "identifier" : "identifiers"}`
              }
            />
          ) : (
            <p className="batch-readat__all">
              {oneRelease && byRelease[0] ? (
                <>
                  All <Mono>{groupedInteger(byRelease[0][1])}</Mono> identifiers read at a release were read at release{" "}
                  <Mono>{byRelease[0][0]}</Mono>
                  {byRelease[0][0] === target ? (
                    <>, the target: none travelled to reach it.</>
                  ) : (
                    <>
                      {" "}
                      and followed to release <Mono>{target}</Mono>.
                    </>
                  )}
                </>
              ) : atTarget ? (
                <>
                  All <Mono>{groupedInteger(atTarget)}</Mono> identifiers read at a release were read at the target
                  release, <Mono>{target}</Mono>: none travelled through Ensembl&rsquo;s history to reach it.
                </>
              ) : (
                <>No identifier was read at a release.</>
              )}
            </p>
          )}
          {summary.paths && eventTotal ? (
            <EventStrip
              axis={axis}
              bands={bands}
              events={summary.events}
              rows={summary.eventRows}
              label="Steps of Ensembl's history on the best paths, by release"
            />
          ) : null}
          <ReleaseScale
            position="below"
            axis={axis}
            bands={bands}
            marks={[{ release: target, label: `target ${target}`, kind: "target" }]}
          />
          <p className="batch-readat__data">
            <span className="setting__label">read at</span>{" "}
            {byRelease.map(([release, n], i) => (
              <Fragment key={release}>
                {i ? ", " : ""}
                <span className="mono nowrap">
                  {release}&thinsp;({groupedInteger(n)})
                </span>
              </Fragment>
            ))}
            {readAt.none ? (
              <span>
                {byRelease.length ? "; " : ""}
                <span className="mono">{groupedInteger(readAt.none)}</span> read at no release (the status says why)
              </span>
            ) : null}
          </p>
          {summary.paths && eventTotal ? <EventData events={summary.events} /> : null}
          <p className="fig-caption">
            {elsewhere.length && !oneRelease ? (
              <>
                Above the axis, each arc leaves the release at which identifiers were read (<Mono>from_release</Mono>)
                for the target release, {target}; its width grows linearly with their number (the widest arc:{" "}
                {groupedInteger(max)}), its height with the distance travelled
                {allPlaced
                  ? ", and its number stands under its foot"
                  : "; the numbers stand under the feet where they have room, and every one is in the line under the axis"}
                . The mark on the target holds the identifiers read there. An arc joins two releases, not the steps
                between them.{" "}
              </>
            ) : null}
            {summary.paths && eventTotal ? (
              <>
                {elsewhere.length && !oneRelease ? "Below the arcs" : "Above the axis"}, a column at each release where
                the best paths took a step of Ensembl&rsquo;s history, as tall as the number of identifiers whose path
                stepped there, of each kind (one step of two kinds, a split and merge or a step across assemblies, is in
                both), stacked in the hue of its family: history, splits and merges, assembly changes; the number on a
                column counts each identifier once. A step is placed at the first release of its later id, in
                Ensembl&rsquo;s direction.{" "}
              </>
            ) : null}
            Behind, the assemblies that serve the releases. Counted from the answer of <Mono>{endpoint}</Mono>
            {request.explain ? " with every path" : ""}.
          </p>
        </figure>
        <figure className="batch-crossed">
          <figcaption className="batch-readat__title">What the best paths crossed</figcaption>
          {summary.paths ? (
            <ul className="crossed" aria-label="Identifiers whose best path crosses each kind of step">
              {crossed.map(([kind, n]) => (
                <li key={kind} className={`crossed__item ${n ? "" : "is-zero"}`}>
                  <GlyphSwatch glyph={CROSSING_GLYPH[kind].glyph} />
                  <span className="crossed__name">{CROSSING_LONG[kind]}</span>
                  <span className="crossed__bar" aria-hidden="true">
                    <span
                      className={`crossed__fill crossed__fill--${CROSSING_GLYPH[kind].glyph}`}
                      style={{ width: `${((n / most) * 100).toFixed(2)}%` }}
                    />
                  </span>
                  <span className="crossed__count mono">{groupedInteger(n)}</span>
                  {n ? (
                    <button
                      type="button"
                      className="crossed__show"
                      aria-pressed={filter.crossings.has(kind) && filter.crossings.size === 1}
                      aria-label={`Show only these rows: ${CROSSING_LONG[kind]}, ${groupedInteger(n)}`}
                      onClick={() => {
                        show(onlyCrossing(filter, kind));
                      }}
                    >
                      Show
                    </button>
                  ) : (
                    <span className="crossed__none" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="batch-readat__all">
              The batch was answered without its paths, so what they crossed is not known here; each row&rsquo;s{" "}
              <em>Path</em> shows its own.
            </p>
          )}
          <p className="fig-caption">
            The number of identifiers whose best path (every best candidate&rsquo;s, a tie&rsquo;s too) holds each kind
            of step at least once, drawn with its glyph of the site&rsquo;s figures; a bar is as long as its count, the
            longest {groupedInteger(most)}. <em>Show</em> shows only those rows in panel b.
          </p>
        </figure>
      </div>
    </section>
  );
}

/** The columns of the event strip as text (the figure's text alternative and the exact counts). */
function EventData({ events }: { events: BatchSummary["events"] }) {
  const releases = [...events.keys()].sort((a, b) => a - b);
  return (
    <p className="batch-readat__data batch-readat__events">
      <span className="setting__label">steps at</span>{" "}
      {releases.map((release, i) => {
        const at = events.get(release);
        const parts = [...(at?.entries() ?? [])].map(([kind, n]) =>
          eventCount(kind, n).replace(/^\d+/, groupedInteger(n)),
        );
        return (
          <Fragment key={release}>
            {i ? "; " : ""}
            <span className="nowrap">
              <span className="mono">{release}</span> ({parts.join(", ")})
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

// ---- Panel d ----------------------------------------------------------------------------------------------------

function Downloads({
  description,
  answer,
  rows,
  names,
}: {
  description: GraphDescription;
  answer: BatchAnswer;
  rows: BatchRow[];
  names: NamesState;
}) {
  const { request, raw, requestId, serverTiming, answeredAt, count, source, pathsRefused } = answer;
  const organism = description.organism;
  const version = useRequest("version", (signal, fresh) => api.version({ signal, fresh }));
  const tsv = useAction((signal, body: BatchRequest) => api.batchTsv(organism, body, signal));
  const [tsvAsked, setTsvAsked] = useState<BatchProvenance["tsv"]>(null);
  const provenance = () => {
    const made = batchProvenance({
      description,
      version: version.state === "done" ? version.answer.data : null,
      request,
      requestId,
      serverTiming,
      answeredAt,
      count,
      source,
      pathsRefused,
      tsv: tsvAsked,
    });
    const stamp = made.exported_at.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    return { made, stamp };
  };
  const saveTable = () => {
    const { made, stamp } = provenance();
    saveText(
      rowTable(rows, made, source, names.names),
      `idtrack_${organism}_batch_${stamp}_table.tsv`,
      "text/tab-separated-values",
    );
  };
  const saveProvenance = () => {
    const { made, stamp } = provenance();
    saveText(
      `${JSON.stringify(made, null, 2)}\n`,
      `idtrack_${organism}_batch_${stamp}_provenance.json`,
      "application/json",
    );
  };
  const saveJson = () => {
    const { stamp } = provenance();
    saveText(raw, `idtrack_${organism}_batch_${stamp}${request.explain ? "_paths" : ""}.json`, "application/json");
  };
  const saveTsv = () => {
    // The api's table of one row per candidate holds no path: it is asked without one.
    void tsv.start({ ...request, explain: false }).then((reply) => {
      if (!reply) return;
      setTsvAsked({
        request_id: reply.requestId,
        server_timing: reply.serverTiming,
        answered_at: new Date().toISOString(),
      });
      const { stamp } = provenance();
      saveText(reply.raw, `idtrack_${organism}_batch_${stamp}.tsv`, "text/tab-separated-values");
    });
  };
  const namesPending = names.database !== null && names.state === "loading";
  return (
    <section
      className="panel batch-panel batch-downloads"
      aria-labelledby="batch-downloads-title"
      id="batch-downloads"
      tabIndex={-1}
    >
      <div className="panel-head">
        <span className="panel-letter" aria-hidden="true">
          d
        </span>
        <h3 id="batch-downloads-title" className="panel-head__title">
          Download
        </h3>
      </div>
      <ul className="downloads">
        <li className="downloads__item">
          <Button onClick={saveTable} disabled={namesPending}>
            {namesPending ? "Waiting for the names…" : "Table, one row per identifier (TSV)"}
          </Button>
          <p className="downloads__note">
            Made from the answer shown, in your order
            {source?.separator ? ", with your own columns" : ""}: the gene and its id in each database shown
            {names.database ? ` (${databaseLabel(names.database)} beside it)` : ""}, how it was read, the other genes
            reached, the history on its path, the evidence. It begins with lines that start with <Mono>#</Mono> and say
            where it came from (the organism, idtrack&rsquo;s and the api&rsquo;s versions, the graph&rsquo;s content
            digest, the request, the time); a cell that begins with <Mono>=</Mono>, <Mono>+</Mono>, <Mono>-</Mono> or{" "}
            <Mono>@</Mono> and is no number is written after an apostrophe, so that a spreadsheet shows it as text.
          </p>
        </li>
        <li className="downloads__item">
          <Button onClick={saveJson}>The api&rsquo;s JSON</Button>
          <p className="downloads__note">
            The answer shown, byte for byte{request.explain ? ", with every candidate's path" : ""}.
          </p>
        </li>
        <li className="downloads__item">
          <Button onClick={saveTsv} disabled={tsv.state === "loading"}>
            {tsv.state === "loading" ? "Asking for the TSV…" : "The api’s TSV"}
          </Button>
          <p className="downloads__note">
            One row per candidate with every field of the result (<Mono>input_index</Mono> counts from 0), as the api
            writes its table. It is a second request of the same body, answered again by the same graph (an answer is
            the same for the same graph and settings); its request id goes into the provenance. Its cells are written as
            given, so a spreadsheet may read a cell that begins with <Mono>=</Mono> as a formula.
          </p>
          {tsv.state === "failed" ? <ErrorPanel error={tsv.error} context="The TSV" level={3} /> : null}
        </li>
        <li className="downloads__item">
          <Button onClick={saveProvenance}>Provenance (JSON)</Button>
          <p className="downloads__note">
            Which server, graph and request gave the answer (with the request&rsquo;s whole body), and the TSV&rsquo;s
            request where it was asked.
          </p>
        </li>
      </ul>
    </section>
  );
}
