// A case's answer as a small figure, in the figure grammar (components/figure/). A case lies on a short stretch of the
// graph's releases: the sketch draws that stretch, zoomed, under an overview strip of the whole axis (the graph's first
// and last release, its assembly changes) on which the stretch is marked and from which two hairlines open to the
// zoomed view, so every card says where on one shared scale it sits. In the view, as the answer holds it: the assembly
// bands; the best answer's path as a thin bar with its steps' glyphs, from the release read at (open circle) to the
// release asked (square); the genes that also descend from the identifier (a split's other descendants), or that tie
// with the best, on rows of their own from where their path leaves the best one's, and how many more there are; a
// refused step as a short line that stops; a bridge's crossing dashed; a reading at one release as the crossing it is,
// in one column; a name with another meaning as two lanes, each named with its releases (the gene it names at the
// release read, and, pale, the gene it meant at others); a gene that answers nothing as its life ending in a bar at
// its last release, a dotted wait to the release asked and an empty square there. The sketch is as tall as what it
// draws (lib/explore/sketch.ts, `sketchLayout`). Nothing is drawn that the answer does not hold. The drawing is an
// image: its accessible name says what it shows, and the card's words say it again.
import { useEffect, useState } from "react";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { candidateSteps, isEnsembl, marksOf } from "../../lib/home/journeyModel";
import { clearEnds } from "../../lib/home/rowMarks";
import { releaseRanges } from "../../lib/numbers";
import {
  activeRuns,
  genesNotDrawn,
  SKETCH,
  sketchLayout,
  sketchRows,
  sketchWindow,
  type SketchLayout,
} from "../../lib/explore/sketch";
import { ReleaseTicks, Bands } from "../figure/axis";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { middleCut, textWidth } from "../figure/labels";
import { assemblyBands, releaseScale, type ReleaseScale } from "../figure/releases";
import { useWidth } from "../figure/useWidth";

const ROW_GLYPH: Partial<Record<string, Glyph>> = {
  version: "version",
  event: "event",
  loop: "loop",
  handoff: "handoff",
};

/** The life of a gene the answer reaches nothing from: its id and the releases at which it exists (its `active`
 *  ranges, read by converting the identifier at the release it is read at). */
export interface SketchLife {
  gene: string;
  active: [number, number | null][];
}

/** Whether the page has had time to draw what comes first: a figure below the fold is drawn when the browser is idle
 *  after the first paint (in the room held for it), so the first screen is not kept waiting. */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(
        () => {
          setReady(true);
        },
        { timeout: 600 },
      );
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(() => {
      setReady(true);
    }, 120);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

/** Runs of consecutive releases of `axis` that `releases` fill. */
function runsIn(axis: readonly number[], releases: readonly number[]): [number, number][] {
  const held = new Set(releases);
  const runs: [number, number][] = [];
  for (const r of axis) {
    if (!held.has(r)) continue;
    const last = runs[runs.length - 1];
    const previous = axis[axis.indexOf(r) - 1];
    if (last && previous === last[1]) last[1] = r;
    else runs.push([r, r]);
  }
  return runs;
}

const CLEAR = 9;

/** The overview's line stands this far in from the drawing's edges, its end releases `OVERVIEW_GAP` outside its ends:
 *  a hairline that opens from the stretch at an end passes at least 4 px from them. */
const OVERVIEW_INSET = 36;
const OVERVIEW_GAP = 12;

/** The words above a lane: `lead` (releases) then an identifier, the identifier cut in its middle where the line is too
 *  short (never the releases), set from `x` towards the side with room, inside [lo, hi]. */
function laneWords(lead: string, id: string, symbol: string | null, x: number, lo: number, hi: number) {
  const tail = symbol ? ` (${symbol})` : "";
  const room = hi - lo;
  const fixed = textWidth(`${lead} ${tail}`);
  const per = textWidth("0");
  const fits = middleCut(id, Math.floor((room - fixed) / per));
  const text = fits === null ? lead : `${lead} ${fits}${tail}`;
  const w = textWidth(text);
  const start = Math.max(lo, Math.min(x, hi - w));
  return { text, x: start };
}

/** The overview strip: the graph's whole axis, its assembly changes, the stretch drawn marked on it, and two solid
 *  hairlines that open from the stretch to the view (ending at the view's top, clear of every label). */
