// An example list for the batch of an organism: the identifiers of the Convert page's figures for it (the journeys and
// the cases of the server's showcase of the graph, lib/showcase.ts), each once, in their order. Only inputs: no answer
// is written or claimed here; the server converts them as it converts any list. A graph without a showcase (or before
// it arrives) has no example.
import type { ShowcaseResponse } from "../api/types";

/** A set of the Convert page's journeys: identifiers asked with the same releases and database, and those settings. */
export interface ExampleSet {
  identifiers: string[];
  from: number | null;
  to: number | null;
  database: string | null;
}

/** The journeys of the showcase in sets of consecutive equal settings (as the Convert page's first figure groups
 *  them), each set's identifiers once; a set of a single identifier is left out (a batch of one is no example). */
export function exampleSets(showcase: ShowcaseResponse | null): ExampleSet[] {
  if (!showcase) return [];
  const sets: ExampleSet[] = [];
  for (const item of showcase.journeys) {
    const q = item.query;
    const settings = { from: q.from_release ?? null, to: q.to_release ?? null, database: q.final_database ?? null };
    const last = sets[sets.length - 1];
    if (last?.from === settings.from && last.to === settings.to && last.database === settings.database) {
      if (!last.identifiers.includes(q.identifier)) last.identifiers.push(q.identifier);
    } else sets.push({ ...settings, identifiers: [q.identifier] });
  }
  return sets.filter((s) => s.identifiers.length > 1);
}

/** A set's settings in words, as its request sends them (the api's defaults named). */
export function exampleWords(set: ExampleSet, snapshot: number): string {
  const from = set.from !== null ? `read at ${String(set.from)}` : "read where idtrack infers";
  const to =
    set.to !== null && set.from !== null && set.to < set.from
      ? `back to ${String(set.to)}`
      : `to ${String(set.to ?? snapshot)}`;
  const database = set.database !== null ? `in ${set.database}` : "as Ensembl genes";
  return `${from} · ${to} · ${database}`;
}

function exampleList(showcase: ShowcaseResponse | null): string[] {
  if (!showcase) return [];
  const journeys = showcase.journeys.map((j) => j.query.identifier);
  const cases = showcase.cases.map((c) => c.query.identifier);
  return [...new Set([...journeys, ...cases])];
}

/** A list for the empty field of the Batch page: the first few identifiers of the organism's figures, one per line (none
 *  before the showcase arrives, rather than another organism's). */
export function listPlaceholder(showcase: ShowcaseResponse | null): string {
  return exampleList(showcase).slice(0, 4).join("\n");
}

/** Examples for the Names page from the same identifiers: names (the symbols and other ids that are no Ensembl id)
 *  and Ensembl genes written with a version, a few of each. */
export function nameExamples(showcase: ShowcaseResponse | null): { names: string[]; genes: string[] } {
  const all = exampleList(showcase);
  const cases = showcase ? showcase.cases.map((c) => c.query.identifier) : [];
  // Accessions of transcripts and proteins (Ensembl's, RefSeq's `NM_…`, UniProt's) are no names of a gene.
  const accession = /^(ENS[A-Z]*[EGPRT]\d{11}|[A-Z]{2}_\d|[OPQ]\d[A-Z0-9]{3}\d$|[A-NR-Z]\d[A-Z][A-Z0-9]{2}\d$)/;
  const symbol = (id: string) => !accession.test(id) && /[A-Za-z]/.test(id);
  return {
    names: [...new Set([...cases, ...all])].filter(symbol).slice(0, 4),
    genes: all.filter((id) => /^ENS[A-Z]*G\d{11}\.\d+$/.test(id)).slice(0, 3),
  };
}
