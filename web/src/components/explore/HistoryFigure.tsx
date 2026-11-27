// The Convert page's figure: one real answer of this server, drawn as its path through the releases. The gene
// versions of the best answer lie as bars over the releases the path holds each, joined by Ensembl's steps (a dot in
// the hue of the step's kind; a diamond where the step crosses from one assembly to the next; an arc for a re-mapping
// of a gene to itself), over the assembly bands; under it, Ensembl's mapping score of each step. Every element is
// focusable with its exact values, as the api sent them. The path draws itself once, left to right (not under reduced
// motion).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GraphDescription } from "../../api/types";
import {
  figureHeight,
  previousOnLane,
  shortLabel,
  type FigureModel,
  type FigureStep,
} from "../../lib/explore/figureModel";
import { groupedInteger, pythonFloat } from "../../lib/numbers";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { assemblyBands, releaseScale } from "../figure/releases";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { placeLabels } from "../figure/labels";
import { ScoreTrack } from "../figure/ScoreTrack";
import { useRoving } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

let played = false;

/** How long a step stays in view while the path replays (ms). */
const REPLAY_STEP = 900;

/** Whether the person asked for less motion (a test's DOM without matchMedia: no). */
function prefersLessMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Item {
  key: string;
  x: number;
  y: number;
  label: string;
  /** The note, made only for the element shown. */
  note: () => ReactNode;
}