function Overview({
  all,
  bands,
  scale,
  width,
  lo,
  hi,
}: {
  all: readonly number[];
  bands: ReturnType<typeof assemblyBands>;
  scale: ReleaseScale;
  width: number;
  lo: number;
  hi: number;
}) {
  const { OVERVIEW_Y: y, OVERVIEW_TEXT_Y: ty, VIEW_TOP } = SKETCH;
  const firstAll = all[0] ?? 0;
  const lastAll = all[all.length - 1] ?? 0;
  const overview = releaseScale(all, OVERVIEW_INSET, width - OVERVIEW_INSET);
  const whole = lo === firstAll && hi === lastAll;
  const a = overview.x(lo - 0.5);
  const b = overview.x(hi + 0.5);
  return (
    <g className="case-sketch__overview" aria-hidden="true">
      <text x={overview.x0 - OVERVIEW_GAP} y={ty} textAnchor="end" className="fig-axis__label">
        {firstAll}
      </text>
      <text x={overview.x1 + OVERVIEW_GAP} y={ty} textAnchor="start" className="fig-axis__label">
        {lastAll}
      </text>
      <line x1={overview.x0} x2={overview.x1} y1={y} y2={y} className="case-sketch__axis" />
      {bands.slice(1).map((band) => (
        <line
          key={band.first}
          x1={overview.x(band.first - 0.5)}
          x2={overview.x(band.first - 0.5)}
          y1={y - 3}
          y2={y + 3}
          className="case-sketch__change"
        />
      ))}
      <rect x={a} y={y - 2} width={Math.max(3, b - a)} height={4} className="case-sketch__window" />
      {whole ? null : (
        <>
          {/* Down from the stretch's ends until clear of the written releases, then open to the view's top corners. */}
          <polyline
            points={`${a},${y + 2} ${a},${ty + 7} ${scale.x0},${VIEW_TOP - 4}`}
            className="case-sketch__zoom"
          />
          <polyline
            points={`${b},${y + 2} ${b},${ty + 7} ${scale.x1},${VIEW_TOP - 4}`}
            className="case-sketch__zoom"
          />
        </>
      )}
    </g>
  );
}

