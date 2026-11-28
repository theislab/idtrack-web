// The answer of a names lookup as a figure. The genes a name names: one group per gene (its id, its versions, what the
// databases call it at the graph's last release), one lane per database on the graph's releases with the assemblies
// that serve them, holding every version, and the exact releases of each version written beside it; the genes paged.
// The names of a gene: one row per attachment, its lane and its exact releases. Pointing at a lane names the first
// and last release of each of its runs on the scale above.
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { GraphDescription, NameMatch } from "../api/types";
import { convertHref, plainConversion } from "../lib/convertParameters";
import { databaseLabel } from "../lib/databases";
import { groupByGene, nameCounts, turnsOf, type GeneGroup, type NameCounts, type NameLane } from "../lib/nameGroups";
import { groupedInteger, releaseRanges } from "../lib/numbers";
import { axisOf, bandsOf, runsOf, type Axis, type AxisBand, type Run } from "./figure/releases";
import { href } from "../lib/router";
import { useRequest } from "../lib/useRequest";
import { statusTitle } from "../lib/vocabulary";
import { BandBackdrop, LaneEnds, RangesText, ReleaseLane, ReleaseScale } from "./ReleaseScale";
import { placeLabels, type PlacedLabel } from "./figure/labels";
import { useWidth } from "./figure/useWidth";
import { Button, Link, Mono, TableFrame, TextInput } from "./ui";
import { CaptionMore } from "./v2/CaptionMore";

/** Genes drawn at first, and how many more each press draws. */
const PAGE = 12;
/** Rows of the names of a gene drawn at first. */
const ROWS = 40;

export function NameMatches({
  matches,
  description,
  address,
  empty,
  first,
  release,
  endpoint,
  asked,
}: {
  matches: NameMatch[];
  description: GraphDescription;
  /** The page's address now: a link keeps the other lookup. */
  address: Record<string, string>;
  empty: ReactNode;
  first: "gene" | "name";
  /** The release asked for, marked on every lane. */
  release: number | null;
  endpoint: string;
  /** What was asked (the name, or the gene), for the sentence above the figure. */
  asked?: string;
}) {
  const axis = useMemo(() => axisOf(description.releases), [description]);
  const bands = useMemo(() => bandsOf(axis, description), [axis, description]);
  const counts = useMemo(() => nameCounts(matches), [matches]);
  const [pointed, setPointed] = useState<Run[] | null>(null);
  if (!matches.length) {
    return (
      <div className="empty empty--small">
        <p>{empty}</p>
      </div>
    );
  }
  const marks =
    release !== null && axis.index.has(release) ? [{ release, label: `${release}`, kind: "target" as const }] : [];
  const scale = <ReleaseScale axis={axis} bands={bands} marks={marks} highlight={pointed ?? []} />;
  return (
    <figure className="names-figure">
      <div className="names-summary">
        <Legend marks={marks.length > 0} />
      </div>
      {first === "gene" ? (
        <GenesNamed
          matches={matches}
          description={description}
          address={address}
          axis={axis}
          bands={bands}
          release={marks.length ? release : null}
          scale={scale}
          setPointed={setPointed}
          asked={asked ?? ""}
          counts={counts}
        />
      ) : (
        <NamesOf
          matches={matches}
          description={description}
          address={address}
          axis={axis}
          bands={bands}
          release={marks.length ? release : null}
          scale={scale}
          setPointed={setPointed}
          counts={counts}
          asked={asked ?? ""}
        />
      )}
      <figcaption className="fig-caption">
        <CaptionMore
          lead={
            first === "gene" ? (
              <>One group per gene, one lane per database: the releases at which it attaches the name to the gene.</>
            ) : (
              <>One row per attachment: the releases at which the database attaches the name to the gene.</>
            )
          }
        >
          <Mono>{groupedInteger(counts.attachments)}</Mono> {counts.attachments === 1 ? "attachment" : "attachments"} in
          all, {counts.synonyms ? <Mono>{groupedInteger(counts.synonyms)}</Mono> : "none"} as{" "}
          {counts.synonyms === 1 ? "a synonym" : "synonyms"}.{" "}
          {first === "gene" ? (
            <>
              Each group is an Ensembl id, in each of its versions, with what the databases of its names call it at the
              graph&rsquo;s last release, <Mono>{description.snapshot_release}</Mono> (converted there by{" "}
              <Mono>POST …/convert/batch</Mono>). Every version stands on its database&rsquo;s lane (a tick where the
              version changes, the version written above its segment where it has room), filled where the name is the
              database&rsquo;s name of the gene, hatched where it is one of its synonyms. Where a database&rsquo;s name
              of the gene becomes a synonym, a mark on the synonym&rsquo;s lane says from which release and what the
              database names the gene there (that gene version converted into the database at that release). Beside each
              lane, each version&rsquo;s exact releases (the first two, and the rest on a press).
            </>
          ) : (
            <>
              Filled: the name the database gives; hatched: one of its synonyms; the releases are written beside the
              lane, every release included.
            </>
          )}{" "}
          Behind the lanes, the assemblies that serve the releases; pointing at a lane names the first and last release
          of each run on the scale. As IDTrack lists them, from <Mono>{endpoint}</Mono>.
        </CaptionMore>
      </figcaption>
    </figure>
  );
}

