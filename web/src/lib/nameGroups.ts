// The attachments of a name to genes read by gene: Ensembl writes a gene as its id and a version (`ENSG00000129965.8`),
// and a gene keeps its id across its versions, so the genes a name names are its distinct ids, each in one or more
// versions. Grouped so: one group per gene id, one lane per database (and whether the name is that database's name of
// the gene or one of its synonyms) holding the releases of every version, the versions in their natural order.
import type { NameMatch } from "../api/types";

/** An Ensembl gene's id without its version (`ENSG00000129965.8` -> `ENSG00000129965`); any other text as it is. */
function geneId(gene: string): string {
  return /^(.+)\.\d+$/.exec(gene)?.[1] ?? gene;
}

const collator = new Intl.Collator("en", { numeric: true });
/** Natural order of ids and versions: `.4` before `.10`. */
const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export interface NameLane {
  database: string;
  synonym: boolean;
  /** The attachments of the lane, one per version of the gene (and name), in order of their first release. */
  parts: NameMatch[];
  /** Every release of the lane (all its versions). */
  releases: number[];
}

export interface GeneGroup {
  /** The gene's id without version. */
  gene: string;
  /** Its versions named, in natural order (`ENSG….4`, `ENSG….5`, …). */
  versions: string[];
  /** Every release at which the name is attached to the gene in any database. */
  releases: number[];
  lanes: NameLane[];
}

const firstOf = (releases: readonly number[]) => Math.min(...releases);

/** The matches grouped by gene id, each gene's lanes by database (the name before its synonyms), the genes in order
 *  of the first release at which the name is attached to them, then of their ids. */
export function groupByGene(matches: readonly NameMatch[]): GeneGroup[] {
  const genes = new Map<string, NameMatch[]>();
  for (const m of matches) {
    const id = geneId(m.gene);
    const list = genes.get(id);
    if (list) list.push(m);
    else genes.set(id, [m]);
  }
  const groups = [...genes.entries()].map(([gene, list]): GeneGroup => {
    const lanes = new Map<string, NameLane>();
    for (const m of list) {
      const key = `${m.database}|${String(m.synonym)}`;
      const lane = lanes.get(key) ?? { database: m.database, synonym: m.synonym, parts: [], releases: [] };
      lane.parts.push(m);
      lanes.set(key, lane);
    }
    const ordered = [...lanes.values()].map((lane) => {
      const parts = [...lane.parts].sort(
        (a, b) => firstOf(a.releases) - firstOf(b.releases) || naturalCompare(a.gene, b.gene),
      );
      return { ...lane, parts, releases: [...new Set(parts.flatMap((p) => p.releases))].sort((a, b) => a - b) };
    });
    ordered.sort(
      (a, b) =>
        Number(a.synonym) - Number(b.synonym) ||
        firstOf(a.releases) - firstOf(b.releases) ||
        naturalCompare(a.database, b.database),
    );
    return {
      gene,
      versions: [...new Set(list.map((m) => m.gene))].sort(naturalCompare),
      releases: [...new Set(list.flatMap((m) => m.releases))].sort((a, b) => a - b),
      lanes: ordered,
    };
  });
  return groups.sort((a, b) => firstOf(a.releases) - firstOf(b.releases) || naturalCompare(a.gene, b.gene));
}

export interface NameCounts {
  attachments: number;
  genes: number;
  versions: number;
  names: number;
  databases: number;
  synonyms: number;
}

/** What a list of matches counts: genes are distinct gene ids, versions the distinct versioned ids. */
export function nameCounts(matches: readonly NameMatch[]): NameCounts {
  return {
    attachments: matches.length,
    genes: new Set(matches.map((m) => geneId(m.gene))).size,
    versions: new Set(matches.map((m) => m.gene)).size,
    names: new Set(matches.map((m) => m.name)).size,
    databases: new Set(matches.map((m) => m.database)).size,
    synonyms: matches.filter((m) => m.synonym).length,
  };
}

/** Where a database's name of a gene becomes one of its synonyms (the name lane ends the release before the synonym
 *  lane of the same database begins): the release of the turn and the gene's version there. */
export interface Turn {
  database: string;
  release: number;
  version: string;
}

export function turnsOf(group: GeneGroup): Turn[] {
  const out: Turn[] = [];
  for (const lane of group.lanes) {
    if (!lane.synonym) continue;
    const named = group.lanes.find((l) => !l.synonym && l.database === lane.database);
    if (!named) continue;
    const held = new Set(named.releases);
    for (const release of lane.releases) {
      if (held.has(release) || !held.has(release - 1)) continue;
      const part = lane.parts.find((p) => p.releases.includes(release));
      if (part) out.push({ database: lane.database, release, version: part.gene });
    }
  }
  return out;
}
