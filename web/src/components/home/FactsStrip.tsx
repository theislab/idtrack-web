// What this server holds, summed from its graphs as /organisms describes them: the graphs, the releases they span,
// their assemblies, and the counts of their builds (identifiers, steps of Ensembl's id history, links to other
// databases: idtrack's nodes, history edges and cross-reference edges), with the external databases. Each number says
// in plain words what it counts; the caption under the strip names the endpoint and the field each one sums.
import { useId } from "react";
import type { GraphDescription } from "../../api/types";
import { facts } from "../../lib/home/facts";

export function FactsStrip({
  organisms,
  letter = "c",
  level = 2,
}: {
  organisms: readonly GraphDescription[];
  /** The panel's letter in the page it stands on (none: no letter). */
  letter?: string | null;
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  const id = useId();
  if (!organisms.length) return null;
  const list = facts(organisms);
  return (
    <section className="home-facts" aria-labelledby={`${id}-title`}>
      <div className="home-section-head">
        {letter ? (
          <span className="panel-letter" aria-hidden="true">
            {letter}
          </span>
        ) : null}
        <H id={`${id}-title`}>What this server holds</H>
      </div>
      <dl className="facts" aria-describedby={`${id}-caption`}>
        {list.map((f) => (
          <div key={f.key} className="fact">
            <dt className="fact__label">{f.label}</dt>
            <dd className="fact__value mono">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="fig-caption facts__caption" id={`${id}-caption`}>
        {letter ? <strong>{letter}</strong> : null} Summed from <span className="mono">GET /api/v1/organisms</span>, in
        order:{" "}
        {list.map((f, i) => (
          <span key={f.key}>
            {i ? "; " : ""}
            {f.source.split(/(\b[a-z_]+(?:\.[a-z_]+)?\b(?=,))/).map((part, k) =>
              k % 2 ? (
                <span key={k} className="mono">
                  {part}
                </span>
              ) : (
                part
              ),
            )}
          </span>
        ))}
        .
      </p>
    </section>
  );
}
