// What this server holds, summed from its graphs as /organisms describes them (Explore's facts).
import type { GraphDescription } from "../../api/types";
import { groupedInteger, releaseRanges } from "../numbers";
import { releasesOf } from "../home/links";

export interface Fact {
  key: string;
  value: string;
  /** A few words of what it counts (the tile's label). */
  label: string;
  /** What it counts, in full (the label's hover card), where the label does not say it all. */
  definition: string | null;
  source: string;
}

function sum(graphs: readonly GraphDescription[], count: string): number | null {
  let total = 0;
  for (const g of graphs) {
    const value = g.counts[count];
    if (value === undefined) return null;
    total += value;
  }
  return total;
}

export function facts(graphs: readonly GraphDescription[]): Fact[] {
  const n = graphs.length;
  const over = `over the ${n} graph${n === 1 ? "" : "s"}`;
  const releases = releasesOf(graphs);
  const databases = new Set(graphs.flatMap((g) => g.external_databases));
  const list: Fact[] = [
    {
      key: "graphs",
      value: groupedInteger(n),
      label: n === 1 ? "graph" : "graphs",
      definition: "One graph for each organism: a conversion stays within one organism.",
      source: "organisms, counted",
    },
    {
      key: "releases",
      value: releaseRanges(releases),
      label: "Ensembl releases",
      definition: `The releases the graphs hold, joined: ${releases.length} releases.`,
      source: `releases, joined ${over}`,
    },
    {
      key: "assemblies",
      value: groupedInteger(graphs.reduce((t, g) => t + g.assemblies.length, 0)),
      label: "genome assemblies",
      definition: null,
      source: `assemblies, counted ${over}`,
    },
  ];
  const counted: [string, string, string][] = [
    // What IDTrack counts (its builder): every identifier of every database, and the markers of an id's creation and
    // retirement that Ensembl's history writes as nodes (`<id>.Void`, `<id>.Retired`).
    ["nodes", "identifiers", "The identifiers of every database, with the markers of an id's creation and retirement."],
    // Every edge of the history backbone: from an id's creation marker, between versions (a version kept with
    // Ensembl's score among them), to its retirement marker, and the edge of an id alive at the last release.
    [
      "history_edges",
      "history edges",
      "The edges of Ensembl's id history, from each id's creation to its retirement or the last release.",
    ],
    [
      "cross_reference_edges",
      "links to other databases",
      "The links from Ensembl's genes, transcripts and translations to the ids of other databases.",
    ],
  ];
  for (const [count, label, definition] of counted) {
    const total = sum(graphs, count);
    if (total !== null)
      list.push({
        key: count,
        value: groupedInteger(total),
        label,
        definition,
        source: `counts.${count}, summed ${over}`,
      });
  }
  list.push({
    key: "databases",
    value: groupedInteger(databases.size),
    label: "external databases",
    definition: "The names of the databases other than Ensembl's whose ids the graphs hold, each counted once.",
    source: `external_databases, distinct names ${over}`,
  });
  return list;
}
