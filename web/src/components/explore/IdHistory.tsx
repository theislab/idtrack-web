// Ensembl's id history of one graph, release by release, on the release axis every figure shares, over the bands of the
// assemblies that serve each release (`GET /organisms/{organism}/history`): the gene ids active at each release (a
// line), and what changed into each release (a column: versions followed by another version of the same id, by a
// version of another id, and ids retired; below the axis, the ids created there). Every release is focusable with its
// exact counts, the transitions that end there with their two releases, and the server's conversions whose path passes
// through it (links; Enter opens the first). On an organism's page the server's cases stand as numbered marks at the
// release of the step that makes each its kind, keyed to the list under the figure.
//
// In compact form (Explore, one row per graph on one shared axis) only the columns are drawn, without an axis of their
// own; `share` draws them as shares of the gene ids active (what changed into a release over the ids active at the
// release before; the ids created over those active at the release), on one axis of 0 to 100 % for every graph.
import { useCallback, useMemo, type KeyboardEvent } from "react";
import type { GraphDescription, HistoryResponse } from "../../api/types";
import {
  casesThrough,
  changed,
  historyColumns,
  niceMax,
  shares,
  type CaseMark,
  type HistoryColumn,
} from "../../lib/explore/history";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { groupedInteger } from "../../lib/numbers";
import { navigate } from "../../lib/router";
import { Link } from "../ui";
import { spaced } from "../../lib/vocabulary";
import { assemblyBands, releaseScale } from "../figure/releases";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { glyphOf } from "../figure/glyph";
import { StepGlyph } from "../figure/glyphs";
import { useRoving } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

const LEFT = 64;
const RIGHT = 12;

const plural = (n: number, one: string, many: string) => `${groupedInteger(n)} ${n === 1 ? one : many}`;
const percent = (share: number) => `${(share * 100).toFixed(1)} %`;

/** A transition's counts in words, each kind once, the scored edges as a count of edges. */
function transitionWords(t: HistoryColumn["into"][number]): string {
  const moved = t.version_changes + t.id_changes;
  return `${plural(t.version_changes, "version", "versions")} to another version, ${plural(t.id_changes, "version", "versions")} to another id (${groupedInteger(moved)} changed), ${plural(t.retired, "id", "ids")} retired, ${plural(t.same_version, "kept", "kept")}; ${plural(t.scored, "of these edges carries", "of these edges carry")} Ensembl's score`;
}

const NO_MARKS: readonly CaseMark[] = [];

