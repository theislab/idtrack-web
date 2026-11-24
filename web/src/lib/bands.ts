// The assembly bands of a graph: which assembly serves each run of releases (`serving_assembly`).
import type { GraphDescription } from "../api/types";

export interface Band {
  assembly: number;
  name: string;
  first: number;
  last: number;
}

export function assemblyBands(
  description: Pick<GraphDescription, "releases" | "serving_assembly" | "assemblies">,
): Band[] {
  const names = new Map(description.assemblies.map((a) => [a.assembly, a.name ?? String(a.assembly)]));
  const bands: Band[] = [];
  for (const release of [...description.releases].sort((a, b) => a - b)) {
    const assembly = description.serving_assembly[String(release)];
    if (assembly === undefined) continue;
    const last = bands[bands.length - 1];
    if (last?.assembly === assembly && last.last === release - 1) last.last = release;
    else bands.push({ assembly, name: names.get(assembly) ?? String(assembly), first: release, last: release });
  }
  return bands;
}

/** Release ticks for a given width per release: every release, every 5th or every 10th labelled. */
export function tickStep(pixelsPerRelease: number): number {
  if (pixelsPerRelease >= 30) return 1;
  if (pixelsPerRelease >= 12) return 5;
  return 10;
}
