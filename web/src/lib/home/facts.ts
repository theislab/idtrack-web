// What this server holds, summed from its graphs as /organisms describes them (the Convert page's facts).
import type { GraphDescription } from "../../api/types";
import { groupedInteger, releaseRanges } from "../numbers";
import { releasesOf } from "./links";

export interface Fact {
  key: string;
  value: string;
  label: string;
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
      label: n === 1 ? "graph of one organism" : "graphs, one for each organism",
      source: "organisms, counted",
    },
    {
      key: "releases",
      value: releaseRanges(releases),
      label: `Ensembl releases (${releases.length})`,
      source: `releases, joined ${over}`,
    },
    {
      key: "assemblies",
      value: groupedInteger(graphs.reduce((t, g) => t + g.assemblies.length, 0)),
      label: "genome assemblies",
      source: `assemblies, counted ${over}`,
    },
  ];
  const counted: [string, string][] = [
    ["nodes", "identifiers of every database, at the releases they hold"],
    ["history_edges", "steps of Ensembl's id history between gene versions"],
    ["cross_reference_edges", "links from Ensembl's genes to the ids of other databases"],
  ];
  for (const [count, label] of counted) {
    const total = sum(graphs, count);
    if (total !== null)
      list.push({ key: count, value: groupedInteger(total), label, source: `counts.${count}, summed ${over}` });
  }
  list.push({
    key: "databases",
    value: groupedInteger(databases.size),
    label: "external databases",
    source: `external_databases, distinct names ${over}`,
  });
  return list;
}
