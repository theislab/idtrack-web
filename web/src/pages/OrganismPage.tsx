// Explore what the server's graphs hold: the graphs side by side (their releases and assemblies on one axis, with each
// assembly change and whether Ensembl maps it; Ensembl's id history of each graph, release by release; the counts of
// their builds), and each graph on its own page: its assemblies, its id history, the composition of its build, what a
// conversion to each release can end in (and what each database name holds), and the record of its build and file,
// with whether the benchmarks measured this very graph. Every value is the api's, idtrack's documentation's or the
// benchmarks' published results'.
import { docsPage } from "../lib/links";
import { useEffect, useId, useMemo, useState } from "react";
import { api, ApiError, TimeoutError, UnreachableError, type AnyRequestError } from "../api/client";
import type { AssemblyDescription, GraphDescription, GraphVersion, HistoryResponse } from "../api/types";
import { AssemblyRows } from "../components/explore/AssemblyRows";
import { IdHistory } from "../components/explore/IdHistory";
import { BenchmarkProvenance } from "../components/method/BenchmarkProvenance";
import { ExploreStories, StoriesOrganism } from "../components/explore/Stories";
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
import {
  Absent,
  Button,
  CopyButton,
  Disclosure,
  Link,
  Mono,
  Prose,
  Readout,
  Skeleton,
  TableFrame,
} from "../components/ui";
import docs from "../generated/idtrack_docs.json";
import { BENCHMARKS_META } from "../lib/benchmarksMeta";
import {
  DATA_SOURCES_SOURCE,
  DATABASE_FILING_SOURCE,
  DATABASE_MEANINGS_SOURCE,
  describeDatabase,
  type DatabaseDescription,
} from "../lib/databaseMeanings";
import { databaseLabel } from "../lib/databases";
import { handoffsOf, MAPPING_WORDS } from "../lib/explore/handoffs";
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

/** Assemblies in the order they serve releases (the earliest first). */
function chronological(assemblies: readonly AssemblyDescription[]): AssemblyDescription[] {
  const start = (a: AssemblyDescription) => Math.min(...(a.serves.length ? a.serves : a.releases));
  return [...assemblies].sort((a, b) => start(a) - start(b));
}

function PanelHead({ letter, id, title, source }: { letter: string; id: string; title: string; source?: string }) {
  return (
    <div className="explore-head">
      <span className="panel-letter" aria-hidden="true">
        {letter}
      </span>
      <h2 id={id}>{title}</h2>
      {source ? (
        <p className="explore-head__source">
          <span className="mono">GET {source}</span>
        </p>
      ) : null}
    </div>
  );
}

function AssemblyLegend({ held = true, handoffs = false }: { held?: boolean; handoffs?: boolean }) {
  return (
    <ul className="fig-legend" aria-label="Legend">
      <li>
        <svg width="30" height="14" aria-hidden="true">
          <rect x="1" y="2" width="28" height="10" rx="2.5" className="arows__serve" />
        </svg>
        Releases the assembly serves (its annotation counts there)
      </li>
      {held ? (
        <li>
          <svg width="30" height="14" aria-hidden="true">
            <line x1="1" x2="29" y1="7" y2="7" className="arows__held" />
          </svg>
          Releases at which the graph holds data of it
        </li>
      ) : null}
      {handoffs ? (
        <>
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
        </>
      ) : null}
    </ul>
  );
}

