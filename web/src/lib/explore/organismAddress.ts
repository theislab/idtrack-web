// The organism an address of Explore names (`/organisms/<name>`), by the rule the api reads its path `{organism}` with:
// the Ensembl production name with spaces or in any letter case (`Homo sapiens`, `Sus_scrofa`), or a short name idtrack
// declares for it (`human`, `pig`: `names` of `GET /organisms`). An address that names a graph by another of its names
// is shown at the graph's own address (`/organisms/sus_scrofa`).
import type { OrganismsResponse } from "../../api/types";

/** A name as the api compares it: trimmed, its spaces as underscores, in lower case. */
function key(name: string): string {
  return name.trim().replace(/\s+/g, "_").toLowerCase();
}

/** The production name of the graph a name means on this server, or null where it means none. */
export function organismNamed(
  asked: string,
  answer: Pick<OrganismsResponse, "organisms"> & { names?: OrganismsResponse["names"] },
): string | null {
  const k = key(asked);
  if (!k) return null;
  const held = answer.organisms.find((o) => key(o.organism) === k);
  if (held) return held.organism;
  const named = (answer.names ?? []).find((n) => n.aliases.some((a) => key(a) === k));
  return named && answer.organisms.some((o) => o.organism === named.organism) ? named.organism : null;
}
