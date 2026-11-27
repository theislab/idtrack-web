// The kinds of history step, each drawn as what it is (a small schematic in the figure grammar: the genes as bars on
// lanes, the step's glyph where the old id ends and the new one begins) beside what Ensembl recorded, in idtrack's
// documentation's words (its table of version events, src/generated/idtrack_docs.json), and the code a result names
// the step by, with idtrack's meaning of it on request. The schematics draw no real ids: they show the shape of each
// kind; the panel's figure above draws a real one.
import type { ReactNode } from "react";
import docs from "../../generated/idtrack_docs.json";
import type { Vocabulary } from "../../lib/vocabulary";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import type { Glyph } from "../figure/glyph";
import { Prose } from "../ui";
import { Term } from "../ResultParts";

const W = 132;
const H = 56;
const MID = W / 2;

/** A schematic: bars on lanes (y), joined at the middle by the kind's glyph. */
function Schematic({
  left,
  right,
  glyph,
  children,
}: {
  left: number[];
  right: number[];
  glyph: Glyph;
  children?: ReactNode;
}) {
  const hue = glyph === "event" ? "event" : glyph === "handoff" ? "handoff" : "history";
  return (
    <svg className="kind-fig" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {children}
      {left.map((y) => (
        <GeneBar key={`l${y}`} x0={8} x1={MID - 3} y={y} />
      ))}
      {right.map((y) => (
        <GeneBar key={`r${y}`} x0={MID + 3} x1={W - 8} y={y} />
      ))}
      <g className={`fig-hue--${hue}`}>
        {[...new Set([...left, ...right])].length > 1 && glyph !== "loop"
          ? (() => {
              const all = [...left, ...right];
              return <line x1={MID} x2={MID} y1={Math.min(...all)} y2={Math.max(...all)} className="fig-link" />;
            })()
          : null}
        <StepGlyph glyph={glyph} x={MID} y={glyph === "loop" ? (left[0] ?? H / 2) : H / 2} />
      </g>
    </svg>
  );
}

const C = H / 2;
const KIND_FIGURES: Record<string, ReactNode> = {
  new_version: <Schematic left={[C]} right={[C]} glyph="version" />,
  replaced: <Schematic left={[C - 12]} right={[C + 12]} glyph="version" />,
  split: <Schematic left={[C]} right={[C - 16, C + 16]} glyph="event" />,
  merge: <Schematic left={[C - 16, C + 16]} right={[C]} glyph="event" />,
  split_and_merge: <Schematic left={[C - 16, C + 16]} right={[C - 16, C + 16]} glyph="event" />,
  self_loop: <Schematic left={[C + 8]} right={[C + 8]} glyph="loop" />,
};

const HANDOFF = (
  <svg className="kind-fig" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
    <rect x={0} y={0} width={MID} height={H} className="fig-band fig-band--a" />
    <rect x={MID} y={0} width={MID} height={H} className="fig-band fig-band--b" />
    <line x1={MID} x2={MID} y1={0} y2={H} className="fig-band__edge" />
    <GeneBar x0={8} x1={MID - 3} y={C} />
    <GeneBar x0={MID + 3} x1={W - 8} y={C} />
    <g className="fig-hue--handoff">
      <StepGlyph glyph="handoff" x={MID} y={C} />
    </g>
  </svg>
);

const REFUSED = (
  <svg className="kind-fig" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
    <GeneBar x0={8} x1={MID - 6} y={C - 12} />
    <GeneBar x0={MID + 6} x1={W - 8} y={C + 12} strong={false} />
    <line x1={MID - 6} x2={MID + 6} y1={C - 12} y2={C + 12} className="kind-fig__refused-line" />
    <text x={MID} y={C + 4} textAnchor="middle" className="kind-fig__refused">
      ×
    </text>
  </svg>
);

function Kind({
  figures,
  codes,
  words,
  v,
}: {
  figures: ReactNode[];
  codes: string[];
  words: ReactNode;
  v: Vocabulary;
}) {
  return (
    <li className={`method-kind${figures.length > 1 ? " method-kind--group" : ""}`}>
      <div className="method-kind__figures">
        {figures.map((figure, i) => (
          <figure key={i} className="method-kind__figure">
            {figure}
            {codes[i] && figures.length > 1 ? (
              <figcaption>
                <Term code={codes[i] ?? ""} meaning={v.stepReasons.get(codes[i] ?? "")} />
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
      <div className="method-kind__text">
        {figures.length === 1 && codes.length ? (
          <p className="method-kind__codes">
            {codes.map((code) => (
              <Term key={code} code={code} meaning={v.stepReasons.get(code)} />
            ))}
          </p>
        ) : null}
        <p className="method-kind__words">{words}</p>
      </div>
    </li>
  );
}

export function HistoryKinds({ v }: { v: Vocabulary }) {
  return (
    <ul className="method-kinds" aria-label="The kinds of history step">
      {[...docs.events.items]
        // The row of several kinds stands first, across the width; the single kinds flow in columns under it.
        .sort((a, b) => b.reasons.length - a.reasons.length)
        .map((event) => (
          // A row of the documentation that names several kinds in one sentence ("One id became several, several became
          // one, or both at one release") stays one row: a schematic per kind, the sentence once.
          <Kind
            key={event.reasons.join("-")}
            figures={event.reasons.map((code) => KIND_FIGURES[code] ?? null)}
            codes={event.reasons}
            v={v}
            words={<Prose text={event.recorded} />}
          />
        ))}
      <Kind
        figures={[HANDOFF]}
        codes={[]}
        v={v}
        words={
          <>
            <strong>Across an assembly change.</strong> <Prose text={docs.assemblyMapping.lead} />{" "}
            <a href={docs.assemblyMapping.source}>{docs.assemblyMapping.title}</a>
          </>
        }
      />
      <Kind
        figures={[REFUSED]}
        codes={["mitochondrial_genome"]}
        v={v}
        words={
          <>
            <strong>Not followed.</strong> <Prose text={v.stepReasons.get("mitochondrial_genome") ?? ""} />
          </>
        }
      />
    </ul>
  );
}
