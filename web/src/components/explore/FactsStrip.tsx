// What this server holds, summed from its graphs as /organisms describes them: the graphs, the releases they span,
// their assemblies, and the counts of their builds (identifiers, steps of Ensembl's id history, links to other
// databases: IDTrack's nodes, history edges and cross-reference edges, each said as what IDTrack counts, its markers
// of an id's creation and retirement included), with the external databases. Each number says in a few words what it
// counts, the rest in a hover card on its (i); the caption under the strip names the endpoint in one line, and how
// each number is summed from it in a hover card.
import { useId } from "react";
import type { GraphDescription } from "../../api/types";
import { facts } from "../../lib/explore/facts";
import { HoverCard } from "../v2/HoverCard";

export function FactsStrip({ organisms }: { organisms: readonly GraphDescription[] }) {
  const id = useId();
  if (!organisms.length) return null;
  const list = facts(organisms);
  return (
    <section className="home-facts" aria-label="What this server holds">
      <dl className="facts" aria-describedby={`${id}-caption`}>
        {list.map((f) => (
          <div key={f.key} className="fact">
            <dt className="fact__label">
              {f.label}
              {f.definition ? (
                <HoverCard
                  className="hint"
                  triggerClassName="hint__trigger"
                  label={`What "${f.label}" counts`}
                  trigger={<span className="hint__mark" aria-hidden="true" />}
                >
                  <p className="fact__definition">{f.definition}</p>
                </HoverCard>
              ) : null}
            </dt>
            <dd className="fact__value mono">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="fig-caption facts__caption" id={`${id}-caption`}>
        Summed from <span className="mono">GET /api/v1/organisms</span>.{" "}
        <HoverCard className="facts__how" triggerClassName="caption-more__toggle" trigger="How each is summed">
          <ul className="facts__sources">
            {list.map((f) => (
              <li key={f.key}>
                {f.label}:{" "}
                {f.source.split(/(\b[a-z_]+(?:\.[a-z_]+)?\b(?=,))/).map((part, k) =>
                  k % 2 ? (
                    <span key={k} className="mono">
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
              </li>
            ))}
          </ul>
        </HoverCard>
      </p>
    </section>
  );
}