/** An assembly's external databases: a few at display size, whole names, the rest on request. */
function DatabaseChips({ names, shown = 6 }: { names: readonly string[]; shown?: number }) {
  const labels = names.map(databaseLabel);
  const chips = (list: string[]) => (
    <ul className="db-chips">
      {list.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
  if (labels.length <= shown + 1) return chips(labels);
  return (
    <>
      {chips(labels.slice(0, shown))}
      <div className="db-more">
        <Disclosure summary={`and ${labels.length - shown} more`}>{chips(labels.slice(shown))}</Disclosure>
      </div>
    </>
  );
}

/** A graph's history from the server, or null where the server does not count it (an api without the endpoint). */
function useHistory(organism: string) {
  const answer = useRequest(`history|${organism}`, (signal) => api.history(organism, { signal }));
  const absent = answer.state === "failed" && answer.error instanceof ApiError && answer.error.status === 404;
  return { answer, absent };
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
  const { answer, absent } = useHistory(graph.organism);
  if (absent) return null;
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
  { value: false, words: "Counts", note: "each graph on its own scale" },
  { value: true, words: "Share of the gene ids active", note: "every graph on one axis, 0 to 100 %" },
];

function HistoryIndexPanel({ organisms, releases }: { organisms: GraphDescription[]; releases: number[] }) {
  const first = organisms[0]?.organism ?? "";
  const { absent } = useHistory(first);
  const [share, setShare] = useState(false);
  const { ref, width } = useWidth<HTMLDivElement>(900);
  if (!organisms.length || absent) return null;
  const scale = releaseScale(releases, 4, width - 8);
  return (
    <section className="panel explore-panel" aria-labelledby="graphs-history">
      <PanelHead
        letter="b"
        id="graphs-history"
        title="Ensembl's id history, release by release"
        source="/api/v1/organisms/{organism}/history"
      />
      <div className="idh-mode" role="radiogroup" aria-label="How the columns are measured">
        {MODES.map(({ value, words, note }) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={share === value}
            className={`idh-mode__item${share === value ? " idh-mode__item--on" : ""}`}
            onClick={() => {
              setShare(value);
            }}
          >
            {words} <span className="idh-mode__note">{note}</span>
          </button>
        ))}
      </div>
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
        <strong>b</strong> For each graph, on the axis of panel a (drawn once, under the rows), what Ensembl&apos;s
        stable id history of genes did at each release, as the server counted it from the graph when it started: above
        the line, the history edges that end at the release and change or retire an id (a version followed by another
        version of its id, by a version of another id, or an id retired); below it, the ids created there; under them,
        the fan of Ensembl&apos;s mapping: the gene versions it maps to two or more (a split, upward) and those that two
        or more are mapped to (a merge, downward).{" "}
        {share
          ? "As shares: what changed into a release over the gene ids active at the release before it, and the ids created over those active at the release, every graph on one axis from 0 to 100 % (the splits and merges on 0 to 10 %)."
          : "As counts: each row has its own scale, its largest values written at the left."}{" "}
        The edges that keep an id and its version (a re-mapping to itself) are counted in each release&apos;s note and
        drawn on each graph&apos;s page. The ids of a graph&apos;s first release are where the graph begins and are not
        drawn. The tallest columns are not all changes of assembly: each graph&apos;s page names its tallest and says
        which are. Focus a row and use the arrow keys for each release&apos;s exact counts.
      </p>
    </section>
  );
}

export function OrganismsIndex() {
  const { organisms } = useOrganisms();
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
    <div className="page page--explore">
      <header className="page-head">
        <p className="eyebrow">Explore</p>
        <h1>Stories from Ensembl&apos;s history</h1>
        <p className="lede">
          What can happen to a gene id, told by real identifiers this server answered; then every graph it holds, side
          by side, release by release. A conversion stays within one organism.
        </p>
        <StoriesOrganism />
      </header>

      <ExploreStories />

      <section className="explore-graphs" aria-labelledby="graphs">
        <div className="explore-graphs__head">
          <h2 id="graphs">The graphs this server holds</h2>
          <p className="explore-graphs__lede">
            Each organism is one graph of Ensembl&apos;s releases, built by idtrack from Ensembl&apos;s own tables and
            verified by its checksum when the server started; idtrack does not map identifiers between species. Each
            graph&apos;s page draws its assemblies, its id history, the composition of its build and the databases a
            conversion to each release can end in.
          </p>
        </div>
        <FactsStrip organisms={organisms} letter={null} level={3} heading={false} />
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
        <AssemblyLegend held={false} handoffs />
        <p className="fig-caption">
          <strong>a</strong> Every graph of this server on one axis of Ensembl releases ({releaseRanges(releases)}). In
          each row, the assemblies of the organism in the order they serve releases, each a bar over the releases it
          serves (the assembly whose annotation counts at the release). An earlier assembly can be held beside the one
          that serves, so that its identifiers convert from it: each graph&apos;s page draws the releases at which it
          holds data of each assembly. A diamond marks each change of assembly: filled where Ensembl publishes a mapping
          of the two assemblies, through which idtrack compares the places of genes across the change; open where it
          publishes none, and genes across the change are told apart only by the names of their chromosomes, as
          idtrack&apos;s documentation states (<a href={docs.assemblyMapping.source}>{docs.assemblyMapping.title}</a>).
          Focus the figure and use the arrow keys for each assembly&apos;s exact releases and databases.
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
          <strong>c</strong> The counts each graph file records of its build (<span className="mono">counts</span>, by
          idtrack&apos;s names: <span className="mono">nodes</span>, <span className="mono">history_edges</span>,{" "}
          <span className="mono">cross_reference_edges</span>), the number of its assemblies and of its external
          databases. Each bar is the value&apos;s share of the largest in its column (a linear scale from zero).
        </p>
      </section>
    </div>
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
        <p className="eyebrow">
          <Link to="/organisms" className="eyebrow__link">
            Explore
          </Link>{" "}
          · not found
        </p>
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
    </div>
  );
}