function Legend({ marks }: { marks: boolean }) {
  return (
    <span className="names-legend" aria-hidden="true">
      <span className="names-legend__item">
        <span className="names-legend__swatch">
          <span className="rlane__run rlane__run--fill" />
        </span>
        the name
      </span>
      <span className="names-legend__item">
        <span className="names-legend__swatch">
          <span className="rlane__run rlane__run--synonym" />
        </span>
        a synonym
      </span>
      {marks ? (
        <span className="names-legend__item">
          <span className="names-legend__swatch names-legend__swatch--mark">
            <span className="rlane__mark" />
          </span>
          the release asked
        </span>
      ) : null}
    </span>
  );
}

// ---- What each gene is called at the graph's last release -----------------------------------------------------

interface Today {
  /** By database: the gene's answer there (its genes at the last release and their ids), or the status without one. */
  byDatabase: Map<string, Map<string, { genes: string[]; targets: string[]; status: string }>>;
}

/** One batch per database of the names shown: each gene's id converted to the graph's last release in that database
 *  (the release inferred, as a conversion of the id alone infers it), so that the page says what each database calls
 *  the gene today. Only databases the graph can answer in; nothing is asked for a database it cannot. */
function useToday(description: GraphDescription, groups: readonly GeneGroup[]) {
  const organism = description.organism;
  const finals = useMemo(() => new Set(description.final_databases), [description]);
  const wanted = useMemo(() => {
    const byDatabase = new Map<string, string[]>();
    for (const g of groups)
      for (const lane of g.lanes) {
        if (!finals.has(lane.database)) continue;
        const list = byDatabase.get(lane.database) ?? [];
        if (!list.includes(g.gene)) list.push(g.gene);
        byDatabase.set(lane.database, list);
      }
    return [...byDatabase.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [groups, finals]);
  const key = wanted.length ? `${organism}|today|${JSON.stringify(wanted)}` : null;
  const answer = useRequest(key, async (signal) => {
    const today: Today = { byDatabase: new Map() };
    let last = { requestId: null as string | null, serverTiming: null as string | null };
    for (const [database, genes] of wanted) {
      const reply = await api.batch(
        organism,
        {
          identifiers: genes,
          from_release: null,
          to_release: description.snapshot_release,
          final_database: database,
          from_database: null,
          explain: false,
          allow_bridges: true,
          read_copies: false,
        },
        signal,
      );
      last = reply;
      const map = new Map<string, { genes: string[]; targets: string[]; status: string }>();
      reply.data.results.forEach((r, k) => {
        const gene = genes[k];
        if (gene === undefined) return;
        const best = r.candidates.filter((c) => c.best);
        map.set(gene, {
          genes: [...new Set(best.map((c) => c.gene))],
          targets: r.no_target ? [] : [...new Set(best.map((c) => c.target))],
          status: r.status,
        });
      });
      today.byDatabase.set(database, map);
    }
    return { data: today, raw: "", requestId: last.requestId, serverTiming: last.serverTiming };
  });
  return answer.state === "done" ? answer.answer.data : answer.state === "failed" ? "failed" : "loading";
}

function TodayLine({
  group,
  today,
  snapshot,
}: {
  group: GeneGroup;
  today: Today | "failed" | "loading";
  snapshot: number;
}) {
  if (today === "loading") return <span className="names-today muted">Asking what it is called at {snapshot}…</span>;
  if (today === "failed")
    return <span className="names-today muted">What it is called at {snapshot}: the server did not say.</span>;
  const databases = [...new Set(group.lanes.map((l) => l.database))];
  const parts = databases.flatMap((database) => {
    const found = today.byDatabase.get(database)?.get(group.gene);
    return found ? [{ database, ...found }] : [];
  });
  if (!parts.length) return null;
  const genes = [...new Set(parts.flatMap((p) => p.genes))];
  return (
    <span className="names-today">
      <span className="names-today__label">at {snapshot}</span>{" "}
      {genes.length ? (
        <>
          {genes.slice(0, 3).map((g, i) => (
            <span key={g}>
              {i ? ", " : ""}
              <Mono strong>{g}</Mono>
            </span>
          ))}
          {genes.length > 3 ? ` and ${String(genes.length - 3)} more` : ""}
        </>
      ) : (
        <span>{statusTitle(parts[0]?.status ?? "no_conversion")}: no gene</span>
      )}
      {parts.map((p) => (
        <span key={p.database} className="names-today__db">
          {" · "}
          {p.targets.length ? (
            <>
              {p.targets.slice(0, 3).map((t, i) => (
                <span key={t}>
                  {i ? ", " : ""}
                  <Mono strong>{t}</Mono>
                </span>
              ))}
              {p.targets.length > 3 ? ` and ${String(p.targets.length - 3)} more` : ""}
            </>
          ) : (
            <span className="muted">none</span>
          )}{" "}
          <span className="muted">in {databaseLabel(p.database)}</span>
        </span>
      ))}
    </span>
  );
}

// ---- The genes a name names --------------------------------------------------------------------------------------

function GenesNamed({
  matches,
  description,
  address,
  axis,
  bands,
  release,
  scale,
  setPointed,
  asked,
  counts,
}: {
  matches: NameMatch[];
  description: GraphDescription;
  address: Record<string, string>;
  axis: Axis;
  bands: AxisBand[];
  release: number | null;
  scale: ReactNode;
  setPointed: (runs: Run[] | null) => void;
  asked: string;
  counts: NameCounts;
}) {
  const organism = description.organism;
  const groups = useMemo(() => groupByGene(matches), [matches]);
  const [shown, setShown] = useState(PAGE);
  const [find, setFind] = useState("");
  const needle = find.trim().toLowerCase();
  const found = needle
    ? groups.filter(
        (g) =>
          g.gene.toLowerCase().includes(needle) ||
          g.lanes.some((l) => databaseLabel(l.database).toLowerCase().includes(needle)),
      )
    : groups;
  const page = found.slice(0, shown);
  const today = useToday(description, page);
  const turnNames = useTurnNames(description, page);
  // The figure is first drawn once what the genes are called today has come (one short request per database), so that
  // its sentence and its genes' heads are drawn at their height once, and nothing under them moves; more genes shown
  // later say they are being asked in their own heads.
  const [drawn, setDrawn] = useState(false);
  if (!drawn && today !== "loading") setDrawn(true);
  if (!drawn && today === "loading") return <div className="names-skeleton" aria-hidden="true" />;
  return (
    <>
      <p className="names-verdict" tabIndex={-1}>
        {asked ? (
          <>
            <Mono>{asked}</Mono>{" "}
          </>
        ) : null}
        names {groups.length === 1 ? "one gene" : `${groupedInteger(groups.length)} genes`}{" "}
        <span className="names-verdict__counts">
          (<Mono>{groupedInteger(counts.versions)}</Mono> {counts.versions === 1 ? "version" : "versions"}) in{" "}
          {counts.databases === 1 ? "one database" : `${groupedInteger(counts.databases)} databases`}
        </span>
        {release !== null ? (
          <>
            {" "}
            at release <Mono>{release}</Mono>
          </>
        ) : null}
        {groups.length <= 4 ? (
          <>
            :{" "}
            {groups.map((g, i) => {
              const now = renamedNow(g, today, asked);
              return (
                <span key={g.gene}>
                  {i ? (i === groups.length - 1 ? " and " : ", ") : ""}
                  <Mono>{g.gene}</Mono> at {releaseRanges(g.releases)}
                  {now ? (
                    <>
                      {" "}
                      <span className="names-verdict__now">
                        (named <Mono strong>{now.names.join(", ")}</Mono> in {databaseLabel(now.database)} at{" "}
                        {description.snapshot_release})
                      </span>
                    </>
                  ) : null}
                </span>
              );
            })}
          </>
        ) : null}
        .
      </p>
      {groups.length > PAGE ? (
        <div className="names-find">
          <label className="visually-hidden" htmlFor="names-find">
            Find a gene or a database among the genes
          </label>
          <TextInput
            id="names-find"
            className="input--mono input--small"
            placeholder="Find a gene or database"
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setShown(PAGE);
            }}
          />
          <span className="muted" aria-live="polite">
            {groupedInteger(Math.min(shown, found.length))} of {groupedInteger(found.length)} genes shown
            {needle ? ` (of ${groupedInteger(groups.length)})` : ""}
          </span>
        </div>
      ) : null}
      <TableFrame label={`The genes ${asked} names`} className="table-frame--cards">
        <table className="table table--names table--names-genes table--cards">
          <thead>
            <tr>
              <th scope="col">Database</th>
              <th scope="col" className="names-lane-head">
                <span className="names-lane-head__title">Releases</span>
                {scale}
              </th>
              <th scope="col" className="names-exact-head">
                Exact releases, by version
              </th>
            </tr>
          </thead>
          {page.map((group) => (
            <tbody key={group.gene} className="names-gene">
              <tr className="names-gene__head">
                <th scope="rowgroup" colSpan={3}>
                  <span className="names-gene__id">
                    <Link
                      to={href("/names", {
                        ...address,
                        organism,
                        ask: "names",
                        gene: group.versions[group.versions.length - 1] ?? group.gene,
                        release: null,
                      })}
                    >
                      <Mono strong>{group.gene}</Mono>
                    </Link>
                    <span className="names-gene__versions">
                      {group.versions.length === 1 ? "1 version" : `${String(group.versions.length)} versions`}{" "}
                      <Mono>{versionsWords(group.versions)}</Mono>
                    </span>
                  </span>
                  <TodayLine group={group} today={today} snapshot={description.snapshot_release} />
                  <Link
                    className="row-link names-gene__convert"
                    to={convertHref(organism, plainConversion(group.gene))}
                  >
                    Convert<span className="visually-hidden"> {group.gene}</span>
                  </Link>
                </th>
              </tr>
              {group.lanes.map((lane) => (
                <LaneRow
                  key={`${lane.database}|${String(lane.synonym)}`}
                  turns={turnsOf(group)
                    .filter((t) => lane.synonym && t.database === lane.database)
                    .map((t) => ({
                      release: t.release,
                      names: turnNames?.get(`${t.database}|${String(t.release)}|${t.version}`) ?? null,
                    }))}
                  lane={lane}
                  asked={asked}
                  axis={axis}
                  bands={bands}
                  release={release}
                  setPointed={setPointed}
                />
              ))}
            </tbody>
          ))}
        </table>
      </TableFrame>
      {shown < found.length ? (
        <div className="names-more">
          <Button
            onClick={() => {
              setShown(shown + PAGE * 2);
            }}
          >
            Show {groupedInteger(Math.min(PAGE * 2, found.length - shown))} more genes
          </Button>
          <span className="muted">
            {groupedInteger(found.length - shown)} more of {groupedInteger(found.length)}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** What a database that gives the name to the gene (as its name, not a synonym) calls the gene at the graph's last
 *  release, where that is another name than the one asked (in any letter case): the first such database in the order of the lanes. */
function renamedNow(
  group: GeneGroup,
  today: Today | "failed" | "loading",
  asked: string,
): { database: string; names: string[] } | null {
  if (typeof today === "string" || !asked) return null;
  for (const lane of group.lanes) {
    if (lane.synonym) continue;
    const found = today.byDatabase.get(lane.database)?.get(group.gene);
    // Compared without letter case: a name asked in other letter case is the same name.
    const same = found?.targets.some((t) => t.toLowerCase() === asked.toLowerCase());
    if (found?.targets.length && !same) return { database: lane.database, names: found.targets };
  }
  return null;
}

/** The versions of a gene in short (`.4–.11` for a run of consecutive versions, else each). */
function versionsWords(versions: readonly string[]): string {
  const numbers = versions.map((v) => Number(/\.(\d+)$/.exec(v)?.[1] ?? NaN));
  if (numbers.some((n) => Number.isNaN(n))) return "";
  return releaseRanges(numbers)
    .split(", ")
    .map((part) =>
      part
        .split("–")
        .map((n) => `.${n}`)
        .join("–"),
    )
    .join(", ");
}

/** What each database calls a gene at each turn of its name into a synonym: one batch per database and release, the
 *  gene's version converted there into that database (read and answered at that release, no bridge). Only databases a
 *  conversion to that release can end in are asked; a turn whose name cannot be had is drawn without it. */
function useTurnNames(description: GraphDescription, groups: readonly GeneGroup[]) {
  const organism = description.organism;
  const finals = useMemo(() => new Set(description.final_databases), [description]);
  const wanted = useMemo(() => {
    const by = new Map<string, { database: string; release: number; versions: string[] }>();
    for (const g of groups)
      for (const t of turnsOf(g)) {
        if (!finals.has(t.database)) continue;
        const key = `${t.database}|${String(t.release)}`;
        const entry = by.get(key) ?? { database: t.database, release: t.release, versions: [] };
        if (!entry.versions.includes(t.version)) entry.versions.push(t.version);
        by.set(key, entry);
      }
    return [...by.values()].sort((x, y) => x.database.localeCompare(y.database) || x.release - y.release);
  }, [groups, finals]);
  const key = wanted.length ? `${organism}|turns|${JSON.stringify(wanted)}` : null;
  const answer = useRequest(key, async (signal) => {
    const names = new Map<string, string[]>();
    let last = { requestId: null as string | null, serverTiming: null as string | null };
    for (const w of wanted) {
      const reply = await api.batch(
        organism,
        {
          identifiers: w.versions,
          from_release: w.release,
          to_release: w.release,
          final_database: w.database,
          from_database: null,
          explain: false,
          allow_bridges: false,
          read_copies: false,
        },
        signal,
      );
      last = reply;
      reply.data.results.forEach((r, k) => {
        const version = w.versions[k];
        if (version === undefined || r.no_target) return;
        const targets = [...new Set(r.candidates.filter((c) => c.best).map((c) => c.target))];
        if (targets.length) names.set(`${w.database}|${String(w.release)}|${version}`, targets);
      });
    }
    return { data: names, raw: "", requestId: last.requestId, serverTiming: last.serverTiming };
  });
  return answer.state === "done" ? answer.answer.data : null;
}

/** The versions of a lane written above their segments where they have room (all are in the column beside), clear
 *  of the hairlines where the assembly changes, as of every other label. */
function VersionLabels({ lane, axis, bands }: { lane: NameLane; axis: Axis; bands: AxisBand[] }) {
  const { ref, width } = useWidth<HTMLSpanElement>(0);
  const n = axis.releases.length;
  const edges: [number, number][] = bands.slice(1).map((b) => [b.left * width - 1, b.left * width + 1]);
  const placed = width
    ? placeLabels(
        lane.parts.map((p) => {
          const at = p.releases.map((r) => axis.index.get(r) ?? 0);
          const mid = (Math.min(...at) + Math.max(...at) + 1) / 2 / n;
          return {
            key: p.gene,
            anchor: mid * width,
            forms: [/\.\d+$/.exec(p.gene)?.[0] ?? ""],
            align: "center" as const,
            rows: ["v"],
          };
        }),
        { bounds: [0, width], gap: 3, taken: new Map([["v", edges]]) },
      )
    : new Map<string, PlacedLabel>();
  return (
    <span className="names-versions" ref={ref} aria-hidden="true">
      {[...placed.values()].map((label) => (
        <span key={label.key} className="names-versions__label" style={{ left: `${(label.t0 - 1).toFixed(2)}px` }}>
          {label.text}
        </span>
      ))}
    </span>
  );
}

/** Each version's exact releases on one line, the first few at once and the rest on a press. */
function ExactReleases({ parts }: { parts: readonly NameMatch[] }) {
  const [all, setAll] = useState(false);
  const shown = all || parts.length <= 3 ? parts : parts.slice(0, 2);
  return (
    <>
      {shown.map((p) => (
        <span key={p.gene} className="names-exact__line">
          <Mono>{/\.\d+$/.exec(p.gene)?.[0] ?? p.gene}</Mono> <RangesText releases={p.releases} />
        </span>
      ))}
      {parts.length > shown.length || all ? (
        <button
          type="button"
          className="link-button names-exact__more"
          aria-expanded={all}
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? "fewer" : `+ ${String(parts.length - shown.length)} versions`}
        </button>
      ) : null}
    </>
  );
}

function LaneRow({
  lane,
  asked,
  axis,
  bands,
  release,
  setPointed,
  turns,
}: {
  lane: NameLane;
  /** The name asked: a lane whose name is written otherwise (in another letter case) says so. */
  asked: string;
  axis: Axis;
  bands: AxisBand[];
  release: number | null;
  setPointed: (runs: Run[] | null) => void;
  /** Where the database's name turns into this synonym lane, with the name it gives the gene there (if known). */
  turns: { release: number; names: string[] | null }[];
}) {
  const runs = useMemo(() => runsOf(axis, lane.releases), [axis, lane]);
  const n = axis.releases.length;
  // A tick where the version changes: at the first release of each version after the first.
  const ticks = lane.parts.slice(1).flatMap((p) => {
    const at = axis.index.get(Math.min(...p.releases));
    return at === undefined ? [] : [{ left: at / n, version: p.gene }];
  });
  return (
    <tr
      className="names-lane-row"
      onMouseEnter={() => {
        setPointed(runs);
      }}
      onMouseLeave={() => {
        setPointed(null);
      }}
    >
      <td data-label="Database" className="names-db">
        {databaseLabel(lane.database)}
        {lane.synonym ? <span className="tag">synonym</span> : null}
        {lane.parts.some((p) => p.name !== asked) ? (
          <span className="sub">
            as <Mono>{[...new Set(lane.parts.map((p) => p.name))].join(", ")}</Mono>
          </span>
        ) : null}
      </td>
      <td data-label="Releases" className="names-lane">
        <span className="names-lane__bands" aria-hidden="true">
          <BandBackdrop bands={bands} />
        </span>
        <VersionLabels lane={lane} axis={axis} bands={bands} />
        <span className="names-lane__track">
          <ReleaseLane axis={axis} bands={[]} runs={runs} variant={lane.synonym ? "synonym" : "fill"} mark={release} />
          {ticks.map((t) => (
            <span
              key={t.version}
              className="rlane__version"
              style={{ left: `${(t.left * 100).toFixed(4)}%` }}
              aria-hidden="true"
            />
          ))}
          {turns.map((t) => {
            const at = axis.index.get(t.release);
            if (at === undefined) return null;
            return (
              <span
                key={t.release}
                className={`names-turn ${at / n < 0.4 ? "names-turn--right" : ""}`}
                style={{ left: `${((at / n) * 100).toFixed(4)}%` }}
              >
                <span className="names-turn__label">
                  {t.names?.length ? (
                    <>
                      from <Mono>{t.release}</Mono> named <Mono strong>{t.names.join(", ")}</Mono>
                    </>
                  ) : (
                    <>
                      a synonym from <Mono>{t.release}</Mono>
                    </>
                  )}
                </span>
              </span>
            );
          })}
        </span>
        <LaneEnds axis={axis} />
      </td>
      <td data-label="Exact releases" className="names-exact cell-ranges">
        <ExactReleases parts={lane.parts} />
      </td>
    </tr>
  );
}

// ---- The names of a gene -----------------------------------------------------------------------------------------

function NamesOf({
  matches,
  description,
  address,
  axis,
  bands,
  release,
  scale,
  setPointed,
  counts,
  asked,
}: {
  matches: NameMatch[];
  description: GraphDescription;
  address: Record<string, string>;
  axis: Axis;
  bands: AxisBand[];
  release: number | null;
  scale: ReactNode;
  setPointed: (runs: Run[] | null) => void;
  counts: NameCounts;
  asked: string;
}) {
  const organism = description.organism;
  const runs = useMemo(() => matches.map((m) => runsOf(axis, m.releases)), [axis, matches]);
  const [shown, setShown] = useState(ROWS);
  const rows = matches.slice(0, shown);
  return (
    <>
      <p className="names-verdict" tabIndex={-1}>
        <Mono>{asked || matches[0]?.gene}</Mono> has{" "}
        {counts.names === 1 ? "one name" : `${groupedInteger(counts.names)} names`} in{" "}
        {counts.databases === 1 ? "one database" : `${groupedInteger(counts.databases)} databases`}
        {release !== null ? (
          <>
            {" "}
            at release <Mono>{release}</Mono>
          </>
        ) : null}
        .
      </p>
      <TableFrame label={`The names of ${matches[0]?.gene ?? "the gene"}`} className="table-frame--cards">
        <table className="table table--names table--cards">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Database</th>
              <th scope="col" className="names-lane-head">
                <span className="names-lane-head__title">Releases</span>
                {scale}
              </th>
              <th scope="col" className="names-exact-head">
                Exact releases
              </th>
              <th scope="col">
                <span className="visually-hidden">Convert</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const previous = matches[i - 1];
              const start = previous?.database !== m.database;
              return (
                <tr
                  key={i}
                  className={start ? "is-group-start" : undefined}
                  onMouseEnter={() => {
                    setPointed(runs[i] ?? []);
                  }}
                  onMouseLeave={() => {
                    setPointed(null);
                  }}
                >
                  <td data-label="Name" className="names-subject">
                    <Link to={href("/names", { ...address, organism, name: m.name, ask: null })}>
                      <Mono>{m.name}</Mono>
                    </Link>
                  </td>
                  <td data-label="Database" className={`names-db ${start ? "" : "is-repeat"}`}>
                    {databaseLabel(m.database)}
                    {m.synonym ? <span className="tag">synonym</span> : null}
                  </td>
                  <td data-label="Releases" className="names-lane">
                    <span className="names-lane__bands" aria-hidden="true">
                      <BandBackdrop bands={bands} />
                    </span>
                    <ReleaseLane
                      axis={axis}
                      bands={[]}
                      runs={runs[i] ?? []}
                      variant={m.synonym ? "synonym" : "fill"}
                      mark={release}
                    />
                    <LaneEnds axis={axis} />
                  </td>
                  <td data-label="Exact releases" className="names-exact cell-ranges">
                    <RangesText releases={m.releases} />
                  </td>
                  <td data-label="" className="names-convert">
                    <Link className="row-link" to={convertHref(organism, plainConversion(m.name))}>
                      Convert<span className="visually-hidden"> {m.name}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      {shown < matches.length ? (
        <div className="names-more">
          <Button
            onClick={() => {
              setShown(shown + ROWS * 2);
            }}
          >
            Show {groupedInteger(Math.min(ROWS * 2, matches.length - shown))} more names
          </Button>
          <span className="muted">
            {groupedInteger(matches.length - shown)} more of {groupedInteger(matches.length)}
          </span>
        </div>
      ) : null}
    </>
  );
}
