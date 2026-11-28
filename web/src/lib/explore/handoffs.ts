// The assembly changes of a graph (where the assembly that serves the releases changes) and whether Ensembl publishes a
// mapping of the earlier assembly onto the later one there, as IDTrack's documentation states it (its limitation
// "Places across an assembly change", whose two lists src/generated/idtrack_docs.json holds, read at the pinned idtrack
// commit). A change the documentation names in neither list is said to be unstated, never guessed.
import type { GraphDescription } from "../../api/types";
import docs from "../../generated/idtrack_docs.json" with { type: "json" };
import { assemblyBands, type Band } from "../../components/figure/releases";

export type Mapping = "published" | "none" | "unstated";

export interface Handoff {
  from: Band;
  to: Band;
  /** The first release the later assembly serves. */
  release: number;
  mapping: Mapping;
}

const named = (list: readonly { from: string; to: string }[], from: string, to: string) =>
  list.some((c) => c.from === from && c.to === to);

/** Whether Ensembl publishes a mapping between two assemblies, by IDTrack's documentation. */
export function mappingOf(from: string, to: string): Mapping {
  if (named(docs.assemblyMapping.mapped, from, to)) return "published";
  if (named(docs.assemblyMapping.unmapped, from, to)) return "none";
  return "unstated";
}

/** Every change of the serving assembly, in release order. */
export function handoffsOf(
  description: Pick<GraphDescription, "releases" | "serving_assembly" | "assemblies">,
): Handoff[] {
  const bands = assemblyBands(description);
  return bands.slice(1).flatMap((to, i) => {
    const from = bands[i];
    if (!from || from.assembly === to.assembly) return [];
    return [{ from, to, release: to.first, mapping: mappingOf(from.name, to.name) }];
  });
}

/** The words of a mapping, for a table, a note or a caption. */
export const MAPPING_WORDS: Record<Mapping, string> = {
  published: "Ensembl publishes a mapping of the two assemblies: places are compared through it",
  none: "Ensembl publishes no mapping: genes across the change are told apart only by the names of their chromosomes",
  unstated: "IDTrack's documentation does not say whether Ensembl publishes a mapping here",
};