export function CaseSketch({
  result,
  graph,
  label,
  life = null,
  symbols = null,
}: {
  result: ConversionResult;
  graph: GraphDescription;
  label: string;
  /** For an answer that reaches nothing: the life of the gene the identifier names where it is read. */
  life?: SketchLife | null;
  /** The symbols of the Ensembl genes the card names, by id (where the name authority gives one). */
  symbols?: ReadonlyMap<string, readonly string[]> | null;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(320);
  const near = useAfterFirstPaint();
  const all = graph.releases;
  const lastAll = all[all.length - 1] ?? result.to_release;
  const lived = life ? activeRuns(life.active, lastAll) : [];
  const releases = sketchWindow(result, all, lived.flat());
  const scale = releaseScale(releases, 8, width - 8);
  const bands = assemblyBands(graph);
  const layout: SketchLayout = sketchLayout(result);
  const { VIEW_TOP } = SKETCH;
  const lo = releases[0] ?? all[0] ?? 0;
  const hi = releases[releases.length - 1] ?? lastAll;
  return (
    <div className="case-sketch fig" ref={ref} style={{ height: layout.height }}>
      {near ? (
        <svg width={width} height={layout.height} role="img" aria-label={label} className="case-sketch__svg">
          <Overview all={all} bands={bands} scale={scale} width={width} lo={lo} hi={hi} />
          <Bands
            bands={bands}
            scale={scale}
            top={VIEW_TOP}
            bottom={layout.axisY - 2}
            labelY={VIEW_TOP + 12}
            view={[0, width]}
          />
          <ReleaseTicks scale={scale} y={layout.axisY} releases={releases} bounds={[0, width]} />
          {layout.form === "ended" ? (
            <Ended result={result} scale={scale} layout={layout} life={life} lived={lived} width={width} />
          ) : layout.form === "meaning" ? (
            <Meaning result={result} scale={scale} layout={layout} releases={releases} symbols={symbols} />
          ) : layout.form === "crossing" ? (
            <Crossing result={result} scale={scale} layout={layout} />
          ) : (
            <Paths result={result} scale={scale} layout={layout} lo={lo} hi={hi} />
          )}
        </svg>
      ) : null}
    </div>
  );
}

/** A gene that answers nothing at the release asked: the releases it exists at as its bar (within the view), the
 *  release read on it, a terminal bar at its last release, a dotted wait to the release asked and an empty square
 *  there; above, its id with its releases, and "none at" the release asked at the right. */
function Ended({
  result,
  scale,
  layout,
  life,
  lived,
  width,
}: {
  result: ConversionResult;
  scale: ReleaseScale;
  layout: SketchLayout;
  life: SketchLife | null;
  lived: [number, number][];
  width: number;
}) {
  const y = layout.rows[0] ?? SKETCH.TOP;
  const from = result.from_release;
  const to = result.to_release;
  if (from === null) return null;
  const inView = lived
    .map(([a, b]) => [Math.max(a, scale.releases[0] ?? a), Math.min(b, to)] as [number, number])
    .filter(([a, b]) => a <= b);
  const end = inView.length ? Math.max(...inView.map(([, b]) => b)) : from;
  const capX = scale.x(end + 0.5) - 1;
  const endWords = `none at ${to}`;
  const endW = textWidth(endWords);
  const words = life
    ? laneWords(releaseRanges(lived.flatMap(([a, b]) => range(a, b))), life.gene, null, 8, 8, width - 8 - endW - 12)
    : null;
  return (
    <g className="case-sketch__ended">
      {inView.map(([a, b]) => (
        <GeneBar key={a} x0={scale.x(a - 0.5) + 1} x1={scale.x(b + 0.5) - 1} y={y} size="thin" />
      ))}
      {life ? null : <line x1={scale.x(from)} x2={capX} y1={y} y2={y} className="case-sketch__stop" />}
      <line x1={capX} x2={capX} y1={y - 5} y2={y + 5} className="case-sketch__cap" />
      <line x1={capX + 4} x2={scale.x(to) - 5} y1={y} y2={y} className="jr-wait" />
      <StepGlyph glyph="form" x={Math.min(scale.x(from), capX - CLEAR)} y={y} size="thin" />
      <rect x={scale.x(to) - 3} y={y - 3} width={6} height={6} className="case-sketch__empty" />
      {words ? (
        <text x={words.x} y={y - 10} className="fig-text case-sketch__words">
          {words.text}
        </text>
      ) : null}
      <text x={width - 8} y={y - 10} textAnchor="end" className="fig-text case-sketch__words">
        {endWords}
      </text>
    </g>
  );
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** A name with another meaning: two lanes on the release axis, each the releases at which the string names a gene,
 *  named above it with those releases. The first, ink, the gene it names at the release read (the answer); the second,
 *  pale, the gene it meant at other releases (the reading the answer reports beside it). */
function Meaning({
  result,
  scale,
  layout,
  releases,
  symbols,
}: {
  result: ConversionResult;
  scale: ReleaseScale;
  layout: SketchLayout;
  releases: readonly number[];
  symbols: ReadonlyMap<string, readonly string[]> | null;
}) {
  const other = result.other_readings.find((o) => o.reason === "other_release" && o.releases.length);
  const best = result.candidates.find((c) => c.best);
  const read = result.from_release ?? result.to_release;
  const [y0 = SKETCH.TOP, y1 = SKETCH.TOP + SKETCH.LANE_PITCH] = layout.rows;
  const lo = scale.x0 - scale.step / 2;
  const hi = scale.x1 + scale.step / 2;
  const lane = (runs: [number, number][], y: number, className: string) =>
    runs.map(([a, b]) => (
      <rect
        key={a}
        x={scale.x(a - 0.5) + 1}
        y={y - 3}
        width={Math.max(3, scale.x(b + 0.5) - scale.x(a - 0.5) - 2)}
        height={6}
        className={className}
      />
    ));
  const otherRuns = other ? runsIn(releases, other.releases) : [];
  const symbol = (id: string) => symbols?.get(id)?.join(", ") ?? null;
  const first = best ? laneWords(`${read}:`, best.gene, symbol(best.gene), scale.x(read) - 12, lo, hi) : null;
  const otherGene = other?.genes[0] ?? null;
  const second =
    other && otherGene
      ? laneWords(`${releaseRanges(other.releases)}:`, otherGene, null, scale.x(otherRuns[0]?.[0] ?? lo) - 2, lo, hi)
      : null;
  return (
    <g className="case-sketch__meaning">
      {lane([[read, read]], y0, "case-sketch__meant")}
      {lane(otherRuns, y1, "case-sketch__other")}
      {first ? (
        <text x={first.x} y={y0 - 8} className="fig-text case-sketch__words case-sketch__words--strong">
          {first.text}
        </text>
      ) : null}
      {second ? (
        <text x={second.x} y={y1 - 8} className="fig-text case-sketch__words">
          {second.text}
        </text>
      ) : null}
    </g>
  );
}

/** A reading at one release: the identifier read (in its database), the gene it names, the answer's id, in one
 *  column. */
function Crossing({ result, scale, layout }: { result: ConversionResult; scale: ReleaseScale; layout: SketchLayout }) {
  const best = result.candidates.find((c) => c.best);
  if (!best) return null;
  const x = scale.x(result.to_release);
  const readExternal = result.from_databases.some((d) => !isEnsembl(d));
  const external = result.final_database !== null && !isEnsembl(result.final_database);
  const ys = layout.rows;
  return (
    <g>
      <line x1={x} x2={x} y1={ys[0]} y2={ys[ys.length - 1]} className="fig-cross" />
      <StepGlyph glyph={readExternal ? "read" : "form"} x={x} y={ys[0] ?? 0} size="thin" />
      {external ? (
        <>
          <circle cx={x} cy={ys[1]} r={2.6} className="case-sketch__gene" />
          <StepGlyph glyph="final" x={x} y={ys[2] ?? 0} size="thin" />
        </>
      ) : (
        <rect x={x - 3} y={(ys[1] ?? 0) - 3} width={6} height={6} className="jr-end" />
      )}
    </g>
  );
}

/** The best path and the other genes' rows, with "+N more genes" and the refused steps. */
function Paths({
  result,
  scale,
  layout,
  lo,
  hi,
}: {
  result: ConversionResult;
  scale: ReleaseScale;
  layout: SketchLayout;
  lo: number;
  hi: number;
}) {
  const rows = sketchRows(result);
  const from = result.from_release;
  const to = result.to_release;
  const y = (r: number) => layout.rows[r] ?? SKETCH.TOP + r * SKETCH.PITCH;
  const more = genesNotDrawn(result);
  const refused = (result.path?.refused ?? []).filter((s) => s.old_release !== null && s.new_release !== null);
  return (
    <>
      {rows.map((row, r) => {
        const candidate = result.candidates[row.candidate];
        if (!candidate) return null;
        const marks = marksOf(candidateSteps(result, candidate), to);
        const own = marks.slice(row.from);
        const start = r === 0 ? (from ?? to) : (own[0]?.at ?? from ?? to);
        const glyphXs = own.filter((m) => m.kind === "bridge" || ROW_GLYPH[m.kind]).map((m) => scale.x(m.at));
        const ends =
          r === 0
            ? clearEnds(scale.x(start), scale.x(to), glyphXs, CLEAR)
            : { start: scale.x(start), end: scale.x(to) };
        const xs = [ends.start, ends.end, ...own.map((m) => scale.x(m.at))];
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const yy = y(r);
        const strong = row.strong;
        const bridge = own.filter((m) => m.kind === "bridge");
        return (
          <g key={row.candidate} className={strong ? "" : "case-sketch__weak"}>
            {r > 0 ? (
              <line x1={scale.x(start)} x2={scale.x(start)} y1={y(0)} y2={yy} className="case-sketch__branch" />
            ) : null}
            <GeneBar x0={x0} x1={x1} y={yy} size="thin" strong={strong} />
            {bridge.length >= 2 ? (
              <line
                x1={scale.x(bridge[0]?.at ?? lo)}
                x2={scale.x(bridge[bridge.length - 1]?.at ?? hi)}
                y1={yy}
                y2={yy}
                className="fig-cross case-sketch__bridge"
              />
            ) : null}
            {r === 0 && from !== null ? (
              <StepGlyph
                glyph={result.from_databases.some((d) => !isEnsembl(d)) ? "read" : "form"}
                x={ends.start}
                y={yy}
                size="thin"
              />
            ) : null}
            {own.map((m) => {
              if (m.kind === "bridge" && m.step.kind !== "bridge_near") return null;
              const glyph = m.kind === "bridge" ? "bridge" : m.kind === "final" ? null : ROW_GLYPH[m.kind];
              return glyph ? (
                <StepGlyph
                  key={m.number}
                  glyph={glyph}
                  x={scale.x(m.at)}
                  y={yy}
                  size="thin"
                  strong={strong}
                  event={glyph === "handoff" && isEvent(m.step)}
                />
              ) : null;
            })}
            {result.final_database !== null &&
            !isEnsembl(result.final_database) &&
            own.some((m) => m.kind === "final") ? (
              <StepGlyph glyph="final" x={ends.end} y={yy} size="thin" strong={strong} />
            ) : (
              <rect
                x={ends.end - 3}
                y={yy - 3}
                width={6}
                height={6}
                className={strong ? "jr-end" : "jr-end case-sketch__end--weak"}
              />
            )}
          </g>
        );
      })}
      {more > 0 && layout.more !== null ? (
        <text x={scale.x1} y={layout.more + 4} textAnchor="end" className="fig-text fig-text--sans case-sketch__more">
          {`+${more} more ${more === 1 ? "gene" : "genes"}`}
        </text>
      ) : null}
      {refused.map((s, i) => {
        const x = scale.x(((s.old_release ?? 0) + (s.new_release ?? 0)) / 2);
        const yy = SKETCH.TOP + Math.min(2, rows.length) * SKETCH.PITCH;
        return (
          <g key={i} className="case-sketch__refused">
            <line x1={x} x2={x} y1={y(0) + 3} y2={yy} />
            <line x1={x - 4} x2={x + 4} y1={yy} y2={yy} />
          </g>
        );
      })}
    </>
  );
}
