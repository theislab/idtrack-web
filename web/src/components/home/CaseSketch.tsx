// A case's answer as a small figure, in the figure grammar (components/figure/). A case lies on a short stretch of the
// graph's releases: the sketch draws that stretch, zoomed, under an overview strip of the whole axis (the graph's first
// and last release, its assembly changes) on which the stretch is marked and from which two hairlines open to the
// zoomed view, so every card says where on one shared scale it sits. In the view: the assembly bands; the best answer's
// path as a thin bar with its steps' glyphs, from the release read at (open circle) to the release asked (square); the
// genes that also descend from the identifier (a split's other descendants), or that tie with the best, on rows of their
// own from where their path leaves the best one's, and how many more there are; a refused step as a short line that
// stops; a bridge's crossing dashed; a reading at one release as the crossing it is, in one column; the releases at
// which the string meant another gene on a lane of their own; an answer that reaches nothing as a line that stops.
// Nothing is drawn that the answer does not hold. The drawing is an image: its accessible name says what it shows, and
// the card's words say it again.
import { useEffect, useState } from "react";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { candidateSteps, isEnsembl, marksOf } from "../../lib/home/journeyModel";
import { clearEnds } from "../../lib/home/rowMarks";
import { atOneRelease, genesNotDrawn, SKETCH_HEIGHT, sketchRows, sketchWindow } from "../../lib/home/sketch";
import { ReleaseTicks, Bands } from "../figure/axis";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { assemblyBands, releaseScale } from "../figure/releases";
import { useWidth } from "../figure/useWidth";

const ROW_GLYPH: Partial<Record<string, Glyph>> = {
  version: "version",
  event: "event",
  loop: "loop",
  handoff: "handoff",
};

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

/** The view's top (the bands), the first row's line and the rows' pitch. */
const VIEW_TOP = 18;
const TOP = 46;
const PITCH = 16;
const CLEAR = 9;

