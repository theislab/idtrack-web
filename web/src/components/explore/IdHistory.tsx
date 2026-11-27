// Ensembl's id history of one graph, release by release, on the release axis every figure shares, under the names of
// the assemblies that serve each release and over their bands (`GET /organisms/{organism}/history`). Its parts, each on
// its own linear scale from 0 (both ends written): the gene ids active at each release (a line); what changed into each
// release (a column: versions followed by another version of the same id, by a version of another id, and ids
// retired); below the axis, the ids created there; the fan of Ensembl's mapping, the gene versions it maps to two or
// more (a split, above a midline) and those it maps two or more into (a merge, below); and the edges that keep an id and
// its version (a re-mapping to itself). Every release is focusable with its exact counts, the transitions that end there
// with their two releases, and the server's conversions whose path passes through it (links; Enter opens the first). On
// an organism's page the server's cases stand as numbered marks at the release of the step that makes each its kind,
// keyed to the list under the figure.
//
// In compact form (Explore, one row per graph on one shared axis) the columns, the created ids and the fan are drawn,
// without an axis of their own; `share` draws them as shares of the gene ids active (what changed into a release over
// the ids active at the release before; the ids created over those active at the release), on one axis of 0 to 100 %
// for every graph (the fan on 0 to 10 %).
import { useCallback, useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { GraphDescription, HistoryResponse } from "../../api/types";
import {
  casesThrough,
  changed,
  columnWords,
  fansCounted,
  historyColumns,
  kindWords,
  niceMax,
  shares,
  type CaseMark,
  transitionWords,
  type HistoryColumn,
} from "../../lib/explore/history";
import { caseHref, caseQueryOf } from "../../lib/home/links";
import { groupedInteger } from "../../lib/numbers";
import { navigate } from "../../lib/router";
import { Link } from "../ui";
import { assemblyBands, releaseScale } from "../figure/releases";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { glyphOf } from "../figure/glyph";
import { StepGlyph } from "../figure/glyphs";
import { useRoving } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

const LEFT = 64;
const RIGHT = 12;
/** The rows of the assemblies' names above the bands (an organism's page): the names inside, then the names of the
 *  bands too narrow for theirs; the bands start under them, so no name stands on a band's edge. */
const NAMES = 32;
/** The fan's axis in share mode: 0 to 10 % of the gene ids active before (the largest of the five graphs is 7.4 %), or
 *  the next round share above a larger one. */
const FAN_SHARE = 0.1;

const percent = (share: number) => `${(share * 100).toFixed(1)} %`;

const NO_MARKS: readonly CaseMark[] = [];

/** One part of the figure: its name and the largest value of its scale in the left gutter (an organism's page). */
function PartLabels({
  name,
  y0,
  y1,
  max,
  zero = true,
  bottomMax = false,
}: {
  name: ReactNode;
  /** The top and the bottom of the part. */
  y0: number;
  y1: number;
  max: string;
  zero?: boolean;
  /** The largest value at the bottom (a part drawn downward). */
  bottomMax?: boolean;
}) {
  return (
    <>
      <text x={LEFT - 6} y={bottomMax ? y1 : y0 + 8} textAnchor="end" className="fig-text idh__tick">
        {max}
      </text>
      {zero ? (
        <text x={LEFT - 6} y={bottomMax ? y0 + 8 : y1} textAnchor="end" className="fig-text idh__tick">
          0
        </text>
      ) : null}
      <text x={4} y={(y0 + y1) / 2 + 4} className="fig-text fig-text--sans idh__axis-name">
        {name}
      </text>
    </>
  );
}

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
  focusRelease = null,
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
  /** A release to show at once (an address's `?release=`): its column is focused, its exact counts in its note. */
  focusRelease?: number | null;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const patternId = useId().replace(/:/g, "");
  const columns = useMemo(() => historyColumns(history), [history]);
  const shareOf = useMemo(() => shares(columns), [columns]);
  const fans = fansCounted(columns);
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
  const bandsTop = compact ? 0 : NAMES;
  const markTop = NAMES + 8;
  const top = compact ? 6 : NAMES + 12 + markH;
  const genesH = compact ? 0 : 64;
  const gap = compact ? 0 : 26;
  const upH = compact ? 46 : 104;
  const downH = compact ? 26 : 50;
  const fanGap = compact ? 8 : 26;
  const fanH = fans ? (compact ? 9 : 26) : 0;
  const keptGap = compact ? 0 : 22;
  const keptH = compact ? 0 : 36;
  const genesTop = top;
  const base = top + genesH + gap + upH;
  const fanMid = base + downH + fanGap + fanH;
  const keptTop = fanMid + (fans ? fanH : 0) + keptGap;
  const keptBase = keptTop + keptH;
  const axisY = (compact ? fanMid + fanH : keptBase) + 6;
  const height = axis ? axisY + 26 : axisY + 2;
  const drawn = columns.filter((c) => !c.first);
  const upMax = share ? 1 : niceMax(Math.max(0, ...columns.map(changed)));
  const downMax = share ? 1 : niceMax(Math.max(0, ...drawn.map((c) => c.created)));
  const fanMaxShare = Math.max(0, ...shareOf.map((s) => Math.max(s.fanOut ?? 0, s.fanIn ?? 0)));
  const fanMax = share
    ? fanMaxShare <= FAN_SHARE
      ? FAN_SHARE
      : niceMax(fanMaxShare * 100) / 100
    : niceMax(Math.max(0, ...columns.map((c) => Math.max(c.fanOut ?? 0, c.fanIn ?? 0))));
  const keptMax = niceMax(Math.max(0, ...columns.map((c) => c.kept)));
  const genesMax = niceMax(Math.max(0, ...columns.map((c) => c.genes)));
  // A value above zero is never drawn thinner than a hairline: it would read as none.
  const sized = (v: number, max: number, h: number) => (v <= 0 ? 0 : Math.max(1, Math.min(h, (v / max) * h)));
  const up = (v: number) => sized(v, upMax, upH);
  const down = (v: number) => sized(v, downMax, downH);
  const gy = (v: number) => genesTop + genesH - (v / genesMax) * genesH;
  const barW = Math.max(1, Math.min(14, scale.step - (scale.step > 4 ? 1.5 : 0.5)));
  const svg = useCallback(() => ref.current?.querySelector("svg") ?? null, [ref]);
  const roving = useRoving(columns.length, svg);
  const shownIndex = roving.shown;
  const shown: HistoryColumn | null = shownIndex === null ? null : (columns[shownIndex] ?? null);
  const shownShare = shownIndex === null ? undefined : shareOf[shownIndex];
  const through = (c: HistoryColumn) => casesThrough(marks, c.release);
  const line = columns
    .map((c, i) => `${i ? "L" : "M"}${scale.x(c.release).toFixed(1)},${gy(c.genes).toFixed(1)}`)
    .join("");
  const hrefOf = (m: CaseMark) => caseHref(caseQueryOf(organism, m.case.query));
  const columnLabel = (c: HistoryColumn, i: number) => {
    const s = shareOf[i];
    const changedWords =
      share && s && s.changed !== null
        ? `${percent(s.changed)} of the ids active before changed or retired into it; ${columnWords(c)}`
        : columnWords(c);
    const cases = through(c);
    return `Release ${c.release}: ${groupedInteger(c.genes)} gene ids active; ${changedWords}; ${c.first ? "the graph's first release" : `${groupedInteger(c.created)} created`}${cases.length ? `; ${cases.length === 1 ? "1 conversion of this server passes" : `${cases.length} conversions of this server pass`} through it, Enter opens the first` : ""}`;
  };
  const hatch = `idh-hatch-${patternId}`;
  // The release an address names is focused once, when the figure is first drawn with its columns.
  const focusedOnce = useRef<number | null>(null);
  useEffect(() => {
    if (focusRelease === null || focusedOnce.current === focusRelease) return;
    const index = columns.findIndex((c) => c.release === focusRelease);
    const element = ref.current?.querySelector<SVGElement>(`[data-index="${index}"]`);
    if (index < 0 || !element) return;
    focusedOnce.current = focusRelease;
    element.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "center" });
  }, [focusRelease, columns, ref, width]);
  return (
    <div className={`idh${compact ? " idh--compact" : ""}`} ref={ref}>
      <svg width={width} height={height} role="group" aria-label={label} className="idh__svg">
        <defs>
          {/* A version followed by a version of another id: the history hue in stripes, so that it stands apart
              from a version of the same id (solid) at the contrast of a mark, and in forced colours. */}
          <pattern id={hatch} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={3} height={3} className="idh__hatch-ground" />
            <rect width={1.6} height={3} className="idh__hatch" />
          </pattern>
        </defs>
        <Bands bands={bands} scale={scale} top={bandsTop} bottom={axisY} labels={!compact} labelY={13} outerY={27} />
        {compact ? null : (
          <g className="idh__genes">
            <line x1={scale.x0} x2={scale.x1} y1={genesTop + genesH} y2={genesTop + genesH} className="idh__base" />
            <path d={line} className="idh__line" />
            <PartLabels name="genes" y0={genesTop} y1={genesTop + genesH} max={groupedInteger(genesMax)} />
          </g>
        )}
        <line x1={scale.x0} x2={scale.x1} y1={base} y2={base} className="idh__base" />
        {compact ? null : (
          <>
            <PartLabels name="changed" y0={base - upH} y1={base} max={groupedInteger(upMax)} />
            <PartLabels
              name="created"
              y0={base}
              y1={base + downH}
              max={groupedInteger(downMax)}
              zero={false}
              bottomMax
            />
          </>
        )}
        {fans ? (
          <>
            <line x1={scale.x0} x2={scale.x1} y1={fanMid} y2={fanMid} className="idh__base idh__base--fan" />
            {compact ? null : (
              <>
                <text x={LEFT - 6} y={fanMid - fanH + 8} textAnchor="end" className="fig-text idh__tick">
                  {groupedInteger(fanMax)}
                </text>
                <text x={LEFT - 6} y={fanMid + fanH} textAnchor="end" className="fig-text idh__tick">
                  {groupedInteger(fanMax)}
                </text>
                <text x={4} y={fanMid - 6} className="fig-text fig-text--sans idh__axis-name">
                  split
                </text>
                <text x={4} y={fanMid + 14} className="fig-text fig-text--sans idh__axis-name">
                  merge
                </text>
              </>
            )}
          </>
        ) : null}
        {compact ? null : (
          <>
            <line x1={scale.x0} x2={scale.x1} y1={keptBase} y2={keptBase} className="idh__base" />
            <PartLabels name="kept" y0={keptTop} y1={keptBase} max={groupedInteger(keptMax)} />
          </>
        )}
        {columns.map((c, i) => {
          const x = scale.x(c.release) - barW / 2;
          let y = base;
          // In share mode the three parts keep their proportions within the column's share.
          const factor = share ? (shareOf[i]?.changed ?? 0) / Math.max(1, changed(c)) : 1;
          const segment = (value: number, className: string, fill?: string) => {
            if (value <= 0) return null;
            const h = up(value * factor);
            y -= h;
            return <rect key={className} x={x} y={y} width={barW} height={h} className={className} fill={fill} />;
          };
          const created = share ? (shareOf[i]?.created ?? 0) : c.created;
          const fanValue = (v: number | null, s: number | null | undefined) =>
            sized(share ? (s ?? 0) : (v ?? 0), fanMax, fanH);
          const out = fans ? fanValue(c.fanOut, shareOf[i]?.fanOut) : 0;
          const into = fans ? fanValue(c.fanIn, shareOf[i]?.fanIn) : 0;
          const kept = compact ? 0 : sized(c.kept, keptMax, keptH);
          return (
            <g key={c.release} className="idh__col">
              {segment(c.versionChanges, "idh__version")}
              {segment(c.idChanges, "idh__id", `url(#${hatch})`)}
              {segment(c.retired, "idh__retired")}
              {!c.first && created > 0 ? (
                <rect x={x} y={base} width={barW} height={down(created)} className="idh__created" />
              ) : null}
              {out > 0 ? <rect x={x} y={fanMid - out} width={barW} height={out} className="idh__fan" /> : null}
              {into > 0 ? <rect x={x} y={fanMid} width={barW} height={into} className="idh__fan" /> : null}
              {kept > 0 ? (
                <rect
                  x={x + 0.5}
                  y={keptBase - kept + 0.5}
                  width={Math.max(0.5, barW - 1)}
                  height={Math.max(0.5, kept - 0.5)}
                  className="idh__kept"
                />
              ) : null}
            </g>
          );
        })}
        {placed.length ? (
          <g className="idh__marks" aria-hidden="true">
            {placed.map((m) => {
              const x = scale.x(m.release ?? 0);
              const y = markTop + 6 + (markRow.get(m.number) ?? 0) * 14;
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
              y={bandsTop}
              width={Math.max(scale.step, 6)}
              height={axisY - bandsTop}
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
              {shownShare.fanOut !== null && shownShare.fanIn !== null
                ? `; mapped to two or more: ${percent(shownShare.fanOut)}; receiving two or more: ${percent(shownShare.fanIn)}`
                : ""}
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
                      <span className="muted">{kindWords(m.case.kind).toLowerCase()}</span>
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
