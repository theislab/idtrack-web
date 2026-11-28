// The composition of a graph: the counts of its build, as the graph file records them (`counts` of
// /organisms/{organism}), by IDTrack's names, each as a bar on a logarithmic axis (the counts run from none to
// millions) beside its exact value, and under its name what IDTrack says the counted things are (its concepts' page,
// or the docstring of the member of the same name of its graph or its record: src/generated/idtrack_docs.json); the
// counts IDTrack says nothing more of are named once, under the figure, not under each row. A count of zero has no place
// on a logarithmic axis: it is written, with no bar. The decades are gridlines that run through every row, behind the
// bars. The rows are text, not controls: everything they hold is visible.
import type { CSSProperties } from "react";
import docs from "../../generated/idtrack_docs.json";
import { groupedInteger } from "../../lib/numbers";
import { spaced } from "../../lib/vocabulary";
import { Prose } from "../ui";

const MEANINGS = new Map(docs.counts.items.map((c) => [c.key, c.meaning]));

export function CountsFigure({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const decades = Math.max(1, Math.ceil(Math.log10(max + 1)));
  const percent = (v: number) => (v <= 0 ? 0 : (Math.log10(v) / decades) * 100);
  const ticks = Array.from({ length: decades + 1 }, (_, k) => k);
  const unnamed = entries.map(([key]) => key).filter((key) => !MEANINGS.get(key));
  return (
    <div className="counts" style={{ "--decades": decades } as CSSProperties}>
      <ul className="counts__list" aria-label="Counts of the build">
        {entries.map(([key, value]) => {
          const meaning = MEANINGS.get(key) ?? null;
          return (
            <li key={key} className="counts__row">
              <span className="counts__name">
                {spaced(key)}
                {meaning ? (
                  <span className="counts__meaning">
                    <Prose text={meaning} />
                  </span>
                ) : null}
              </span>
              <span className="counts__track" aria-hidden="true">
                {ticks.slice(1, -1).map((k) => (
                  <span key={k} className="counts__grid" style={{ left: `${(k / decades) * 100}%` }} />
                ))}
                {value > 0 ? <span className="counts__bar" style={{ width: `${percent(value)}%` }} /> : null}
              </span>
              <span className="counts__value mono">
                {groupedInteger(value)}
                {value === 0 ? <span className="visually-hidden"> (no bar: zero has no place on the axis)</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="counts__axis" aria-hidden="true">
        <span />
        <span className="counts__ticks">
          {ticks.map((k) => (
            <span key={k} className="counts__tick" style={{ left: `${(k / decades) * 100}%` }}>
              10<sup>{k}</sup>
            </span>
          ))}
        </span>
        <span />
      </div>
      {unnamed.length ? (
        <p className="counts__unnamed small">
          IDTrack names {unnamed.length === 1 ? "one count" : `${unnamed.length} counts`} of its build without saying
          more of {unnamed.length === 1 ? "it" : "them"}: {unnamed.map((k) => spaced(k)).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