export function CaseSketch({
  result,
  graph,
  label,
}: {
  result: ConversionResult;
  graph: GraphDescription;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(320);
  const near = useAfterFirstPaint();
  const all = graph.releases;
  const releases = sketchWindow(result, all);
  const scale = releaseScale(releases, 8, width - 8);
  const bands = assemblyBands(graph);
  const rows = sketchRows(result);
  const y = (r: number) => TOP + r * PITCH;
  const from = result.from_release;
  const to = result.to_release;
  const refused = (result.path?.refused ?? []).filter((s) => s.old_release !== null && s.new_release !== null);
  const axisY = SKETCH_HEIGHT - 24;
  const more = genesNotDrawn(result);
  const oneRelease = atOneRelease(result);
  const other = result.other_readings.find((o) => o.reason === "other_release" && o.releases.length);
  // The overview: the whole axis between its first and last release, the stretch drawn marked on it.
  const firstAll = all[0] ?? 0;
  const lastAll = all[all.length - 1] ?? 0;
  const overview = releaseScale(all, 30, width - 30);
  const lo = releases[0] ?? firstAll;
  const hi = releases[releases.length - 1] ?? lastAll;
  const whole = lo === firstAll && hi === lastAll;
  return (
    <div className="case-sketch fig" ref={ref} style={{ height: SKETCH_HEIGHT }}>
      {near ? (
        <svg width={width} height={SKETCH_HEIGHT} role="img" aria-label={label} className="case-sketch__svg">
          <g className="case-sketch__overview" aria-hidden="true">
            <text x={overview.x0 - 6} y={9} textAnchor="end" className="fig-axis__label">
              {firstAll}
            </text>
            <text x={overview.x1 + 6} y={9} textAnchor="start" className="fig-axis__label">
              {lastAll}
            </text>
            <line x1={overview.x0} x2={overview.x1} y1={5.5} y2={5.5} className="case-sketch__axis" />
            {bands.slice(1).map((b) => (
              <line
                key={b.first}
                x1={overview.x(b.first - 0.5)}
                x2={overview.x(b.first - 0.5)}
                y1={2.5}
                y2={8.5}
                className="case-sketch__change"
              />
            ))}
            <rect
              x={overview.x(lo - 0.5)}
              y={3.5}
              width={Math.max(3, overview.x(hi + 0.5) - overview.x(lo - 0.5))}
              height={4}
              className="case-sketch__window"
            />
            {whole ? null : (
              <>
                <line
                  x1={overview.x(lo - 0.5)}
                  x2={scale.x0 - scale.step / 2}
                  y1={8}
                  y2={VIEW_TOP}
                  className="case-sketch__zoom"
                />
                <line
                  x1={overview.x(hi + 0.5)}
                  x2={scale.x1 + scale.step / 2}
                  y1={8}
                  y2={VIEW_TOP}
                  className="case-sketch__zoom"
                />
              </>
            )}
          </g>
          <Bands
            bands={bands}
            scale={scale}
            top={VIEW_TOP}
            bottom={axisY - 2}
            labelY={VIEW_TOP + 11}
            view={[0, width]}
          />
          <ReleaseTicks scale={scale} y={axisY} releases={releases} bounds={[0, width]} />
          {rows.length === 0 && from !== null ? (
            // An answer that reaches nothing: the identifier read, its line stopping, nothing at the release asked.
            <g className="case-sketch__none">
              <line
                x1={scale.x(from)}
                x2={scale.x(from) + 10}
                y1={y(0)}
                y2={y(0)}
                className="fig-gene--thin case-sketch__stop"
              />
              <line
                x1={scale.x(from) + 10}
                x2={scale.x(from) + 10}
                y1={y(0) - 4}
                y2={y(0) + 4}
                className="case-sketch__cap"
              />
              <line x1={scale.x(from) + 14} x2={scale.x(to) - 5} y1={y(0)} y2={y(0)} className="jr-wait" />
              <StepGlyph glyph="form" x={scale.x(from)} y={y(0)} size="thin" />
              <rect x={scale.x(to) - 3} y={y(0) - 3} width={6} height={6} className="case-sketch__empty" />
            </g>
          ) : null}
          {oneRelease
            ? (() => {
                // A reading at one release: the identifier read (in its database), the gene it names, the answer's id.
                const best = result.candidates.find((c) => c.best);
                const x = scale.x(to);
                const readExternal = result.from_databases.some((d) => !isEnsembl(d));
                const external = result.final_database !== null && !isEnsembl(result.final_database);
                const ys = external ? [y(0) - 6, y(1) - 2, y(2) + 2] : [y(0) - 4, y(1) + 4];
                return best ? (
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
                ) : null;
              })()
            : rows.map((row, r) => {
                const candidate = result.candidates[row.candidate];
                if (!candidate) return null;
                const steps = candidateSteps(result, candidate);
                const marks = marksOf(steps, to);
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
          {more > 0 && !oneRelease ? (
            <text
              x={scale.x1}
              y={y(Math.min(rows.length, 3)) + 4}
              textAnchor="end"
              className="fig-text fig-text--sans case-sketch__more"
            >
              {`+${more} more ${more === 1 ? "gene" : "genes"}`}
            </text>
          ) : null}
          {other
            ? runsIn(releases, other.releases).map(([a, b]) => {
                const yy = y(Math.max(1, rows.length));
                return (
                  <rect
                    key={a}
                    x={scale.x(a - 0.5) + 1}
                    y={yy - 2.5}
                    width={Math.max(2, scale.x(b + 0.5) - scale.x(a - 0.5) - 2)}
                    height={5}
                    className="case-sketch__other"
                  />
                );
              })
            : null}
          {refused.map((s, i) => {
            const x = scale.x(((s.old_release ?? 0) + (s.new_release ?? 0)) / 2);
            const yy = y(Math.min(2, rows.length));
            return (
              <g key={i} className="case-sketch__refused">
                <line x1={x} x2={x} y1={y(0) + 3} y2={yy} />
                <line x1={x - 4} x2={x + 4} y1={yy} y2={yy} />
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