function MatrixPanel({ description: d }: { description: GraphDescription }) {
  const matrix = useRequest(`matrix|${d.organism}`, (signal) => loadDatabaseMatrix(d.organism, signal));
  const rows = matrix.state === "done" ? matrix.answer.data.databases.length : d.final_databases.length + 4;
  return (
    <section className="panel explore-panel" aria-labelledby="matrix" aria-busy={matrix.state === "loading"}>
      <PanelHead
        letter="d"
        id="matrix"
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
        <strong>d</strong> For each release of the graph (columns), the databases a conversion to that release can end
        in (rows; <span className="mono">final_database</span> takes these names), as idtrack&apos;s{" "}
        <span className="mono">API.final_databases(to_release)</span> gives them: the external databases of the assembly
        that serves the release, and Ensembl&apos;s own gene ids with and without version; the external databases of
        each assembly are listed in panel a. The rows a conversion can end in at some releases only come first, by their
        first release, above a rule; those of every release after it. Focus the matrix and use the arrow keys for each
        cell. Below, what each name holds, in idtrack&apos;s words.
      </p>
      {matrix.state === "done" ? <DatabaseMeanings matrix={matrix.answer.data} organism={d.organism} /> : null}
    </section>
  );
}

/** What each database name of the graph holds, for this organism: idtrack's words for the name (its page of external
 *  databases), the resource it comes from (idtrack's data sources) and the Ensembl form it is attached to (the api).
 *  The names idtrack does not describe are named together once, never explained by the page. */
