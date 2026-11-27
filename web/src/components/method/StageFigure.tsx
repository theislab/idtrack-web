// The Method page's figure of one real answer's path (stages b and c), in the figure grammar of every page: the gene
// versions of the best answer as bars over the releases the path holds each, one lane per stable id (named in the
// gutter; each bar labelled by its version, so that every label resolves to its lane's id), Ensembl's steps drawn by
// kind where the old version ends and the new one begins, the identifier read through its Ensembl forms (an open circle
// over the gene it is read as), a bridge's shared id between the two genes it joins (an open square with a dot), the
// answer's id in the database asked (a filled square); under the lanes, Ensembl's score of each history step. The
// drawing is fitted to the path: a window of its releases with a margin (lib/method/stageFigure.ts), and an overview
// strip of the graph's whole axis above it showing where the window lies. Every gene and step is focusable with its
// exact values, as the api sent them.
import { useCallback, useId, useMemo, type ReactNode } from "react";
import type { ConversionResult, GraphDescription } from "../../api/types";
import { figureModel, type FigureStep } from "../../lib/home/figureModel";
import { stageModel, stepLanes, versionOf, type StageModel } from "../../lib/method/stageFigure";
import { groupedInteger, pythonFloat } from "../../lib/numbers";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { isEvent, type Glyph } from "../figure/glyph";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { FigureLegend, type LegendEntry } from "../figure/Legend";
import { assemblyBands, releaseScale } from "../figure/releases";
import { ScoreTrack } from "../figure/ScoreTrack";
import { useRoving } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

interface Item {
  key: string;
  x: number;
  y: number;
  label: string;
  note: () => ReactNode;
}

const OVERVIEW = 30;
const LANE = 52;

function glyphOfStep(s: FigureStep): Glyph {
  if (s.handoff) return "handoff";
  if (s.family === "self") return "loop";
  if (s.family === "event") return "event";
  return "version";
}

function releasesText(s: FigureStep): string {
  const step = s.step;
  if (step.old_release !== null && step.new_release !== null) return `${step.old_release} → ${step.new_release}`;
  return step.release !== null ? `release ${step.release}` : "—";
}

/** The legend entries of the marks a figure draws, and only those. */
function stageLegend(stage: StageModel): LegendEntry[] {
  const steps = stage.model.steps;
  const has = (test: (s: FigureStep) => boolean) => steps.some(test);
  const entries: LegendEntry[] = [
    {
      key: "gene",
      glyph: "gene",
      text: "A gene version, over the releases the path holds it; its lane is its stable id",
    },
  ];
  if (has((s) => s.step.kind === "entry"))
    entries.push({
      key: "form",
      glyph: "form",
      text: "The identifier, read through its Ensembl forms as the gene below it",
    });
  if (has((s) => s.family === "history" && !s.handoff))
    entries.push({ key: "version", glyph: "version", text: "A new version or a replacement" });
  if (has((s) => s.family === "event" && !s.handoff))
    entries.push({ key: "event", glyph: "event", text: "A split or a merge" });
  if (has((s) => s.family === "self" && !s.handoff))
    entries.push({ key: "loop", glyph: "loop", text: "A re-mapping of a gene to itself" });
  if (has((s) => s.handoff))
    entries.push({
      key: "handoff",
      glyph: "handoff",
      event: has((s) => s.handoff && isEvent(s.step)),
      text: has((s) => s.handoff && isEvent(s.step))
        ? "A step across an assembly change; the dot inside: it is also a split or a merge"
        : "A step across an assembly change",
    });
  if (has((s) => s.step.splits + s.step.merges > 0))
    entries.push({
      key: "others",
      swatch: (
        <svg className="fig-swatch" width={30} height={16} viewBox="0 0 30 16" aria-hidden="true">
          <line x1={8} x2={24} y1={8} y2={3} className="stage-fig__other" />
          <line x1={8} x2={24} y1={8} y2={13} className="stage-fig__other" />
        </svg>
      ),
      text: "Another id that took part in the split or merge (Ensembl's history counts it; the answer names it not)",
    });
  if (has((s) => s.step.kind === "bridge_near"))
    entries.push({ key: "bridge", glyph: "bridge", text: "The id a bridge passes through, which both genes carried" });
  if (has((s) => s.step.kind === "final"))
    entries.push({ key: "final", glyph: "final", text: "The answer's id in the database asked" });
  return entries;
}

