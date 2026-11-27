// The masthead's choice of organism. The closed control names the organism as a biologist writes it, the binomial in
// italics (abbreviated, `H. sapiens`, on a narrow phone); the list it opens gives each binomial with its common name
// ("Homo sapiens (human)"). The control is the browser's own select, so a keyboard, a screen reader and a phone's
// picker work as they do everywhere: its text is drawn by the words laid over it, which take no pointer and no focus.
// Every binomial the server holds stands in the same cell, all but the chosen one hidden, so the control is as wide as
// the longest of them and never cuts a name or moves when another organism is chosen.
import type { GraphDescription } from "../api/types";
import { commonName, organismName, shortOrganismName } from "../lib/organismNames";

function Shown({ organism, current }: { organism: string; current: boolean }) {
  return (
    <span className="organism-picker__name" data-current={current ? "" : undefined}>
      <i className="organism-picker__long">{organismName(organism)}</i>
      <i className="organism-picker__short">{shortOrganismName(organism)}</i>
    </span>
  );
}

export function OrganismPicker({
  organisms,
  current,
  choose,
}: {
  organisms: readonly GraphDescription[];
  current: string;
  choose: (organism: string) => void;
}) {
  return (
    <label className="organism-picker">
      <span className="visually-hidden">Organism</span>
      <span className="organism-picker__box">
        <span className="organism-picker__shown" aria-hidden="true">
          {organisms.map((o) => (
            <Shown key={o.organism} organism={o.organism} current={o.organism === current} />
          ))}
        </span>
        <select
          value={current}
          onChange={(e) => {
            choose(e.target.value);
          }}
          className="organism-picker__select"
        >
          {organisms.map((o) => {
            const common = commonName(o.organism);
            return (
              <option key={o.organism} value={o.organism}>
                {organismName(o.organism)}
                {common ? ` (${common})` : ""}
              </option>
            );
          })}
        </select>
      </span>
    </label>
  );
}
