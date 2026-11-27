// What every organism page reads of the benchmarks' published results (src/generated/benchmarks_meta.json, a part of
// benchmarks.json written beside it by scripts/benchmarks.ts): the repository and its commit, the tree measured, the
// graphs it was asked on. A few hundred bytes, so that no page but Method loads the whole results.
import meta from "../generated/benchmarks_meta.json" with { type: "json" };

export const BENCHMARKS_META = meta;

/** The organisms the benchmarks asked, in the repository's order. */
export const BENCHMARK_ORGANISMS: string[] = meta.organisms;

/** Whether the benchmarks measured the graph this server holds: the same content digest. */
export function measuredGraph(organism: string, digest: string | null): boolean {
  const graphs: Record<string, string> = meta.graphs;
  return digest !== null && graphs[organism] === digest;
}
