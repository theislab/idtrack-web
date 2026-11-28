// The words the home's pictures say beside the pointer and on their axis, read from the data drawn: a lineage's id,
// releases, versions and family, and whether it is an id of a showcase journey or only of the family of one; a ring's
// release and counts; the release at which the most gene ids were new. Pure, so that each is tested as it is said.
import type { HistoryResponse } from "../../api/types";
import type { RingsModel } from "../../components/hero/rings";
import { groupedInteger } from "../numbers";
import { runsOf, type LineageLayout } from "./lineageLayout";

/** A point in CSS pixels of a picture. */
interface Point {
  x: number;
  y: number;
}

/** The words beside the pointer: where they stand, and what they say. */
export interface Lifted {
  x: number;
  y: number;
  title: string;
  line: string;
  /** Beside the point (the lineages, the rings), or centred above or below it (the cable: outside it). */
  side?: "above" | "below";
}

/** The words of a lineage under the pointer: its id, its releases, its versions, its family, and whether it is an id
 *  of one of the showcase's journeys or only of the family of one. */
export function liftedOf(layout: LineageLayout, id: number, p: Point, onJourney: ReadonlySet<string>): Lifted {
  const runs = runsOf(layout, id);
  const family = (layout.familyOf[2 * id + 1] ?? 0) - (layout.familyOf[2 * id] ?? 0) + 1;
  const versions = layout.versionCounts[id] ?? 0;
  const releases = runs.map(([a, b]) => (a === b ? String(a) : `${String(a)}–${String(b)}`)).join(", ");
  const name = layout.ids[id] ?? "";
  const showcase = onJourney.has(name)
    ? " · on a showcase journey"
    : id < layout.focusIds
      ? " · in the family of a showcase journey"
      : "";
  return {
    x: p.x,
    y: p.y,
    title: name,
    line: `active ${releases}${versions ? ` · ${String(versions)} new version${versions === 1 ? "" : "s"}` : ""}${family > 1 ? ` · a family of ${String(family)} ids` : ""}${showcase}`,
  };
}

/** The words beside a ring under the pointer: its release, its assembly and what the history counts there. */
export function ringLifted(rings: RingsModel, k: number, p: Point): Lifted {
  const n = (values: number[]) => groupedInteger(values[k] ?? 0);
  const assembly = rings.assemblies[k];
  const fans = rings.fans[k] ?? 0;
  return {
    x: p.x,
    y: p.y,
    title: `Release ${String(rings.releases[k] ?? "")}${assembly ? ` · ${assembly}` : ""}`,
    line:
      k === 0
        ? `${n(rings.active)} gene ids active · the graph begins here`
        : `${n(rings.active)} gene ids active · ${n(rings.created)} new · ${n(rings.retired)} retired on the way in · ${n(rings.fans)} fan${fans === 1 ? "" : "s"}`,
  };
}

/** The release after the graph's first at which the most gene ids were new (`/history`'s `created`), where it is not
 *  the first release of an assembly (that one is named already); null where there is none. */
export function lateStep(
  history: HistoryResponse | null,
  firsts: readonly number[],
): { release: number; created: number } | null {
  if (!history) return null;
  let best: { release: number; created: number } | null = null;
  for (const r of history.releases.slice(1))
    if (r.created > (best?.created ?? 0)) best = { release: r.release, created: r.created };
  return best && !firsts.includes(best.release) ? best : null;
}