function DatabaseMeanings({ matrix, organism }: { matrix: DatabaseMatrixData; organism: string }) {
  const graph = { symbolDatabases: matrix.symbol_databases, commonName: commonName(organism) };
  const rows = matrix.databases.map((r) => ({ row: r, d: describeDatabase(r.name, graph) }));
  const said = rows.filter(({ d }) => d.meaning !== null || d.symbols !== null);
  const unsaid = rows.filter(({ d }) => d.meaning === null && d.symbols === null);
  return (
    <Disclosure summary={`What each of the ${rows.length} database names holds`}>
      <p className="small muted db-meanings__lead">
        In idtrack&apos;s words (<a href={DATABASE_MEANINGS_SOURCE}>The names a graph lists</a>; {said.length} of{" "}
        {rows.length} names described there), for this graph: its name authority is{" "}
        {matrix.symbol_databases[0] ? <span className="mono">{matrix.symbol_databases[0]}</span> : "not named"}
        {matrix.symbol_databases.length > 1 ? (
          <>
            , then <span className="mono">{matrix.symbol_databases.slice(1).join(", ")}</span> in idtrack&apos;s order
          </>
        ) : null}
        ; each name&apos;s resource as idtrack&apos;s <a href={DATA_SOURCES_SOURCE}>data sources</a> describe it.
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
          idtrack&apos;s page of databases does not describe{" "}
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
    </Disclosure>
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
        {capitalized(symbols.phrase)} (<a href={DATABASE_FILING_SOURCE}>idtrack&apos;s words</a>); this organism&apos;s
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

function HistoryPanel({ description: d }: { description: GraphDescription }) {
  const { answer, absent } = useHistory(d.organism);
  // `?release=76`: a link that names a release of this history (the hero's notes of a release-wide event) shows it.
  const asked = Number(useLocation().search.get("release") ?? "");
  const focusRelease = Number.isInteger(asked) && d.releases.includes(asked) ? asked : null;
  const showcase = useRequest(`showcase|${d.organism}`, (signal) => api.showcase(d.organism, { signal }));
  const marks = useMemo(() => (showcase.state === "done" ? caseMarks(showcase.answer.data.cases) : []), [showcase]);
  if (absent) return null;
  const data: HistoryResponse | null = answer.state === "done" ? answer.answer.data : null;
  const top = data ? tallest(historyColumns(data), d.serving_assembly) : [];
  const fan = data ? largestFan(historyColumns(data)) : null;
  return (
    <section className="panel explore-panel" aria-labelledby="history" aria-busy={answer.state === "loading"}>
      <PanelHead
        letter="b"
        id="history"
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
        <strong>b</strong> What Ensembl&apos;s stable id history of genes did at each release of the graph, as the
        server counted it from the graph when it started (in{" "}
        {data ? <Mono>{String(data.compute_seconds)}</Mono> : "some"} seconds). From the top: the gene ids with a
        version active at the release (every assembly and region the graph holds); the history edges that end at the
        release and change or retire an id (a version followed by another version of its id, by a version of another id,
        or an id retired); below that axis, the ids created there (those of the first release are where the graph begins
        and are not drawn); the fan of Ensembl&apos;s mapping, the gene versions it maps to two or more (a split, above
        its line) and those that two or more are mapped to (a merge, below); and the edges that keep an id and its
        version with Ensembl&apos;s score (a re-mapping to itself). Each part has its own linear scale, from 0 to the
        value written at its left.
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
        These are plain facts of Ensembl&apos;s records, counted from the ends of its edges, not idtrack&apos;s reading
        of them: a conversion&apos;s path names its own steps a split or a merge by idtrack&apos;s rules. Focus the
        figure and use the arrow keys for each release&apos;s exact counts, the pairs of releases its edges join and the
        conversions of this server through it.
      </p>
      {marks.length ? (
        <>
          <h3 className="method-sub">Conversions of this server through this history</h3>
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
        </>
      ) : null}
    </section>
  );
}

/** The version a graph file records, in words: idtrack writes a statement in its place for a graph built from a
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
  const first = d.releases[0] ?? 0;
  const last = d.releases[d.releases.length - 1] ?? 0;
  const primary = d.assemblies.find((a) => a.assembly === d.primary_assembly);
  const handoffs = handoffsOf(d);
  return (
    <div className="page page--organism">
      <header className="page-head">
        <p className="eyebrow">
          <Link to="/organisms" className="eyebrow__link">
            Explore
          </Link>{" "}
          · {commonName(d.organism) ? `the ${commonName(d.organism) ?? ""} graph` : "a graph"}
        </p>
        <h1>
          <em>{organismName(d.organism)}</em>, release by release
        </h1>
        <p className="lede">
          Ensembl releases <Mono>{releaseRanges(d.releases)}</Mono> over {d.assemblies.length} assemblies, up to the
          snapshot <Mono>{d.snapshot_release}</Mono> on {primary?.name ?? <Mono>{d.primary_assembly}</Mono>}: their id
          history, what the graph holds, and what a conversion to each release can end in.{" "}
          <Link to={href("/", { organism: d.organism })}>Convert an identifier of this graph</Link>.
        </p>
        {others.length > 1 ? (
          <nav className="organism-switch" aria-label="Other graphs">
            {others.map((o) =>
              o.organism === d.organism ? (
                <span key={o.organism} className="organism-switch__item organism-switch__item--on" aria-current="page">
                  {commonName(o.organism) ?? organismName(o.organism)}
                </span>
              ) : (
                <Link key={o.organism} to={href(`/organisms/${o.organism}`)} className="organism-switch__item">
                  {commonName(o.organism) ?? organismName(o.organism)}
                </Link>
              ),
            )}
          </nav>
        ) : null}
      </header>

      <section className="panel explore-panel" aria-labelledby="releases">
        <PanelHead
          letter="a"
          id="releases"
          title="Releases and assemblies"
          source={`/api/v1/organisms/${d.organism}`}
        />
        <AssemblyRows
          label={`The assemblies of the ${organismName(d.organism)} graph over releases ${first} to ${last}. Arrow keys move between them.`}
          first={first}
          last={last}
          rows={chronological(d.assemblies).map((a) => ({
            key: String(a.assembly),
            primary: d.primary_assembly,
            assemblies: [a],
            label: (
              <span className="arows__assembly">
                {a.name ?? <Mono>{a.assembly}</Mono>}
                <span className="arows__common mono">{a.assembly}</span>
              </span>
            ),
          }))}
        />
        <AssemblyLegend />
        <TableFrame label="Assemblies" className="table-frame--cards">
          <table className="table table--cards">
            <thead>
              <tr>
                <th scope="col">Assembly</th>
                <th scope="col">Key</th>
                <th scope="col">Serves releases</th>
                <th scope="col">Holds data at</th>
                <th scope="col">From the assembly before</th>
                <th scope="col">External databases</th>
              </tr>
            </thead>
            <tbody>
              {d.assemblies.map((a) => (
                <tr key={a.assembly}>
                  <td data-label="Assembly">
                    <strong>{a.name ?? <Absent meaning="The graph names no assembly here" />}</strong>
                    {a.assembly === d.primary_assembly ? <span className="tag">primary</span> : null}
                  </td>
                  <td data-label="Key" className="num">
                    <Mono>{a.assembly}</Mono>
                  </td>
                  <td data-label="Serves" className="cell-ranges">
                    {a.serves.length ? (
                      <Mono>{releaseRanges(a.serves)}</Mono>
                    ) : (
                      <Absent meaning="It serves no release" />
                    )}
                  </td>
                  <td data-label="Data at" className="cell-ranges">
                    <Mono>{releaseRanges(a.releases)}</Mono>
                  </td>
                  <td data-label="Change" className="cell-wrap">
                    {(() => {
                      const h = handoffs.find((x) => x.to.assembly === a.assembly);
                      return h ? (
                        <>
                          {h.from.name} at release <Mono>{h.release}</Mono>: {MAPPING_WORDS[h.mapping]}
                        </>
                      ) : (
                        <Absent meaning="It serves the graph's first releases, or no release" />
                      );
                    })()}
                  </td>
                  <td data-label="Databases" className="cell-wrap cell-chips">
                    <DatabaseChips names={a.external_databases} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <p className="fig-caption">
          <strong>a</strong> The assemblies of the graph, in the order they serve releases, by idtrack&apos;s organism
          table (the key) and Ensembl&apos;s name: the solid bar the releases an assembly serves (the assembly whose
          annotation counts at the release), the thin line the releases at which the graph holds data of it. An
          identifier exists at a release only on the assembly that serves it; an identifier of an earlier assembly
          converts to the gene of the assembly that serves the target release, through Ensembl&apos;s history across the
          assembly change (
          <a href={docsPage("concepts.html#concept-releases-assemblies")}>idtrack&apos;s documentation</a>
          ). Where Ensembl&apos;s history ends, a bridge between two genes compares their places across a change only
          where Ensembl publishes a mapping of the two assemblies (the table&apos;s column &quot;From the assembly
          before&quot;); in idtrack&apos;s words: <Prose text={docs.assemblyMapping.lead} />{" "}
          <a href={docs.assemblyMapping.source}>{docs.assemblyMapping.title}</a>
        </p>
      </section>

      <HistoryPanel description={d} />

      <section className="panel explore-panel" aria-labelledby="composition">
        <PanelHead
          letter="c"
          id="composition"
          title="Composition of the graph"
          source={`/api/v1/organisms/${d.organism}`}
        />
        <CountsFigure counts={d.counts} />
        <p className="fig-caption">
          <strong>c</strong> The counts of the build, as the graph file records them (
          <span className="mono">counts</span>
          ), by idtrack&apos;s names, largest first, each as a bar on a logarithmic axis beside its exact value. Under
          each name, what idtrack says the counted things are: its page of concepts for the nodes and the two kinds of
          edge (<a href={docs.counts.concepts}>The graph</a>), the description its code gives of the part of the graph
          of the same name for the others (<a href={docs.counts.source}>where the build counts them</a>); a count it
          says no more of is said to be named only.
        </p>
      </section>

      <MatrixPanel description={d} />

      <section className="panel explore-panel" aria-labelledby="build">
        <PanelHead letter="e" id="build" title="The graph and its build" source="/api/v1/version" />
        <dl className="readouts">
          <Readout label="Content digest" wide>
            {d.content_digest ? <Mono>{d.content_digest}</Mono> : <Absent meaning="Not recorded in the graph file" />}{" "}
            {d.content_digest ? <CopyButton text={d.content_digest} what="content digest" /> : null}
          </Readout>
          <Readout label="Built">
            {d.build_date ? <Mono>{d.build_date}</Mono> : <Absent meaning="Not recorded in the graph file" />}
          </Readout>
          <Readout label="Built by idtrack" wide>
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
          <Readout label="Check a graph file of yours" wide>
            <span className="cli">
              <code>idtrack verify &lt;graph file&gt;</code>
            </span>{" "}
            recomputes the content digest from the file&apos;s content and compares it with the one the file records;
            this graph&apos;s is the digest above (idtrack&apos;s command line,{" "}
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
          <strong>e</strong> What the graph file records of itself (
          <span className="mono">/api/v1/organisms/{d.organism}</span>) and what the server checked when it loaded it (
          <span className="mono">/api/v1/version</span>): the digest of the graph&apos;s content, the idtrack that built
          it (its commit, and the version as the file records it), and the file&apos;s SHA-256, verified at start; and
          whether the benchmarks measured a graph of the same content digest (their published results at{" "}
          <Mono>{BENCHMARKS_META.commit.slice(0, 12)}</Mono>). The content digest names the graph: two files of the same
          digest answer alike.
        </p>
      </section>
    </div>
  );
}
