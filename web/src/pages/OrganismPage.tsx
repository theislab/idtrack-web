// Explore what the server's graphs hold: the graphs side by side (their releases and assemblies on one axis, with each
// assembly change and whether Ensembl maps it; Ensembl's id history of each graph, release by release; the counts of
// their builds), and each graph on its own page: its assemblies, its id history, the composition of its build, what a
// conversion to each release can end in (and what each database name holds), and the record of its build and file,
// with whether the benchmarks measured this very graph. Every value is the api's, IDTrack's documentation's or the
// benchmarks' published results'.
import { docsPage } from "../lib/links";
import { useEffect, useId, useMemo, useState } from "react";
import { api, ApiError, TimeoutError, UnreachableError, type AnyRequestError } from "../api/client";
import type { AssemblyDescription, GraphDescription, GraphVersion, HistoryResponse } from "../api/types";
import { AssemblyRows } from "../components/explore/AssemblyRows";
import { IdHistory } from "../components/explore/IdHistory";
import { BenchmarkProvenance } from "../components/method/BenchmarkProvenance";
import { ExploreStories, StoriesOrganism } from "../components/explore/Stories";
import { chipName } from "../lib/explore/chips";
import { CaptionMore } from "../components/v2/CaptionMore";
import { Segmented } from "../components/v2/Segmented";
import { Tabs } from "../components/v2/Tabs";
import { Expandable } from "../components/v2/Expandable";
import { HoverCard } from "../components/v2/HoverCard";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LineageField } from "../components/explore/LineageField";
import { OrganismAssemblies } from "../components/explore/OrganismAssemblies";
import { FactsStrip } from "../components/explore/FactsStrip";
import {
  caseMarks,
  changed,
  fansCounted,
  historyColumns,
  historyHeight,
  kindWords,
  largestFan,
  niceMax,
  tallest,
} from "../lib/explore/history";
import { ReleaseTicks } from "../components/figure/axis";
import { releaseScale } from "../components/figure/releases";
import { useWidth } from "../components/figure/useWidth";
import { CountsFigure } from "../components/explore/CountsFigure";
import { DatabaseMatrix } from "../components/explore/DatabaseMatrix";
import { Absent, Button, CopyButton, Link, Mono, Prose, Readout, Skeleton, TableFrame } from "../components/ui";
import docs from "../generated/idtrack_docs.json";
import { BENCHMARKS_META, measuredGraph } from "../lib/benchmarksMeta";
import {
  DATA_SOURCES_SOURCE,
  DATABASE_FILING_SOURCE,
  DATABASE_MEANINGS_SOURCE,
  describeDatabase,
  type DatabaseDescription,
} from "../lib/databaseMeanings";
import { databaseLabel } from "../lib/databases";
import { handoffsOf } from "../lib/explore/handoffs";
import { loadDatabaseMatrix, type DatabaseMatrix as DatabaseMatrixData } from "../lib/explore/databaseMatrix";
import { caseHref, caseQueryOf, releasesOf } from "../lib/home/links";
import { byteSize, groupedInteger, releaseRanges } from "../lib/numbers";
import { commonName, organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { href, navigate, useLocation } from "../lib/router";
import { organismNamed } from "../lib/explore/organismAddress";
import { useRequest } from "../lib/useRequest";
import { setTitleDetail } from "../lib/title";
import "../styles/explore.css";
import { NoSuchFigure } from "../components/NotFound";

/** Assemblies in the order they serve releases (the earliest first). */
function chronological(assemblies: readonly AssemblyDescription[]): AssemblyDescription[] {
  const start = (a: AssemblyDescription) => Math.min(...(a.serves.length ? a.serves : a.releases));
  return [...assemblies].sort((a, b) => start(a) - start(b));
}

function PanelHead({
  letter,
  id,
  title,
  source,
  level = 2,
}: {
  letter?: string;
  id: string;
  title: string;
  source?: string;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={`explore-head${letter ? "" : " explore-head--plain"}`}>
      {letter ? (
        <span className="panel-letter" aria-hidden="true">
          {letter}
        </span>
      ) : null}
      <H id={id}>{title}</H>
      {source ? (
        <p className="explore-head__source">
          <span className="mono">GET {source}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The legend of the graphs' assemblies on one axis. */
function AssemblyLegend() {
  return (
    <ul className="fig-legend" aria-label="Legend">
      <li>
        <svg width="30" height="14" aria-hidden="true">
          <rect x="1" y="2" width="28" height="10" rx="2.5" className="arows__serve" />
        </svg>
        Releases the assembly serves (its annotation counts there)
      </li>
      <li>
        <svg width="16" height="14" aria-hidden="true">
          <path d="M8,1 L13,7 L8,13 L3,7 Z" className="arows__handoff arows__handoff--published" />
        </svg>
        A change of assembly that Ensembl maps
      </li>
      <li>
        <svg width="16" height="14" aria-hidden="true">
          <path d="M8,1 L13,7 L8,13 L3,7 Z" className="arows__handoff arows__handoff--none" />
        </svg>
        A change of assembly that Ensembl does not map
      </li>
    </ul>
  );
}

/** A graph's history from the server (`GET /organisms/{organism}/history`). */
function useHistory(organism: string) {
  return useRequest(`history|${organism}`, (signal) => api.history(organism, { signal }));
}

/** A swatch of the history figure's marks, drawn as the figure draws them. */
function HistorySwatch({ kind }: { kind: "version" | "id" | "retired" | "created" | "fan" | "kept" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width="14" height="14" aria-hidden="true">
      {kind === "id" ? (
        <defs>
          <pattern id={id} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={3} height={3} className="idh__hatch-ground" />
            <rect width={1.6} height={3} className="idh__hatch" />
          </pattern>
        </defs>
      ) : null}
      <rect
        x={kind === "created" || kind === "kept" ? 1.5 : 1}
        y={kind === "created" || kind === "kept" ? 1.5 : 1}
        width={kind === "created" || kind === "kept" ? 11 : 12}
        height={kind === "created" || kind === "kept" ? 11 : 12}
        className={`idh__${kind}`}
        fill={kind === "id" ? `url(#${id})` : undefined}
      />
    </svg>
  );
}

function HistoryLegend({
  genes = true,
  marks = false,
  fans = true,
  kept = true,
}: {
  genes?: boolean;
  marks?: boolean;
  fans?: boolean;
  kept?: boolean;
}) {
  return (
    <ul className="fig-legend" aria-label="Legend">
      {genes ? (
        <li>
          <svg width="30" height="14" aria-hidden="true">
            <line x1="1" x2="29" y1="7" y2="7" className="idh__line" />
          </svg>
          Gene ids active at the release
        </li>
      ) : null}
      <li>
        <HistorySwatch kind="version" />A version followed by another version of the same id
      </li>
      <li>
        <HistorySwatch kind="id" />A version followed by a version of another id
      </li>
      <li>
        <HistorySwatch kind="retired" />
        An id retired
      </li>
      <li>
        <HistorySwatch kind="created" />
        Ids created (below the axis)
      </li>
      {fans ? (
        <li>
          <HistorySwatch kind="fan" />A version mapped to two or more (a split, above its line) or two or more mapped to
          one (a merge, below)
        </li>
      ) : null}
      {kept ? (
        <li>
          <HistorySwatch kind="kept" />
          An id and its version kept by Ensembl&apos;s mapping (re-mapped to itself)
        </li>
      ) : null}
      {marks ? (
        <li>
          <svg width="22" height="14" aria-hidden="true">
            <line x1="7" x2="7" y1="9" y2="14" className="idh__mark-stem" />
            <line x1="7" x2="7" y1="1" y2="9" className="fig-glyph fig-glyph--version fig-hue--history" />
            <text x="12" y="10" className="fig-text idh__mark-number">
              1
            </text>
          </svg>
          A conversion of this server, numbered as in the list below, at the release of its defining step (its
          kind&apos;s glyph)
        </li>
      ) : null}
    </ul>
  );
}

/** Why a history could not be read, in a few words for a row of a figure. */
function failureWords(error: AnyRequestError): string {
  if (error instanceof UnreachableError) return error.offline ? "the browser is offline" : "the api cannot be reached";
  if (error instanceof TimeoutError) return "no answer in time";
  if (error instanceof ApiError) return error.body.message;
  return error.message;
}

function HistoryRow({ graph, releases, share }: { graph: GraphDescription; releases: number[]; share: boolean }) {
  const answer = useHistory(graph.organism);
  const columns = answer.state === "done" ? historyColumns(answer.answer.data) : [];
  const up = niceMax(Math.max(0, ...columns.map(changed)));
  const down = niceMax(Math.max(0, ...columns.filter((c) => !c.first).map((c) => c.created)));
  const fan = fansCounted(columns)
    ? niceMax(Math.max(0, ...columns.map((c) => Math.max(c.fanOut ?? 0, c.fanIn ?? 0))))
    : null;
  return (
    <li>
      <div className="idh-rows__label">
        <Link to={href(`/organisms/${graph.organism}`)} className="arows__link">
          <em>{organismName(graph.organism)}</em>
          {commonName(graph.organism) ? <span className="arows__common">{commonName(graph.organism)}</span> : null}
        </Link>
        {columns.length && !share ? (
          <span className="idh-rows__scale">
            scales to <span className="mono">{groupedInteger(up)}</span> changed,{" "}
            <span className="mono">{groupedInteger(down)}</span> created
            {fan === null ? null : (
              <>
                , <span className="mono">{groupedInteger(fan)}</span> split or merged
              </>
            )}
          </span>
        ) : null}
      </div>
      {answer.state === "done" ? (
        <IdHistory
          history={answer.answer.data}
          description={graph}
          releases={releases}
          compact
          share={share}
          axis={false}
          organism={graph.organism}
          label={`Ensembl's id history of the ${organismName(graph.organism)} graph, release by release${share ? ", as shares of the gene ids active" : ""}`}
        />
      ) : answer.state === "failed" ? (
        <p className="idh-rows__failed" role="status">
          The history of this graph could not be read: {failureWords(answer.error)}.{" "}
          <Button onClick={answer.retry}>Try again</Button>
        </p>
      ) : (
        <Skeleton height={historyHeight(true)} />
      )}
    </li>
  );
}

const MODES = [
  { value: "counts", words: "Counts", note: "each graph on its own scale" },
  { value: "shares", words: "Share of the gene ids active", note: "every graph on one axis, 0 to 100 %" },
] as const;

function HistoryIndexPanel({ organisms, releases }: { organisms: GraphDescription[]; releases: number[] }) {
  const [mode, setMode] = useState<"counts" | "shares">("counts");
  const share = mode === "shares";
  const { ref, width } = useWidth<HTMLDivElement>(900);
  if (!organisms.length) return null;
  const scale = releaseScale(releases, 4, width - 8);
  return (
    <section className="panel explore-panel" aria-labelledby="graphs-history">
      <PanelHead
        letter="b"
        id="graphs-history"
        title="Ensembl's id history, release by release"
        source="/api/v1/organisms/{organism}/history"
      />
      <Segmented
        className="idh-mode"
        label="How the columns are measured"
        value={mode}
        onChange={setMode}
        options={MODES.map(({ value, words, note }) => ({
          value,
          label: (
            <>
              {words}
              <span className="visually-hidden">: {note}</span>
            </>
          ),
        }))}
      />
      <ul className="idh-rows">
        {organisms.map((o) => (
          <HistoryRow key={o.organism} graph={o} releases={releases} share={share} />
        ))}
      </ul>
      <div className="idh-rows__axis" ref={ref} aria-hidden="true">
        <svg width={width} height={26}>
          <ReleaseTicks scale={scale} y={2} releases={releases} />
        </svg>
      </div>
      <HistoryLegend genes={false} kept={false} />
      <p className="fig-caption">
        <CaptionMore
          lead={
            <>
              <strong>b</strong> For each graph, what Ensembl&apos;s stable id history of genes did at each release:
              above the line, the edges that change or retire an id; below it, the ids created; under them, the splits
              and merges of Ensembl&apos;s mapping.
            </>
          }
        >
          On the axis of panel a (drawn once, under the rows), as the server counted it from the graph when it started:
          above the line, the history edges that end at the release and change or retire an id (a version followed by
          another version of its id, by a version of another id, or an id retired); below it, the ids created there;
          under them, the fan of Ensembl&apos;s mapping: the gene versions it maps to two or more (a split, upward) and
          those that two or more are mapped to (a merge, downward).{" "}
          {share
            ? "As shares: what changed into a release over the gene ids active at the release before it, and the ids created over those active at the release, every graph on one axis from 0 to 100 % (the splits and merges on 0 to 10 %)."
            : "As counts: each row has its own scale, its largest values written at the left."}{" "}
          The edges that keep an id and its version (a re-mapping to itself) are counted in each release&apos;s note and
          drawn on each graph&apos;s page. The ids of a graph&apos;s first release are where the graph begins and are
          not drawn. The tallest columns are not all changes of assembly: each graph&apos;s page names its tallest and
          says which are. Focus a row and use the arrow keys for each release&apos;s exact counts.
        </CaptionMore>
      </p>
    </section>
  );
}

/** The page's head: the same in every state, and drawn into the page the server sends before the code runs
 *  (scripts/prerender.ts). */
export function ExploreHead() {
  return (
    <header className="page-head">
      <h1>Stories from Ensembl&apos;s history</h1>
      <p className="lede">What can happen to a gene id, told by real identifiers this server answered.</p>
    </header>
  );
}

export function OrganismsIndex() {
  const { organisms } = useOrganisms();
  return (
    <div className="page page--explore">
      <ExploreHead />
      <Tabs
        label="Explore"
        param="tab"
        className="explore-tabs"
        items={[
          {
            id: "stories",
            label: "Stories",
            panel: () => (
              <>
                <StoriesOrganism />
                <ExploreStories />
              </>
            ),
          },
          {
            id: "graphs",
            label: "The graphs",
            panel: () => <TheGraphs organisms={organisms} />,
          },
        ]}
      />
    </div>
  );
}

/** Every graph of the server side by side: the sums of their builds, their releases and assemblies on one axis,
 *  Ensembl's id history of each, and their builds' counts. */
function TheGraphs({ organisms }: { organisms: GraphDescription[] }) {
  const releases = releasesOf(organisms);
  const first = releases[0] ?? 0;
  const last = releases[releases.length - 1] ?? 0;
  const max = (count: string) => Math.max(1, ...organisms.map((o) => o.counts[count] ?? 0));
  const columns: [string, string][] = [
    ["nodes", "Nodes"],
    ["history_edges", "History edges"],
    ["cross_reference_edges", "Cross-reference edges"],
  ];
  const maxDatabases = Math.max(1, ...organisms.map((o) => o.external_databases.length));
  return (
    <>
      <section className="explore-graphs" aria-label="The graphs this server holds">
        <p className="explore-graphs__lede">
          Each organism is one graph of Ensembl&apos;s releases, built by IDTrack from Ensembl&apos;s own tables and
          verified by its checksum when the server started; a conversion stays within one organism.
        </p>
        <FactsStrip organisms={organisms} />
      </section>

      <section className="panel explore-panel" aria-labelledby="graphs-axis">
        <PanelHead
          letter="a"
          id="graphs-axis"
          title="Releases and assemblies, on one axis"
          source="/api/v1/organisms"
        />
        <AssemblyRows
          label={`The assemblies of ${organisms.length} graphs over releases ${first} to ${last}. Arrow keys move between the assemblies.`}
          first={first}
          last={last}
          held={false}
          rows={organisms.map((o) => ({
            key: o.organism,
            owner: organismName(o.organism),
            primary: o.primary_assembly,
            assemblies: chronological(o.assemblies),
            handoffs: handoffsOf(o),
            label: (
              <Link to={href(`/organisms/${o.organism}`)} className="arows__link">
                <em>{organismName(o.organism)}</em>
                {commonName(o.organism) ? <span className="arows__common">{commonName(o.organism)}</span> : null}
              </Link>
            ),
          }))}
        />
        <AssemblyLegend />
        <p className="fig-caption">
          <CaptionMore
            lead={
              <>
                <strong>a</strong> Every graph of this server on one axis of Ensembl releases ({releaseRanges(releases)}
                ), each assembly a bar over the releases it serves, a diamond at each change of assembly.
              </>
            }
          >
            In each row, the assemblies of the organism in the order they serve releases (the assembly whose annotation
            counts at the release). An earlier assembly can be held beside the one that serves, so that its identifiers
            convert from it: each graph&apos;s page draws the releases at which it holds data of each assembly. A
            diamond is filled where Ensembl publishes a mapping of the two assemblies, through which IDTrack compares
            the places of genes across the change; open where it publishes none, and genes across the change are told
            apart only by the names of their chromosomes, as IDTrack&apos;s documentation states (
            <a href={docs.assemblyMapping.source}>{docs.assemblyMapping.title}</a>). Focus the figure and use the arrow
            keys for each assembly&apos;s exact releases and databases.
          </CaptionMore>
        </p>
      </section>

      <HistoryIndexPanel organisms={organisms} releases={releases} />

      <section className="panel explore-panel" aria-labelledby="graphs-counts">
        <PanelHead letter="c" id="graphs-counts" title="The builds side by side" source="/api/v1/organisms" />
        <TableFrame label="The graphs' builds" className="table-frame--cards">
          <table className="table table--cards explore-table">
            <thead>
              <tr>
                <th scope="col">Organism</th>
                <th scope="col">Releases</th>
                <th scope="col" className="num">
                  Assemblies
                </th>
                {columns.map(([key, label]) => (
                  <th key={key} scope="col" className="num">
                    {label}
                  </th>
                ))}
                <th scope="col" className="num">
                  External databases
                </th>
              </tr>
            </thead>
            <tbody>
              {organisms.map((o) => (
                <tr key={o.organism}>
                  <td data-label="Organism">
                    <Link to={href(`/organisms/${o.organism}`)}>
                      <em>{organismName(o.organism)}</em>
                    </Link>
                    {commonName(o.organism) ? (
                      <span className="explore-table__common">{commonName(o.organism)}</span>
                    ) : null}
                  </td>
                  <td data-label="Releases" className="cell-ranges">
                    <Mono>{releaseRanges(o.releases)}</Mono>
                  </td>
                  <td data-label="Assemblies" className="num">
                    <Mono>{o.assemblies.length}</Mono>
                  </td>
                  {columns.map(([key, label]) => {
                    const value = o.counts[key];
                    return (
                      <td key={key} data-label={label} className="num">
                        {value === undefined ? (
                          <Absent meaning="The graph file records no such count" />
                        ) : (
                          <span className="bar-cell">
                            <Mono>{groupedInteger(value)}</Mono>
                            <span
                              className="bar-cell__bar"
                              style={{ width: `${(value / max(key)) * 100}%` }}
                              aria-hidden="true"
                            />
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td data-label="External databases" className="num">
                    <span className="bar-cell">
                      <Mono>{o.external_databases.length}</Mono>
                      <span
                        className="bar-cell__bar"
                        style={{ width: `${(o.external_databases.length / maxDatabases) * 100}%` }}
                        aria-hidden="true"
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <p className="fig-caption">
          <CaptionMore
            lead={
              <>
                <strong>c</strong> The counts each graph file records of its build, the number of its assemblies and of
                its external databases.
              </>
            }
          >
            The counts are <span className="mono">counts</span> of the file, by IDTrack&apos;s names:{" "}
            <span className="mono">nodes</span>, <span className="mono">history_edges</span>,{" "}
            <span className="mono">cross_reference_edges</span>. Each bar is the value&apos;s share of the largest in
            its column (a linear scale from zero).
          </CaptionMore>
        </p>
      </section>
    </>
  );
}

export function OrganismPage() {
  const { organisms, version, status } = useOrganisms();
  const location = useLocation();
  // The answer of /organisms the page already holds (one request for every view), with the names each graph takes.
  const listed = useRequest("organisms", (signal, fresh) => api.organisms({ signal, fresh }));
  const asked = decodeURIComponent(location.path.replace(/^\/organisms\//, "").replace(/\/$/, ""));
  const named = listed.state === "done" ? organismNamed(asked, listed.answer.data) : null;
  const description = organisms.find((o) => o.organism === named);
  // Another name of a graph (`PIG`, `Homo sapiens`) shows the graph at its own address, as the api reads the name.
  useEffect(() => {
    if (named !== null && named !== asked) navigate(href(`/organisms/${named}`), { replace: true });
  }, [named, asked]);
  if (status !== "done") return null;
  if (!description) return <UnknownOrganism asked={asked} organisms={organisms} />;
  const file = version?.graphs.find((g) => g.organism === description.organism) ?? null;
  return <OrganismDetail key={description.organism} description={description} file={file} others={organisms} />;
}

/** An address that names no graph of this server: a page that says so under its own heading, titled "Not found". */
function UnknownOrganism({ asked, organisms }: { asked: string; organisms: GraphDescription[] }) {
  useEffect(() => {
    setTitleDetail("Not found");
    return () => {
      setTitleDetail(null);
    };
  }, []);
  return (
    <div className="page page--organism">
      <header className="page-head">
        <h1>
          No graph named <Mono>{asked}</Mono> here
        </h1>
        <p className="lede">
          This server holds {organisms.length === 1 ? "one graph" : `${organisms.length} graphs`}:{" "}
          {organisms.map((o, i) => (
            <span key={o.organism}>
              <Link to={href(`/organisms/${o.organism}`)}>
                <em>{organismName(o.organism)}</em>
              </Link>
              {commonName(o.organism) ? ` (${commonName(o.organism) ?? ""})` : ""}
              {i < organisms.length - 1 ? ", " : ""}
            </span>
          ))}
          . A conversion stays within one graph, one organism.
        </p>
      </header>
      <NoSuchFigure />
    </div>
  );
}

function MatrixPanel({ description: d }: { description: GraphDescription }) {
  const matrix = useRequest(`matrix|${d.organism}`, (signal) => loadDatabaseMatrix(d.organism, signal));
  const rows = matrix.state === "done" ? matrix.answer.data.databases.length : d.final_databases.length + 4;
  return (
    <section className="explore-panel" aria-labelledby="matrix" aria-busy={matrix.state === "loading"}>
      <PanelHead
        id="matrix"
        level={3}
        title="What a conversion to each release can end in"
        source={`/api/v1/organisms/${d.organism}/databases`}
      />
      {matrix.state === "done" ? (
        <DatabaseMatrix matrix={matrix.answer.data} description={d} />
      ) : matrix.state === "failed" ? (
        <p className="muted">The databases of each release could not be read: {matrix.error.message}</p>
      ) : (
        <Skeleton height={24 + rows * 20 + 30} />
      )}
      <ul className="fig-legend" aria-label="Legend">
        <li>
          <svg width="30" height="14" aria-hidden="true">
            <rect x="1" y="3" width="28" height="8" rx="2" className="dbm__run" />
          </svg>
          A conversion to the release can end in the database
        </li>
        <li>
          <svg width="30" height="14" aria-hidden="true">
            <rect x="1" y="1" width="28" height="12" className="fig-band--b" />
          </svg>
          The assembly that serves the release, alternately shaded
        </li>
      </ul>
      <p className="fig-caption">
        <CaptionMore
          lead={
            <>
              For each release of the graph (columns), the databases a conversion to that release can end in (rows; the
              names <span className="mono">final_database</span> takes).
            </>
          }
        >
          As IDTrack&apos;s <span className="mono">API.final_databases(to_release)</span> gives them: the external
          databases of the assembly that serves the release, and Ensembl&apos;s own gene ids with and without version;
          the external databases of each assembly are listed with the assemblies above. The rows a conversion can end in
          at some releases only come first, by their first release, above a rule; those of every release after it. Focus
          the matrix and use the arrow keys for each cell. Below, what each name holds, in IDTrack&apos;s words.
        </CaptionMore>
      </p>
      {matrix.state === "done" ? <DatabaseMeanings matrix={matrix.answer.data} organism={d.organism} /> : null}
    </section>
  );
}

/** What each database name of the graph holds, for this organism: IDTrack's words for the name (its page of external
 *  databases), the resource it comes from (IDTrack's data sources) and the Ensembl form it is attached to (the api).
 *  The names IDTrack does not describe are named together once, never explained by the page. */
function DatabaseMeanings({ matrix, organism }: { matrix: DatabaseMatrixData; organism: string }) {
  const graph = { symbolDatabases: matrix.symbol_databases, commonName: commonName(organism) };
  const rows = matrix.databases.map((r) => ({ row: r, d: describeDatabase(r.name, graph) }));
  const said = rows.filter(({ d }) => d.meaning !== null || d.symbols !== null);
  const unsaid = rows.filter(({ d }) => d.meaning === null && d.symbols === null);
  return (
    <Expandable summary="What each database name holds" meta={`${rows.length} names`}>
      <p className="small muted db-meanings__lead">
        In IDTrack&apos;s words (<a href={DATABASE_MEANINGS_SOURCE}>The names a graph lists</a>; {said.length} of{" "}
        {rows.length} names described there), for this graph: its name authority is{" "}
        {matrix.symbol_databases[0] ? <span className="mono">{matrix.symbol_databases[0]}</span> : "not named"}
        {matrix.symbol_databases.length > 1 ? (
          <>
            , then <span className="mono">{matrix.symbol_databases.slice(1).join(", ")}</span> in IDTrack&apos;s order
          </>
        ) : null}
        ; each name&apos;s resource as IDTrack&apos;s <a href={DATA_SOURCES_SOURCE}>data sources</a> describe it.
      </p>
      <dl className="db-meanings">
        {said.map(({ row, d }) => (
          <div key={row.name} className="db-meanings__row">
            <dt className="mono">{databaseLabel(row.name)}</dt>
            <dd>
              <DatabaseHolds d={d} />
              <DatabaseFrom d={d} form={row.form} />
            </dd>
          </div>
        ))}
      </dl>
      {unsaid.length ? (
        <p className="db-meanings__unsaid small">
          IDTrack&apos;s page of databases does not describe{" "}
          {unsaid.length === 1 ? "one name of this graph" : `${unsaid.length} names of this graph`}; the page names them
          without a meaning of its own:{" "}
          {unsaid.map(({ row, d }, i) => (
            <span key={row.name}>
              {i ? "; " : ""}
              <span className="mono">{databaseLabel(row.name)}</span>
              {d.source || row.form ? (
                <span className="muted">
                  {" "}
                  (
                  {[
                    d.source ? d.source.resources.map((r) => r.name).join(" and ") : null,
                    row.form ? formWords(row.form) : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  )
                </span>
              ) : null}
            </span>
          ))}
          .
        </p>
      ) : null}
    </Expandable>
  );
}

const formWords = (form: string) => (form === "gene" ? "attached to the gene" : `attached to the gene's ${form}s`);

function DatabaseFrom({ d, form }: { d: DatabaseDescription; form: string | null | undefined }) {
  return (
    <span className="db-meanings__from">
      {d.source ? (
        <>
          {d.source.resources.map((r, i, all) => (
            <span key={r.name}>
              {i ? (i === all.length - 1 ? " and " : ", ") : ""}
              {r.url ? <a href={r.url}>{r.name}</a> : r.name}
            </span>
          ))}
          : {d.source.description}.{" "}
        </>
      ) : null}
      {form ? `${capitalized(formWords(form))}.` : null}
    </span>
  );
}

function DatabaseHolds({ d }: { d: DatabaseDescription }) {
  const symbols = d.symbols;
  if (symbols?.role === "projected")
    return (
      <span className="db-meanings__holds">
        {capitalized(symbols.phrase)} (<a href={DATABASE_FILING_SOURCE}>IDTrack&apos;s words</a>); this organism&apos;s
        name authority is <span className="mono">{symbols.authority}</span>.
      </span>
    );
  if (symbols?.role === "other")
    return (
      <span className="db-meanings__holds">
        The symbol of {symbols.of ? `the ${symbols.of} name authority` : "another organism's name authority"}, as
        Ensembl attaches it to this organism&apos;s genes; not this organism&apos;s name authority
        {symbols.authority ? (
          <>
            {" "}
            (<span className="mono">{symbols.authority}</span> is)
          </>
        ) : null}
        .
      </span>
    );
  if (!d.meaning) return null;
  return (
    <span className="db-meanings__holds">
      <Prose text={d.meaning.holds} />
      {symbols?.role === "authority" ? null : d.meaning.note ? (
        <span className="muted"> ({d.meaning.note})</span>
      ) : null}
      {d.meaning.described !== d.name ? (
        <span className="muted">
          {" "}
          (as <span className="mono">{d.meaning.described}</span>, of which it is a kind)
        </span>
      ) : null}
      .
    </span>
  );
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A release the address names, read as the graph's: a release of the graph, or what is wrong with it (not a whole
 *  number; a whole number the graph does not hold); null where the address names none. */
function askedRelease(text: string | null, d: GraphDescription) {
  if (text === null || text === "") return null;
  const n = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isInteger(n)) return { text, release: null, problem: "number" as const };
  if (!d.releases.includes(n)) return { text, release: null, problem: "graph" as const };
  return { text, release: n, problem: null };
}

/** The History tab: the lineage field (every id a line) or the counts per release, one at a time; an address that
 *  names a release (`?release=`) opens on the counts, focused there, and one that names an id (`?id=`) on the field,
 *  the id lifted. A release the graph does not hold is said, as Convert says it, and nothing is focused. */
function HistoryTab({ description: d }: { description: GraphDescription }) {
  const search = useLocation().search;
  const asked = askedRelease(search.get("release"), d);
  const id = search.get("id");
  const [view, setView] = useState<"lineages" | "counts">(asked && !id ? "counts" : "lineages");
  const first = d.releases[0];
  const last = d.releases[d.releases.length - 1];
  return (
    <div className="history-tab" id="history">
      {asked?.problem ? (
        <div className="notice notice--danger" role="alert">
          <h3 className="notice__title">
            {asked.problem === "number" ? "Not a release" : "Not a release of this graph"}: {asked.text}
          </h3>
          <p>
            {asked.problem === "number" ? "A release is a whole number; the " : "The "}
            <em>{organismName(d.organism)}</em> graph holds releases <Mono>{first}</Mono> to <Mono>{last}</Mono>.
          </p>
          <div className="notice__actions">
            <Button
              onClick={() => {
                const next = new URLSearchParams(window.location.search);
                next.delete("release");
                const text = next.toString();
                navigate(`${window.location.pathname}${text ? `?${text}` : ""}#history`, { replace: true });
              }}
            >
              Show every release
            </Button>
          </div>
        </div>
      ) : null}
      <Segmented
        className="history-tab__views"
        label="How the history is drawn"
        value={view}
        onChange={setView}
        options={[
          { value: "lineages", label: "Every id, a line" },
          { value: "counts", label: "Counts per release" },
        ]}
      />
      {/* The field stays drawn while the counts are shown, so that coming back to it is a paint. */}
      <div hidden={view !== "lineages"}>
        <ErrorBoundary part="The lineage field" resetKey={d.organism}>
          <LineageField description={d} id={id} release={asked?.release ?? null} />
        </ErrorBoundary>
      </div>
      {view === "counts" ? <HistoryCounts description={d} focusRelease={asked?.release ?? null} /> : null}
    </div>
  );
}

function HistoryCounts({
  description: d,
  focusRelease,
}: {
  description: GraphDescription;
  focusRelease: number | null;
}) {
  const answer = useHistory(d.organism);
  const showcase = useRequest(`showcase|${d.organism}`, (signal) => api.showcase(d.organism, { signal }));
  const marks = useMemo(() => (showcase.state === "done" ? caseMarks(showcase.answer.data.cases) : []), [showcase]);
  const data: HistoryResponse | null = answer.state === "done" ? answer.answer.data : null;
  const top = data ? tallest(historyColumns(data), d.serving_assembly) : [];
  const fan = data ? largestFan(historyColumns(data)) : null;
  return (
    <section className="explore-panel" aria-labelledby="history-counts" aria-busy={answer.state === "loading"}>
      <PanelHead
        id="history-counts"
        level={3}
        title="Ensembl's id history, release by release"
        source={`/api/v1/organisms/${d.organism}/history`}
      />
      {data ? (
        <IdHistory
          history={data}
          description={d}
          marks={marks}
          organism={d.organism}
          focusRelease={focusRelease}
          label={`Ensembl's id history of the ${organismName(d.organism)} graph, release by release. Arrow keys move between the releases; Enter opens a conversion through the release.`}
        />
      ) : answer.state === "failed" ? (
        <p className="muted">
          The history could not be read: {failureWords(answer.error)}. <Button onClick={answer.retry}>Try again</Button>
        </p>
      ) : (
        <Skeleton height={historyHeight(false)} />
      )}
      <HistoryLegend
        marks={marks.some((m) => m.release !== null)}
        fans={data ? fansCounted(historyColumns(data)) : true}
      />
      <p className="fig-caption">
        <CaptionMore
          lead={
            <>
              What Ensembl&apos;s stable id history of genes did at each release of the graph, as the server counted it
              when it started.
            </>
          }
        >
          Counted in {data ? <Mono>{String(data.compute_seconds)}</Mono> : "some"} seconds. From the top: the gene ids
          with a version active at the release (every assembly and region the graph holds); the history edges that end
          at the release and change or retire an id (a version followed by another version of its id, by a version of
          another id, or an id retired); below that axis, the ids created there (those of the first release are where
          the graph begins and are not drawn); the fan of Ensembl&apos;s mapping, the gene versions it maps to two or
          more (a split, above its line) and those that two or more are mapped to (a merge, below); and the edges that
          keep an id and its version with Ensembl&apos;s score (a re-mapping to itself). Each part has its own linear
          scale, from 0 to the value written at its left.
          {top.length ? (
            <>
              {" "}
              The tallest columns of changed or retired ids:{" "}
              {top.map((t, i) => (
                <span key={t.release}>
                  {i ? ", " : ""}
                  <Mono>{t.release}</Mono> (<Mono>{groupedInteger(t.changed)}</Mono>
                  {t.newAssembly ? ", the first release of a new assembly" : ""})
                </span>
              ))}
              {top.every((t) => t.newAssembly)
                ? "."
                : `; ${top
                    .filter((t) => !t.newAssembly)
                    .map((t) => t.release)
                    .join(
                      ", ",
                    )} ${top.filter((t) => !t.newAssembly).length === 1 ? "is a release" : "are releases"} within one assembly.`}
            </>
          ) : null}
          {fan ? (
            <>
              {" "}
              The largest fan is at release <Mono>{fan.release}</Mono>: <Mono>{groupedInteger(fan.fanOut ?? 0)}</Mono>{" "}
              versions mapped to two or more, <Mono>{groupedInteger(fan.fanIn ?? 0)}</Mono> two or more mapped to one.
            </>
          ) : null}{" "}
          These are plain facts of Ensembl&apos;s records, counted from the ends of its edges, not IDTrack&apos;s
          reading of them: a conversion&apos;s path names its own steps a split or a merge by IDTrack&apos;s rules.
          Focus the figure and use the arrow keys for each release&apos;s exact counts, the pairs of releases its edges
          join and the conversions of this server through it.
        </CaptionMore>
      </p>
      {marks.length ? (
        <Expandable summary="Conversions of this server through this history" meta={`${marks.length}`}>
          <ol className="idh-cases">
            {marks.map((m) => (
              <li key={m.number}>
                <span className="idh-cases__n mono" aria-hidden="true">
                  {m.number}
                </span>
                <span className="idh-cases__body">
                  <Link to={caseHref(caseQueryOf(d.organism, m.case.query))} className="idh-cases__id">
                    <Mono>{m.case.query.identifier}</Mono>
                  </Link>
                  <span className="idh-cases__what">
                    {kindWords(m.case.kind)}
                    {m.release !== null ? `, at release ${m.release}` : ""}
                    {m.case.result
                      ? m.case.result.from_release === null
                        ? `; converted to ${m.case.result.to_release}`
                        : `; read at ${m.case.result.from_release}, converted to ${m.case.result.to_release}`
                      : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Expandable>
      ) : null}
    </section>
  );
}

/** The version a graph file records, in words: IDTrack writes a statement in its place for a graph built from a
 *  source folder ("none: built from a source folder, not an installed idtrack"), which is said as such. */
function VersionWords({ text }: { text: string }) {
  const statement = /^none:\s*(.+)$/.exec(text);
  if (statement)
    return (
      <>
        no released version recorded: {statement[1]} <span className="muted">(as the file states it)</span>
      </>
    );
  return (
    <>
      version <Mono>{text}</Mono>
    </>
  );
}

function OrganismDetail({
  description: d,
  file,
  others,
}: {
  description: GraphDescription;
  file: GraphVersion | null;
  others: GraphDescription[];
}) {
  const primary = d.assemblies.find((a) => a.assembly === d.primary_assembly);
  const handoffs = handoffsOf(d);
  // An address that names a release of the history (`?release=`) opens on the History tab.
  const location = useLocation();
  const initial =
    (location.search.get("release") || location.search.get("id")) && !location.search.get("tab")
      ? "history"
      : undefined;
  return (
    <div className="page page--organism">
      <header className="page-head">
        <h1>
          <em>{organismName(d.organism)}</em>, release by release
        </h1>
        <p className="lede">
          Its assemblies on Ensembl&apos;s releases, its build and the history of its ids, up to{" "}
          {primary?.name ?? <Mono>{d.primary_assembly}</Mono>};{" "}
          <Link to={href("/convert", { organism: d.organism })}>convert an identifier of this graph</Link>.
        </p>
        {others.length > 1 ? (
          <nav className="organism-switch" aria-label="Other graphs">
            {others.map((o) =>
              o.organism === d.organism ? (
                <span key={o.organism} className="organism-switch__item organism-switch__item--on" aria-current="page">
                  {chipName(o.organism)}
                </span>
              ) : (
                <Link key={o.organism} to={href(`/organisms/${o.organism}`)} className="organism-switch__item">
                  {chipName(o.organism)}
                </Link>
              ),
            )}
          </nav>
        ) : null}
      </header>

      <section className="explore-panel organism-figure" aria-labelledby="releases">
        <PanelHead id="releases" title="Releases and assemblies" source={`/api/v1/organisms/${d.organism}`} />
        <OrganismAssemblies description={d} assemblies={chronological(d.assemblies)} handoffs={handoffs} />
        <p className="fig-caption">
          <CaptionMore
            lead={
              <>
                Each assembly on the releases: the rule where it serves, the hairline where the graph holds data of it;
                a press opens it.
              </>
            }
          >
            The assemblies stand in the order they serve releases; the assembly that serves a release is the one whose
            annotation counts there. Each is named by Ensembl&apos;s name; its row opens its key in IDTrack&apos;s
            organism table, the releases it serves and holds, the change from the assembly before it and its external
            databases. A diamond marks a change of assembly: filled where Ensembl publishes a mapping of the two
            assemblies, through which IDTrack compares the places of genes across the change; open where it publishes
            none. An identifier exists at a release only on the assembly that serves it; an identifier of an earlier
            assembly converts to the gene of the assembly that serves the target release, through Ensembl&apos;s history
            across the assembly change (
            <a href={docsPage("concepts.html#concept-releases-assemblies")}>IDTrack&apos;s documentation</a>). Where
            Ensembl&apos;s history ends, a bridge between two genes compares their places across a change only where
            Ensembl publishes a mapping of the two assemblies; in IDTrack&apos;s words:{" "}
            <Prose text={docs.assemblyMapping.lead} />{" "}
            <a href={docs.assemblyMapping.source}>{docs.assemblyMapping.title}</a>
          </CaptionMore>
        </p>
      </section>

      <Tabs
        label={`The ${organismName(d.organism)} graph in detail`}
        param="tab"
        {...(initial ? { initial } : {})}
        className="organism-tabs"
        items={[
          {
            id: "composition",
            label: "Composition",
            panel: () => (
              <section className="explore-panel" aria-labelledby="composition">
                <PanelHead
                  id="composition"
                  level={3}
                  title="Composition of the graph"
                  source={`/api/v1/organisms/${d.organism}`}
                />
                <CountsFigure counts={d.counts} />
                <p className="fig-caption">
                  <CaptionMore
                    lead={
                      <>
                        The counts of the build, as the graph file records them, largest first, each on a logarithmic
                        axis beside its exact value.
                      </>
                    }
                  >
                    The counts are <span className="mono">counts</span> of the file, by IDTrack&apos;s names. Under each
                    name, what IDTrack says the counted things are: its page of concepts for the nodes and the two kinds
                    of edge (<a href={docs.counts.concepts}>The graph</a>), the description its code gives of the part
                    of the graph of the same name for the others (
                    <a href={docs.counts.source}>where the build counts them</a>
                    ); a count it says no more of is said to be named only.
                  </CaptionMore>
                </p>
              </section>
            ),
          },
          { id: "build", label: "Build", panel: () => <BuildPanel description={d} file={file} /> },
          { id: "databases", label: "Databases by release", panel: () => <MatrixPanel description={d} /> },
          { id: "history", label: "History", keep: true, panel: () => <HistoryTab description={d} /> },
        ]}
      />
    </div>
  );
}

/** The record of the graph and its build: what the file records of itself and what the server checked. */
function BuildPanel({ description: d, file }: { description: GraphDescription; file: GraphVersion | null }) {
  return (
    <section className="explore-panel" aria-labelledby="build">
      <PanelHead id="build" level={3} title="The graph and its build" source="/api/v1/version" />
      <dl className="readouts">
        <Readout label="Content digest" wide>
          {d.content_digest ? (
            <HoverCard
              hover={false}
              className="digest"
              triggerClassName="digest__short mono"
              label={`Content digest ${d.content_digest.slice(0, 12)}…: the whole digest`}
              trigger={<>{d.content_digest.slice(0, 12)}…</>}
            >
              <p className="digest__whole">
                <Mono>{d.content_digest}</Mono>
              </p>
              <CopyButton text={d.content_digest} what="content digest" />
            </HoverCard>
          ) : (
            <Absent meaning="Not recorded in the graph file" />
          )}
        </Readout>
        <Readout label="Built">
          {d.build_date ? <Mono>{d.build_date}</Mono> : <Absent meaning="Not recorded in the graph file" />}
        </Readout>
        <Readout label="Built by IDTrack" wide>
          {d.package_commit ? (
            <>
              commit <Mono>{d.package_commit}</Mono>
            </>
          ) : (
            <span className="muted">commit not recorded</span>
          )}
          {d.package_version ? (
            <span className="readout__sub">
              <VersionWords text={d.package_version} />
            </span>
          ) : null}
        </Readout>
        <Readout label="Measured by the benchmarks" wide>
          <BenchmarkProvenance organism={d.organism} digest={d.content_digest} />
        </Readout>
        {measuredGraph(d.organism, d.content_digest) ? (
          <Readout label="Rebuilt from public code" wide>
            The benchmarks rebuilt a graph of this content digest with IDTrack&apos;s own builder at its{" "}
            {BENCHMARKS_META.tree.name} <Mono>{BENCHMARKS_META.tree.commit}</Mono>, whose answers are those of its
            release {BENCHMARKS_META.tree.answers.release} (<Mono>{BENCHMARKS_META.tree.answers.commit}</Mono>); their
            record is published by{" "}
            <a href={`${BENCHMARKS_META.repository}/tree/${BENCHMARKS_META.commit}`}>idtrack-reproducibility</a>.
          </Readout>
        ) : null}
        <Readout label="Check a graph file of yours" wide>
          <span className="cli">
            <code>idtrack verify &lt;graph file&gt;</code>
          </span>{" "}
          recomputes the content digest from the file&apos;s content and compares it with the one the file records; this
          graph&apos;s is the digest above (IDTrack&apos;s command line,{" "}
          <a href={docsPage("cli.html")}>its documentation</a>).
        </Readout>
        <Readout label="File format">
          {d.format_version === null ? (
            <Absent meaning="A graph made in memory, not read from a file" />
          ) : (
            <Mono>{d.format_version}</Mono>
          )}
        </Readout>
        <Readout label="Ensembl forms">{d.forms.join(", ")}</Readout>
        {file ? (
          <>
            <Readout label="File" wide>
              <Mono>{file.file.key}</Mono>
            </Readout>
            <Readout label="SHA-256, verified at start" wide>
              <Mono>{file.file.sha256}</Mono> <CopyButton text={file.file.sha256} what="SHA-256" />
            </Readout>
            <Readout label="Size">
              <Mono>{groupedInteger(file.file.size)}</Mono> bytes{" "}
              <span className="muted">({byteSize(file.file.size)})</span>
            </Readout>
          </>
        ) : null}
      </dl>
      <p className="fig-caption">
        <CaptionMore
          lead={
            <>
              What the graph file records of itself and what the server checked when it loaded it; the content digest
              names the graph: two files of the same digest answer alike.
            </>
          }
        >
          From <span className="mono">/api/v1/organisms/{d.organism}</span> and{" "}
          <span className="mono">/api/v1/version</span>: the digest of the graph&apos;s content, the IDTrack that built
          it (its commit, and the version as the file records it), and the file&apos;s SHA-256, verified at start; and
          whether the benchmarks measured a graph of the same content digest (their published results at{" "}
          <Mono>{BENCHMARKS_META.commit.slice(0, 12)}</Mono>).
        </CaptionMore>
      </p>
    </section>
  );
}