/** Releases as ranges ("50–54"), an open end as the graph's last release. */
function activeText(active: readonly [number, number | null][], last: number): string {
  return active.map(([a, b]) => (b === null ? `${a}–${last}` : a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

export function HistoryFigure({ model, description }: { model: FigureModel; description: GraphDescription }) {
  const vocabulary = useVocabulary();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [animate] = useState(() => !played);
  useEffect(() => {
    played = true;
  }, []);
  const assemblyName = useMemo(() => {
    const names = new Map(description.assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
    return (key: number | null) => (key === null ? "—" : `${names.get(key) ?? key} (${key})`);
  }, [description]);
  const releases = description.releases;
  const lastRelease = releases[releases.length - 1] ?? model.span[1];
  const phone = width < 640;
  const left = phone ? 34 : 44;
  const scale = releaseScale(releases, left, width - (phone ? 6 : 12));
  const laneY = (lane: number) => 96 + lane * 44;
  const lastLane = laneY(model.lanes - 1);
  const scoreTop = lastLane + 62;
  const scoreBottom = scoreTop + 48;
  const axisY = scoreBottom + 18;
  const height = figureHeight(model.lanes);
  const bands = assemblyBands(description);

  const laneOf = useMemo(() => new Map(model.genes.map((g) => [g.node.id, g.lane])), [model]);
  const stepLane = (s: FigureStep) => laneOf.get(s.step.target) ?? laneOf.get(s.step.source ?? "") ?? 0;
  const jointX = (s: FigureStep) => (s.hi > s.lo ? scale.x(s.lo + 0.5) : scale.x(s.lo));

  // Gene labels, by the figure grammar's placer: the first gene by its full id, each next one by its version where it
  // keeps the id (".6"); in the first of four rows (above, below, further above, further below) where it touches no
  // other label; a label with no room is left to the element's note and the caption.
  const placed = useMemo(() => {
    const offsets: Record<string, number> = { a0: -14, b0: 22, a1: -27, b1: 35 };
    const rows = phone ? ["a0", "b0"] : ["a0", "b0", "a1", "b1"];
    // The rows below one lane and above the next lie at the same height: they are one row of the placer, so that two
    // labels there never meet.
    const rowKey = (lane: number, r: string) =>
      r.startsWith("b") ? `gap${r.slice(1)}:${lane}` : lane > 0 ? `gap${r.slice(1)}:${lane - 1}` : `top${r.slice(1)}`;
    const labels = placeLabels(
      model.genes.map((g, i) => {
        // A label is read along its lane: a gene keeps only its version (".6") where the bar before it on the same lane
        // is a version of the same stable id; otherwise its whole id. The path's order can differ from a lane's (a
        // bridge joins two ids), so the bar before is found on the lane, by release.
        const previous = previousOnLane(model.genes, i)?.node.id ?? null;
        const centre = (scale.x(g.first - 0.5) + scale.x(g.last + 0.5)) / 2;
        return {
          key: String(i),
          anchor: centre,
          forms: [shortLabel(g.node.id, previous)],
          align: "center" as const,
          rows: rows.map((r) => rowKey(g.lane, r)),
          weight: i === 0 ? 600 : 400,
        };
      }),
      { bounds: [scale.x0 - scale.step / 2, scale.x1 + scale.step / 2] },
    );
    return model.genes.map((g, i) => {
      const label = labels.get(String(i));
      if (!label) return { text: "", x: 0, y: null };
      const row = rows.find((r) => rowKey(g.lane, r) === label.row) ?? "a0";
      return { text: label.text, x: label.x, y: laneY(g.lane) + (offsets[row] ?? 0) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scale changes with the width only; the model fixes the rest
  }, [model, width]);

  const hasScores = model.steps.some((s) => s.family !== "cross");

  // The elements in the order of the walk: a gene, the step that leaves it, the next gene, ...
  const items: Item[] = [];
  const geneIndex = new Map(model.genes.map((g, i) => [g.node.id, i]));
  const pushGene = (i: number) => {
    const g = model.genes[i];
    if (!g) return;
    const node = g.node;
    const held = g.first === g.last ? `release ${g.first}` : `releases ${g.first}–${g.last}`;
    const places = () =>
      node.places.map(
        (p) =>
          `${assemblyName(p.assembly)}: region ${p.region}, bases ${groupedInteger(p.start)}–${groupedInteger(p.end)}, strand ${p.strand}`,
      );
    items.push({
      key: `g${i}`,
      x: (scale.x(g.first - 0.5) + scale.x(g.last + 0.5)) / 2,
      y: laneY(g.lane),
      label: `${node.id}: on this path at ${held}; exists at releases ${activeText(node.active, lastRelease)}`,
      note: () => (
        <>
          <p className="fig-note__title mono">{node.id}</p>
          <p>
            On this path at <span className="mono">{held}</span>
          </p>
          <p>
            Exists at releases <span className="mono">{activeText(node.active, lastRelease)}</span>
          </p>
          {places().map((p) => (
            <p key={p} className="fig-note__quiet">
              {p}
            </p>
          ))}
        </>
      ),
    });
  };
  const seen = new Set<number>();
  if (model.genes.length) {
    pushGene(0);
    seen.add(0);
  }
  for (const s of model.steps) {
    const step = s.step;
    const meaning = vocabulary.stepReasons.get(step.reason) ?? null;
    const score = step.weight === null ? null : pythonFloat(step.weight);
    const releasesText =
      step.old_release !== null && step.new_release !== null
        ? `${step.old_release} → ${step.new_release}`
        : step.release !== null
          ? `release ${step.release}`
          : "—";
    items.push({
      key: `s${s.number}`,
      x: jointX(s),
      y: laneY(stepLane(s)),
      label: `Step ${s.number} of ${model.steps.length}: ${spaced(step.reason)}, ${step.source ?? ""} to ${step.target}, ${releasesText}${
        s.family === "cross" ? "" : score === null ? ", no score" : `, score ${score}`
      }${s.handoff ? `, assembly ${assemblyName(step.old_assembly)} to ${assemblyName(step.assembly)}` : ""}`,
      note: () => (
        <>
          <p className="fig-note__title">
            Step {s.number} of {model.steps.length} · {spaced(step.reason)}
          </p>
          {meaning ? <p className="fig-note__quiet">{prose(meaning)}</p> : null}
          <p className="mono">
            {step.source ?? "—"} → {step.target}
          </p>
          <p>
            {step.old_release !== null ? "Releases " : ""}
            <span className="mono">{releasesText}</span>
            {s.family === "cross" ? null : (
              <>
                {" · "}
                {score === null ? "no score" : <span className="mono">score {score}</span>}
              </>
            )}
          </p>
          {s.handoff ? (
            <p>
              Assembly <span className="mono">{assemblyName(step.old_assembly)}</span> →{" "}
              <span className="mono">{assemblyName(step.assembly)}</span>
            </p>
          ) : null}
          {step.places ? <p className="fig-note__quiet">Places: {spaced(step.places)}</p> : null}
          {step.splits || step.merges ? (
            <p className="fig-note__quiet">
              {step.splits} other split, {step.merges} other merged
            </p>
          ) : null}
          {step.databases.length ? <p className="fig-note__quiet">{step.databases.join(", ")}</p> : null}
        </>
      ),
    });
    const next = geneIndex.get(step.target);
    if (next !== undefined && !seen.has(next)) {
      pushGene(next);
      seen.add(next);
    }
  }
  model.genes.forEach((_, i) => {
    if (!seen.has(i)) pushGene(i);
  });

  // The replay: a release cursor walks the path step by step, the steps behind it in full, the releases ahead veiled,
  // the step it stands on written out under the figure. Under reduced motion it does not run by itself: each press of
  // "Next step" moves it.
  const total = model.steps.length;
  const [cursor, setCursor] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => {
        setCursor((c) => {
          const next = c === null ? 0 : c + 1;
          if (next >= total) setRunning(false);
          return Math.min(next, total);
        });
      },
      cursor === null ? 0 : REPLAY_STEP,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, cursor, total]);
  const replay = () => {
    if (running) {
      setRunning(false);
      return;
    }
    const restart = cursor === null || cursor >= total;
    if (prefersLessMotion()) {
      setCursor(restart ? 0 : cursor);
      return;
    }
    if (restart) setCursor(null);
    setRunning(true);
  };
  const cursorStep = cursor !== null && cursor < total ? model.steps[cursor] : null;
  const cursorX = cursor === null ? null : cursorStep ? jointX(cursorStep) : scale.x1 + scale.step / 2;
  const readout = (() => {
    if (cursor === null) return "";
    if (!cursorStep) {
      return `The answer at release ${model.result.to_release}: ${model.answer.target}; the candidate's score, the product of Ensembl's scores along the path, ${pythonFloat(model.answer.score)}.`;
    }
    const st = cursorStep.step;
    const releasesText =
      st.old_release !== null && st.new_release !== null
        ? `${st.old_release} → ${st.new_release}`
        : st.release !== null
          ? `release ${st.release}`
          : "";
    return `Step ${cursorStep.number} of ${total} · ${releasesText} · ${st.source ?? "—"} → ${st.target} · ${spaced(st.reason)}${
      cursorStep.family === "cross"
        ? ""
        : st.weight === null
          ? " · no score"
          : ` · Ensembl's score ${pythonFloat(st.weight)}`
    }${cursorStep.handoff ? ` · ${assemblyName(st.old_assembly)} → ${assemblyName(st.assembly)}` : ""}`;
  })();

  const svg = useCallback(() => ref.current?.querySelector("svg") ?? null, [ref]);
  const roving = useRoving(items.length, svg);
  const shown = roving.shown === null ? null : items[roving.shown];
  const itemIndex = new Map(items.map((it, i) => [it.key, i]));

  return (
    <>
      <div className={`hero-figure__plot fig${animate ? " fig-wipe" : ""}`} ref={ref} style={{ height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`The path of ${model.result.query_id} from release ${model.result.from_release ?? "—"} to ${model.result.to_release}: ${model.steps.length} steps. Arrow keys move along its genes and steps.`}
          className="hero-figure__svg"
        >
          <Bands bands={bands} scale={scale} top={0} bottom={axisY} labelY={14} outerY={30} />
          {hasScores ? (
            <ScoreTrack
              items={model.steps
                .filter((st) => st.family !== "cross")
                .map((st) => ({
                  key: String(st.number),
                  x: jointX(st),
                  weight: st.step.weight,
                  hue: st.family === "event" ? ("event" as const) : ("history" as const),
                }))}
              x0={scale.x0}
              x1={scale.x1}
              top={scoreTop}
              bottom={scoreBottom}
              labelX={scale.x0 - 6}
            />
          ) : null}
          <ReleaseTicks scale={scale} y={axisY} releases={releases} bounds={[0, width]} />

          <g className="fig-path">
            {model.genes.map((g, i) => {
              const gap = Math.min(2.5, scale.step / 4);
              const x = scale.x(g.first - 0.5) + gap;
              const w = Math.max(2, scale.x(g.last + 0.5) - scale.x(g.first - 0.5) - 2 * gap);
              const index = itemIndex.get(`g${i}`) ?? 0;
              const item = items[index];
              return (
                <g key={g.node.id} role="img" aria-label={item?.label} className="fig-target" {...roving.bind(index)}>
                  <rect x={x - 2} y={laneY(g.lane) - 12} width={w + 4} height={24} className="fig-hit" />
                  <GeneBar x0={x} x1={x + w} y={laneY(g.lane)} />
                </g>
              );
            })}
            {model.steps.map((s) => {
              const x = jointX(s);
              const y = laneY(stepLane(s));
              const index = itemIndex.get(`s${s.number}`) ?? 0;
              const item = items[index];
              const hue = s.family === "event" ? "event" : s.family === "cross" ? "external" : "history";
              const glyph: Glyph = s.handoff
                ? "handoff"
                : s.family === "self"
                  ? "loop"
                  : s.family === "event"
                    ? "event"
                    : s.family === "cross"
                      ? "read"
                      : "version";
              const mark: ReactNode =
                s.family === "cross" ? (
                  <>
                    <line x1={x} x2={x} y1={y - 22} y2={y - 5} className="fig-cross" />
                    <StepGlyph glyph="read" x={x} y={y - 26} />
                  </>
                ) : (
                  <>
                    {s.family !== "self" && s.hi - s.lo > 1 ? (
                      <line x1={scale.x(s.lo + 0.5)} x2={scale.x(s.hi - 0.5)} y1={y} y2={y} className="fig-link" />
                    ) : null}
                    <StepGlyph glyph={glyph} x={x} y={y} event={glyph === "handoff" && isEvent(s.step)} />
                  </>
                );
              return (
                <g
                  key={s.number}
                  role="img"
                  aria-label={item?.label}
                  className={`fig-target fig-hue--${hue}`}
                  {...roving.bind(index)}
                >
                  <rect x={x - 12} y={y - 30} width={24} height={42} className="fig-hit" />
                  <g className="fig-mark">{mark}</g>
                </g>
              );
            })}
          </g>

          <g className="fig-labels" aria-hidden="true">
            {placed.map((p, i) =>
              p.y === null ? null : (
                <text
                  key={i}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  className={`fig-label${i === 0 ? " fig-label--first" : ""}`}
                >
                  {p.text}
                </text>
              ),
            )}
          </g>
          {cursorX !== null ? (
            <g className="replay__marks" aria-hidden="true">
              <rect
                x={cursorX + 6}
                y={0}
                width={Math.max(0, width - cursorX - 6)}
                height={axisY}
                className="replay__veil"
              />
              <line x1={cursorX} x2={cursorX} y1={18} y2={axisY} className="replay__cursor" />
              {cursorStep ? (
                <circle cx={cursorX} cy={laneY(stepLane(cursorStep))} r={11} className="replay__ring" />
              ) : null}
            </g>
          ) : null}
          {roving.focused !== null && items[roving.focused] ? (
            <circle
              cx={items[roving.focused]?.x}
              cy={items[roving.focused]?.y}
              r={12}
              className="fig-focus"
              aria-hidden="true"
            />
          ) : null}
        </svg>
        {shown ? (
          <FigureNote x={shown.x} y={shown.y + 18} width={width} pointer={roving.note}>
            {shown.note()}
          </FigureNote>
        ) : null}
      </div>
      <div className="replay" role="group" aria-label="Replay the path">
        <button type="button" className="button replay__play" onClick={replay} aria-pressed={running}>
          {running ? "Pause" : cursor !== null && cursor < total ? "Continue" : "Replay the path"}
        </button>
        <button
          type="button"
          className="button replay__step"
          disabled={cursor === null || cursor <= 0}
          onClick={() => {
            setRunning(false);
            setCursor((c) => (c === null ? null : Math.max(0, c - 1)));
          }}
        >
          Previous step
        </button>
        <button
          type="button"
          className="button replay__step"
          disabled={cursor !== null && cursor >= total}
          onClick={() => {
            setRunning(false);
            setCursor((c) => (c === null ? 0 : Math.min(total, c + 1)));
          }}
        >
          Next step
        </button>
        <output className="replay__readout mono" aria-live="polite">
          {readout}
        </output>
      </div>
    </>
  );
}