export function StageFigure({ result, graph }: { result: ConversionResult; graph: GraphDescription }) {
  const model = useMemo(() => figureModel(result), [result]);
  if (!model) return <p className="muted">The answer holds no path to draw.</p>;
  return <StageDrawing stage={stageModel(model, graph)} graph={graph} />;
}

function StageDrawing({ stage, graph }: { stage: StageModel; graph: GraphDescription }) {
  const vocabulary = useVocabulary();
  const clip = useId().replace(/:/g, "");
  const { ref, width } = useWidth<HTMLDivElement>(900);
  const { model, window, lanes } = stage;
  const phone = width < 640;
  const gutter = phone ? 36 : 168;
  const x0 = gutter;
  const x1 = width - 10;
  const scale = releaseScale(window, x0, x1);
  const overview = releaseScale(graph.releases, x0, x1);
  const bands = assemblyBands(graph);
  const top = OVERVIEW + 44;
  const laneY = (lane: number) => top + 20 + lane * (phone ? LANE + 14 : LANE);
  const lastLane = laneY(lanes.length - 1);
  const history = model.steps.filter((s) => s.family !== "cross");
  const scoreTop = lastLane + 34;
  const scoreBottom = scoreTop + 40;
  const axisY = (history.length ? scoreBottom : lastLane + 24) + 14;
  const height = axisY + 26;
  const lastRelease = graph.releases[graph.releases.length - 1] ?? model.span[1];
  const names = new Map(graph.assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
  const assemblyName = (key: number | null) => (key === null ? "—" : `${names.get(key) ?? key} (${key})`);
  const barX = (first: number) => scale.x(first - 0.5) + 2;
  const barEnd = (last: number) => scale.x(last + 0.5) - 2;
  const jointX = (s: FigureStep) => (s.hi > s.lo ? scale.x(s.lo + 0.5) : scale.x(s.lo));

  // The marks, in the order of the walk, each an element of the figure with its note.
  const items: Item[] = [];
  const marks: ReactNode[] = [];
  model.genes.forEach((g, i) => {
    const lane = stage.laneOf.get(g.node.id) ?? 0;
    const held = g.first === g.last ? `release ${g.first}` : `releases ${g.first}–${g.last}`;
    const active = g.node.active
      .map(([a, b]) => (b === null ? `${a}–${lastRelease}` : a === b ? `${a}` : `${a}–${b}`))
      .join(", ");
    items.push({
      key: `g${i}`,
      x: (barX(g.first) + barEnd(g.last)) / 2,
      y: laneY(lane),
      label: `${g.node.id}: on this path at ${held}; exists at releases ${active}`,
      note: () => (
        <>
          <p className="fig-note__title mono">{g.node.id}</p>
          <p>
            On this path at <span className="mono">{held}</span>
          </p>
          <p>
            Exists at releases <span className="mono">{active}</span>
          </p>
          {g.node.places.map((p) => (
            <p key={`${p.assembly}-${p.region}-${p.start}`} className="fig-note__quiet">
              {assemblyName(p.assembly)}: region {p.region}, bases {groupedInteger(p.start)}–{groupedInteger(p.end)},
              strand {p.strand}
            </p>
          ))}
        </>
      ),
    });
  });
  let bridgeNode: { x: number; y: number; id: string } | null = null;
  model.steps.forEach((s) => {
    const step = s.step;
    const meaning = vocabulary.stepReasons.get(step.reason) ?? null;
    const { from, to } = stepLanes(stage, s);
    let x = jointX(s);
    let y = laneY(to ?? from ?? 0);
    if (step.kind === "entry") {
      // The identifier read through its forms: one open circle over the gene it is read as, at the release read.
      const gene = stage.laneOf.has(step.target);
      if (!gene) return;
      x = scale.x(step.release ?? model.span[0]);
      y = laneY(to ?? 0) - 24;
    } else if (step.kind === "bridge_near" || step.kind === "bridge_far") {
      const near = model.steps.find((t) => t.step.kind === "bridge_near" && t.step.target === step.target) ?? s;
      const far = model.steps.find((t) => t.step.kind === "bridge_far" && t.step.source === near.step.target) ?? s;
      const a = stepLanes(stage, near).from ?? 0;
      const b = stepLanes(stage, far).to ?? 0;
      const ra = near.step.release ?? 0;
      const rb = far.step.release ?? 0;
      x = scale.x((ra + rb) / 2);
      y = (laneY(a) + laneY(b)) / 2;
      if (step.kind === "bridge_far") return; // drawn with its near end, once
      bridgeNode = { x, y, id: step.target };
    } else if (step.kind === "final") {
      x = Math.min(x1 - 4, barEnd(step.release ?? model.span[1]) + 10);
      y = laneY(from ?? 0);
    }
    const score = step.weight === null ? null : pythonFloat(step.weight);
    items.push({
      key: `s${s.number}`,
      x,
      y,
      label: `Step ${s.number} of ${model.steps.length}: ${spaced(step.reason)}, ${step.source ?? ""} to ${step.target}, ${releasesText(s)}${
        s.family === "cross" ? "" : score === null ? ", no score" : `, score ${score}`
      }`,
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
            <span className="mono">{releasesText(s)}</span>
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
          {step.splits || step.merges ? (
            <p className="fig-note__quiet">
              {step.splits} other split, {step.merges} other merged
            </p>
          ) : null}
          {step.databases.length ? <p className="fig-note__quiet">{step.databases.join(", ")}</p> : null}
        </>
      ),
    });
  });

  const svg = useCallback(() => ref.current?.querySelector("svg") ?? null, [ref]);
  const roving = useRoving(items.length, svg);
  const shown = roving.shown === null ? null : items[roving.shown];
  const bind = (key: string) => {
    const index = items.findIndex((it) => it.key === key);
    return index < 0 ? {} : { ...roving.bind(index), role: "img" as const, "aria-label": items[index]?.label };
  };

  // Steps along one lane and between lanes.
  model.steps.forEach((s) => {
    const step = s.step;
    const { from, to } = stepLanes(stage, s);
    if (s.family !== "cross") {
      const x = jointX(s);
      const ya = laneY(from ?? 0);
      const yb = laneY(to ?? 0);
      const glyph = glyphOfStep(s);
      const hue = s.handoff ? "handoff" : s.family === "event" ? "event" : "history";
      marks.push(
        <g key={`s${s.number}`} className={`fig-target fig-hue--${hue}`} {...bind(`s${s.number}`)}>
          <rect x={x - 12} y={Math.min(ya, yb) - 16} width={24} height={Math.abs(yb - ya) + 32} className="fig-hit" />
          <g className="fig-mark">
            {ya !== yb ? <line x1={x} x2={x} y1={ya} y2={yb} className="fig-link" /> : null}
            {/* The other ids of a split (toward the later releases) or a merge (from the earlier ones), at most three:
                the api counts them and names none. */}
            {Array.from({ length: Math.min(3, step.splits) }, (_, k) => (
              <line key={`sp${k}`} x1={x + 4} x2={x + 20} y1={yb} y2={yb + 9 + k * 6} className="stage-fig__other" />
            ))}
            {Array.from({ length: Math.min(3, step.merges) }, (_, k) => (
              <line key={`mg${k}`} x1={x - 20} x2={x - 4} y1={yb + 9 + k * 6} y2={yb} className="stage-fig__other" />
            ))}
            <StepGlyph glyph={glyph} x={x} y={yb} event={glyph === "handoff" && isEvent(step)} />
          </g>
        </g>,
      );
    } else if (step.kind === "entry" && stage.laneOf.has(step.target)) {
      const x = scale.x(step.release ?? model.span[0]);
      const y = laneY(to ?? 0);
      marks.push(
        <g key={`s${s.number}`} className="fig-target fig-hue--ink" {...bind(`s${s.number}`)}>
          <rect x={x - 12} y={y - 36} width={24} height={36} className="fig-hit" />
          <g className="fig-mark">
            <line x1={x} x2={x} y1={y - 20} y2={y - 5} className="fig-cross" />
            <StepGlyph glyph="form" x={x} y={y - 24} />
          </g>
        </g>,
      );
    } else if (step.kind === "final" && from !== null) {
      const x = Math.min(x1 - 4, barEnd(step.release ?? model.span[1]) + 10);
      const y = laneY(from);
      marks.push(
        <g key={`s${s.number}`} className="fig-target fig-hue--external" {...bind(`s${s.number}`)}>
          <rect x={x - 12} y={y - 12} width={24} height={24} className="fig-hit" />
          <g className="fig-mark">
            <StepGlyph glyph="final" x={x} y={y} />
          </g>
        </g>,
      );
    }
  });
  const bridge = bridgeNode as { x: number; y: number; id: string } | null;
  const near = model.steps.find((s) => s.step.kind === "bridge_near");
  const far = model.steps.find((s) => s.step.kind === "bridge_far");
  if (bridge && near && far) {
    const a = stepLanes(stage, near).from ?? 0;
    const b = stepLanes(stage, far).to ?? 0;
    const xa = scale.x(near.step.release ?? 0);
    const xb = scale.x(far.step.release ?? 0);
    marks.push(
      <g key="bridge" className="fig-target fig-hue--external" {...bind(`s${near.number}`)}>
        <rect
          x={Math.min(xa, xb) - 12}
          y={Math.min(laneY(a), laneY(b))}
          width={Math.abs(xb - xa) + 24}
          height={Math.abs(laneY(b) - laneY(a))}
          className="fig-hit"
        />
        <g className="fig-mark">
          <line x1={xa} x2={bridge.x} y1={laneY(a)} y2={bridge.y} className="fig-cross" />
          <line x1={bridge.x} x2={xb} y1={bridge.y} y2={laneY(b)} className="fig-cross" />
          <StepGlyph glyph="bridge" x={bridge.x} y={bridge.y} />
        </g>
      </g>,
    );
  }
  const query = result(model).query_id;
  const entry = model.steps.find((s) => s.step.kind === "entry" && stage.laneOf.has(s.step.target));
  const window0 = window[0] ?? model.span[0];
  const window1 = window[window.length - 1] ?? model.span[1];

  return (
    <div className="stage-fig fig" ref={ref} style={{ height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`The path of ${query} from release ${result(model).from_release ?? "—"} to ${result(model).to_release}, drawn over releases ${window0} to ${window1}: ${model.steps.length} steps over ${lanes.length} stable ${lanes.length === 1 ? "id" : "ids"}. Arrow keys move along its genes and steps.`}
        className="stage-fig__svg"
      >
        {/* The overview: the graph's whole axis, its assemblies, and the window drawn below. */}
        <g className="stage-fig__overview" aria-hidden="true">
          {bands.map((b, i) => (
            <rect
              key={`${b.assembly}-${b.first}`}
              x={overview.x(b.first - 0.5)}
              y={8}
              width={overview.x(b.last + 0.5) - overview.x(b.first - 0.5)}
              height={8}
              className={i % 2 ? "stage-fig__ov-band stage-fig__ov-band--b" : "stage-fig__ov-band"}
            />
          ))}
          <rect
            x={overview.x(window0 - 0.5)}
            y={4}
            width={overview.x(window1 + 0.5) - overview.x(window0 - 0.5)}
            height={16}
            className="stage-fig__ov-window"
          />
          <text x={x0} y={OVERVIEW} className="fig-text stage-fig__ov-text">
            {overview.first}
          </text>
          <text x={x1} y={OVERVIEW} textAnchor="end" className="fig-text stage-fig__ov-text">
            {overview.last}
          </text>
          <text
            x={Math.min(x1 - 60, Math.max(x0 + 40, (overview.x(window0 - 0.5) + overview.x(window1 + 0.5)) / 2))}
            y={OVERVIEW}
            textAnchor="middle"
            className="fig-text fig-text--sans stage-fig__ov-text"
          >
            drawn: {window0}–{window1}
          </text>
          <line
            x1={overview.x(window0 - 0.5)}
            x2={scale.x0 - scale.step / 2}
            y1={20}
            y2={top - 2}
            className="stage-fig__ov-lead"
          />
          <line
            x1={overview.x(window1 + 0.5)}
            x2={scale.x1 + scale.step / 2}
            y1={20}
            y2={top - 2}
            className="stage-fig__ov-lead"
          />
        </g>
        <defs>
          <clipPath id={clip}>
            <rect x={scale.x0 - scale.step / 2} y={0} width={scale.x1 - scale.x0 + scale.step} height={height} />
          </clipPath>
        </defs>
        <g transform={`translate(0, ${top})`} clipPath={`url(#${clip})`}>
          <Bands
            bands={bands}
            scale={scale}
            top={0}
            bottom={axisY - top}
            labelY={13}
            outerY={27}
            view={[scale.x0 - scale.step / 2, scale.x1 + scale.step / 2]}
          />
        </g>
        {lanes.map((lane, i) => (
          <text
            key={lane.id}
            x={phone ? 4 : 4}
            y={phone ? laneY(i) - 30 : laneY(i) + 4}
            className="fig-text stage-fig__lane"
          >
            {lane.id}
          </text>
        ))}
        {history.length ? (
          <ScoreTrack
            items={history.map((s) => ({
              key: String(s.number),
              x: jointX(s),
              weight: s.step.weight,
              hue: s.family === "event" ? ("event" as const) : ("history" as const),
            }))}
            x0={scale.x0}
            x1={scale.x1}
            top={scoreTop}
            bottom={scoreBottom}
            labelX={scale.x0 - 6}
          />
        ) : null}
        <ReleaseTicks scale={scale} y={axisY} releases={window} bounds={[0, width]} />
        <g className="fig-path">
          {model.genes.map((g, i) => {
            const lane = stage.laneOf.get(g.node.id) ?? 0;
            const xa = barX(g.first);
            const xb = Math.max(xa + 2, barEnd(g.last));
            return (
              <g key={g.node.id} className="fig-target" {...bind(`g${i}`)}>
                <rect x={xa - 2} y={laneY(lane) - 12} width={xb - xa + 4} height={24} className="fig-hit" />
                <GeneBar x0={xa} x1={xb} y={laneY(lane)} />
              </g>
            );
          })}
          {marks}
        </g>
        <g className="fig-labels" aria-hidden="true">
          {model.genes.map((g) => {
            const lane = stage.laneOf.get(g.node.id) ?? 0;
            const xa = barX(g.first);
            const xb = barEnd(g.last);
            const text = versionOf(g.node.id);
            const fits = xb - xa >= text.length * 7 + 4;
            return fits ? (
              <text key={g.node.id} x={(xa + xb) / 2} y={laneY(lane) + 22} textAnchor="middle" className="fig-label">
                {text}
              </text>
            ) : null;
          })}
          {entry && !phone ? (
            <text
              x={Math.min(x1 - 4, scale.x(entry.step.release ?? model.span[0]) + 9)}
              y={laneY(stage.laneOf.get(entry.step.target) ?? 0) - 20}
              textAnchor={scale.x(entry.step.release ?? 0) > (x0 + x1) / 2 ? "end" : "start"}
              dx={scale.x(entry.step.release ?? 0) > (x0 + x1) / 2 ? -18 : 0}
              className="fig-label fig-label--first"
            >
              {query}
            </text>
          ) : null}
          {bridge ? (
            <text x={bridge.x + 9} y={bridge.y + 4} className="fig-label">
              {bridge.id}
            </text>
          ) : null}
        </g>
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
  );
}

function result(model: { result: ConversionResult }): ConversionResult {
  return model.result;
}

export function StageLegend({ result: answer, graph }: { result: ConversionResult; graph: GraphDescription }) {
  const model = useMemo(() => figureModel(answer), [answer]);
  if (!model) return null;
  return <FigureLegend entries={stageLegend(stageModel(model, graph))} />;
}