export function IdHistory({
  history,
  description,
  releases,
  compact = false,
  share = false,
  axis = true,
  marks = NO_MARKS,
  organism,
  label,
}: {
  history: HistoryResponse;
  description: GraphDescription;
  /** The releases of the axis (several graphs on one axis); the graph's own by default. */
  releases?: readonly number[];
  compact?: boolean;
  /** Draw the columns as shares of the gene ids active, on 0 to 100 % (compact form). */
  share?: boolean;
  /** Draw the release axis under the figure (false: several rows share one axis drawn apart). */
  axis?: boolean;
  /** The server's cases of the graph, each at its release (an organism's page). */
  marks?: readonly CaseMark[];
  organism: string;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const columns = useMemo(() => historyColumns(history), [history]);
  const shareOf = useMemo(() => shares(columns), [columns]);
  const axisReleases = releases ?? description.releases;
  // In compact form the axis is that of Explore's assemblies (4 px in, 8 px from the right), and the scales' values
  // are written beside the row, not in it.
  const scale = compact ? releaseScale(axisReleases, 4, width - 8) : releaseScale(axisReleases, LEFT, width - RIGHT);
  const bands = assemblyBands(description);
  const placed = marks.filter((m) => m.release !== null);
  // Each mark (a glyph and its number, about 22 px wide) takes the first row where it stands clear of the marks already
  // placed there, so that no two numbers meet however close their releases.
  const markRow = new Map<number, number>();
  const rowEnds: number[] = [];
  for (const m of [...placed].sort((a, b) => (a.release ?? 0) - (b.release ?? 0) || a.number - b.number)) {
    const x = scale.x(m.release ?? 0);
    let row = rowEnds.findIndex((end) => x - 6 > end);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = x + 7 + 7 * String(m.number).length;
    markRow.set(m.number, row);
  }
  const markH = placed.length ? 14 * rowEnds.length + 8 : 0;
  const top = compact ? 6 : 36 + markH;
  const genesH = compact ? 0 : 64;
  const gap = compact ? 0 : 26;
  const upH = compact ? 46 : 104;
  const downH = compact ? 26 : 50;
  const genesTop = top;
  const base = top + genesH + gap + upH;
  const axisY = base + downH + 6;
  const height = axis ? axisY + 26 : axisY + 2;
  const drawn = columns.filter((c) => !c.first);
  const upMax = share ? 1 : niceMax(Math.max(0, ...columns.map(changed)));
  const downMax = share ? 1 : niceMax(Math.max(0, ...drawn.map((c) => c.created)));
  const genesMax = niceMax(Math.max(0, ...columns.map((c) => c.genes)));
  const up = (v: number) => Math.min(upH, (v / upMax) * upH);
  const down = (v: number) => Math.min(downH, (v / downMax) * downH);
  const gy = (v: number) => genesTop + genesH - (v / genesMax) * genesH;
  const barW = Math.max(1, Math.min(14, scale.step - (scale.step > 4 ? 1.5 : 0.5)));
  const svg = useCallback(() => ref.current?.querySelector("svg") ?? null, [ref]);
  const roving = useRoving(columns.length, svg);
  const shownIndex = roving.shown;
  const shown: HistoryColumn | null = shownIndex === null ? null : (columns[shownIndex] ?? null);
  const shownShare: { changed: number | null; created: number | null } | undefined =
    shownIndex === null ? undefined : shareOf[shownIndex];
  const through = (c: HistoryColumn) => casesThrough(marks, c.release);
  const line = columns
    .map((c, i) => `${i ? "L" : "M"}${scale.x(c.release).toFixed(1)},${gy(c.genes).toFixed(1)}`)
    .join("");
  const hrefOf = (m: CaseMark) => caseHref(caseQueryOf(organism, m.case.query));
  const columnLabel = (c: HistoryColumn, i: number) => {
    const s = shareOf[i];
    const changedWords =
      share && s && s.changed !== null
        ? `${percent(s.changed)} of the ids active before changed into it`
        : `${groupedInteger(changed(c))} history edges end at it (${groupedInteger(c.versionChanges + c.idChanges)} changed, ${groupedInteger(c.retired)} retired)`;
    const cases = through(c);
    return `Release ${c.release}: ${groupedInteger(c.genes)} gene ids active; ${changedWords}; ${c.first ? "the graph's first release" : `${groupedInteger(c.created)} created`}${cases.length ? `; ${cases.length === 1 ? "1 conversion of this server passes" : `${cases.length} conversions of this server pass`} through it, Enter opens the first` : ""}`;
  };
  return (
    <div className={`idh${compact ? " idh--compact" : ""}`} ref={ref}>
      <svg width={width} height={height} role="group" aria-label={label} className="idh__svg">
        <Bands bands={bands} scale={scale} top={0} bottom={axisY} labels={!compact} labelY={13} outerY={27} />
        {compact ? null : (
          <g className="idh__genes">
            <line x1={scale.x0} x2={scale.x1} y1={genesTop + genesH} y2={genesTop + genesH} className="idh__base" />
            <path d={line} className="idh__line" />
            <text x={LEFT - 6} y={gy(genesMax) + 4} textAnchor="end" className="fig-text idh__tick">
              {groupedInteger(genesMax)}
            </text>
            <text x={LEFT - 6} y={genesTop + genesH + 4} textAnchor="end" className="fig-text idh__tick">
              0
            </text>
            <text x={4} y={genesTop + genesH / 2 + 4} className="fig-text fig-text--sans idh__axis-name">
              genes
            </text>
          </g>
        )}
        <line x1={scale.x0} x2={scale.x1} y1={base} y2={base} className="idh__base" />
        {compact ? null : (
          <>
            <text x={LEFT - 6} y={base - upH + 4} textAnchor="end" className="fig-text idh__tick">
              {groupedInteger(upMax)}
            </text>
            <text x={LEFT - 6} y={base + 4} textAnchor="end" className="fig-text idh__tick">
              0
            </text>
            <text x={LEFT - 6} y={base + downH} textAnchor="end" className="fig-text idh__tick">
              {groupedInteger(downMax)}
            </text>
            <text x={4} y={base - upH / 2 + 4} className="fig-text fig-text--sans idh__axis-name">
              changed
            </text>
            <text x={4} y={base + downH / 2 + 4} className="fig-text fig-text--sans idh__axis-name">
              created
            </text>
          </>
        )}
        {columns.map((c, i) => {
          const x = scale.x(c.release) - barW / 2;
          let y = base;
          // In share mode the three parts keep their proportions within the column's share.
          const factor = share ? (shareOf[i]?.changed ?? 0) / Math.max(1, changed(c)) : 1;
          const segment = (value: number, className: string) => {
            if (value <= 0) return null;
            const h = up(value * factor);
            y -= h;
            return <rect key={className} x={x} y={y} width={barW} height={h} className={className} />;
          };
          const created = share ? (shareOf[i]?.created ?? 0) : c.created;
          return (
            <g key={c.release} className="idh__col">
              {segment(c.versionChanges, "idh__version")}
              {segment(c.idChanges, "idh__id")}
              {segment(c.retired, "idh__retired")}
              {!c.first && created > 0 ? (
                <rect x={x} y={base} width={barW} height={down(created)} className="idh__created" />
              ) : null}
            </g>
          );
        })}
        {placed.length ? (
          <g className="idh__marks" aria-hidden="true">
            {placed.map((m) => {
              const x = scale.x(m.release ?? 0);
              const y = 36 + 6 + (markRow.get(m.number) ?? 0) * 14;
              const glyph = m.step ? glyphOf(m.step) : "version";
              return (
                <g key={m.number}>
                  <line x1={x} x2={x} y1={y + 6} y2={base - upH - 2} className="idh__mark-stem" />
                  <StepGlyph glyph={glyph} x={x} y={y} size="thin" />
                  <text x={x + 7} y={y + 4} className="fig-text idh__mark-number">
                    {m.number}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}
        {columns.map((c, i) => {
          const bound = roving.bind(i);
          const cases = through(c);
          return (
            <rect
              key={`hit-${c.release}`}
              x={scale.x(c.release) - Math.max(scale.step, 6) / 2}
              y={0}
              width={Math.max(scale.step, 6)}
              height={axisY}
              className={`idh__hit${roving.focused === i ? " idh__hit--on" : ""}`}
              role="img"
              aria-label={columnLabel(c, i)}
              {...bound}
              onKeyDown={(event: KeyboardEvent) => {
                const first = cases[0];
                if ((event.key === "Enter" || event.key === " ") && first) {
                  event.preventDefault();
                  navigate(hrefOf(first));
                  return;
                }
                bound.onKeyDown(event);
              }}
            />
          );
        })}
        {axis ? <ReleaseTicks scale={scale} y={axisY} releases={axisReleases} /> : null}
      </svg>
      {shown && shownIndex !== null ? (
        <FigureNote x={scale.x(shown.release)} y={Math.min(height - 40, base + 10)} width={width} pointer={roving.note}>
          <p className="fig-note__title">
            Release <span className="mono">{shown.release}</span>
          </p>
          <p>
            <span className="mono">{groupedInteger(shown.genes)}</span> gene ids active
            {shown.versions !== shown.genes ? (
              <>
                {" "}
                (<span className="mono">{groupedInteger(shown.versions)}</span> versions)
              </>
            ) : null}
          </p>
          {shown.first ? (
            <p>The graph&apos;s first release: its {groupedInteger(shown.created)} ids are where the graph begins.</p>
          ) : (
            <p>
              <span className="mono">{groupedInteger(shown.created)}</span> ids created here
              {share && shownShare?.created !== undefined && shownShare.created !== null ? (
                <span className="muted"> ({percent(shownShare.created)} of those active)</span>
              ) : null}
            </p>
          )}
          {shown.into.length ? (
            shown.into.map((t) => (
              <p key={`${t.from_release}-${t.to_release}`} className="fig-note__quiet">
                At <span className="mono">{t.from_release}</span> → <span className="mono">{t.to_release}</span>:{" "}
                {transitionWords(t)}
              </p>
            ))
          ) : (
            <p className="fig-note__quiet">No history edge ends at this release.</p>
          )}
          {share && shownShare?.changed !== undefined && shownShare.changed !== null ? (
            <p className="fig-note__quiet">
              Changed or retired: {percent(shownShare.changed)} of the gene ids active at the release before
            </p>
          ) : null}
          {through(shown).length ? (
            <div className="idh__note-cases">
              <p className="fig-note__quiet">Conversions of this server through this release:</p>
              <ul>
                {through(shown)
                  .slice(0, 4)
                  .map((m) => (
                    <li key={m.number}>
                      <Link to={hrefOf(m)}>
                        <span className="mono">{m.case.query.identifier}</span>
                      </Link>{" "}
                      <span className="muted">{spaced(m.case.kind)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </FigureNote>
      ) : null}
      <ul className="visually-hidden" aria-label={`${label}, one release a line`}>
        {columns.map((c, i) => (
          <li key={c.release}>{columnLabel(c, i)}</li>
        ))}
      </ul>
    </div>
  );
}
