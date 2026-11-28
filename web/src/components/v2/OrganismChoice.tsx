// The one chooser of an organism inside a page (Explore's stories, Method's accuracy): a segmented control of the
// organisms by their common names (the binomial for a screen reader and on pointing), in the one order of the site,
// the server's (the masthead's list). `among` narrows it to the organisms a view has (those the benchmarks measured),
// kept in that order.
import { chipName } from "../../lib/explore/chips";
import { organismName } from "../../lib/organismNames";
import { useSiteOrder } from "../../lib/siteOrder";
import { Segmented } from "./Segmented";

export function OrganismChoice({
  value,
  onChange,
  label,
  among,
  className = "",
}: {
  value: string;
  onChange: (organism: string) => void;
  /** The group's accessible name. */
  label: string;
  among?: readonly string[];
  className?: string;
}) {
  const order = useSiteOrder(among);
  return (
    <Segmented
      className={`organism-choice ${className}`}
      label={label}
      value={value}
      onChange={onChange}
      options={order.map((o) => ({
        value: o,
        label: (
          <span title={organismName(o)}>
            {chipName(o)}
            <span className="visually-hidden"> ({organismName(o)})</span>
          </span>
        ),
      }))}
    />
  );
}
