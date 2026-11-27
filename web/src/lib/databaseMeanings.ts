// What a database name of a graph holds, in idtrack's words (its documentation at the commit src/generated/
// idtrack_docs.json names: the page of external databases, "The names a graph lists", and the data sources of its
// page of authors). A name the page lists is described by its entry; a name that is a listed name with a suffix of
// Ensembl's (`RefSeq_mRNA_predicted` of `RefSeq_mRNA`, `RefSeq DNA predicted` of `RefSeq DNA`: Ensembl names a
// database's other kinds so) by the listed name's entry; any other name by none, rather than a guess.
//
// The page of databases describes the symbol databases for every organism at once ("The symbol of the organism's name
// authority: HGNC Symbol (human, and the HGNC symbols of pig and the macaques), MGI Symbol (mouse), VGNC Symbol (pig,
// macaques)"). On one organism's page each is said for that organism, from the graph's own list of its symbol
// databases in idtrack's order (`symbol_databases` of `GET /organisms/{organism}/databases`, idtrack's
// SYMBOL_DATABASES): the first is the organism's name authority; a later one holds what the page of databases calls
// the symbols projected onto that organism's genes; a symbol database of another organism holds that organism's
// authority's symbols as Ensembl attaches them to this organism's genes.
import docs from "../generated/idtrack_docs.json" with { type: "json" };

export interface DatabaseMeaning {
  /** The name idtrack's page describes (the name itself, or the listed name it continues). */
  described: string;
  holds: string;
  note: string | null;
}

export interface DataSource {
  resources: { name: string; url: string | null }[];
  description: string;
}

/** A database name described for one graph: what it holds, the resource it comes from, the Ensembl form it is
 *  attached to. Every part is idtrack's words or the api's value, or null. */
export interface DatabaseDescription {
  name: string;
  meaning: DatabaseMeaning | null;
  /** The resource of idtrack's data sources whose name the database's name (or what it holds) begins a word with. */
  source: DataSource | null;
  /** For a symbol database: what it is for this organism. */
  symbols: SymbolRole | null;
}

export type SymbolRole =
  | { role: "authority" }
  | { role: "projected"; phrase: string; authority: string }
  | { role: "other"; of: string; authority: string | null };

const ITEMS = new Map(docs.databases.items.map((d) => [d.name, d]));
const AUTHORITY = ITEMS.get("MGI Symbol")?.holds ?? "The symbol of the organism's name authority";

export function databaseMeaning(name: string): DatabaseMeaning | null {
  const exact = ITEMS.get(name);
  if (exact) return { described: exact.name, holds: exact.holds, note: exact.note };
  const listed = [...ITEMS.values()]
    .filter((d) => name.startsWith(`${d.name}_`) || name.startsWith(`${d.name} `))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return listed ? { described: listed.name, holds: listed.holds, note: listed.note } : null;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s/_()'-]+/)
    .filter(Boolean);

/** The data source of a name: the first resource of idtrack's list whose name's first word begins a word of the
 *  database's name, or else of what idtrack says it holds (`EntrezGene`: "NCBI's gene id", NCBI Gene). */
export function sourceOf(name: string, holds: string | null): DataSource | null {
  const find = (text: string) =>
    docs.sources.items.find((s) =>
      s.resources.some((r) => {
        const first = words(r.name)[0] ?? "";
        return first.length > 2 && words(text).some((w) => w.startsWith(first));
      }),
    ) ?? null;
  return find(name) ?? (holds ? find(holds) : null);
}

/** The organism's words a projection names ("pig and macaque") against the organism's common name ("rhesus
 *  macaque"): whether one of them is a word of it. */
function projectedOnto(organisms: readonly string[], commonName: string | null): boolean {
  if (!commonName) return false;
  const own = words(commonName);
  return organisms.some((o) => own.includes(o.toLowerCase()));
}

/** What a symbol database is for one organism, from the graph's symbol databases in idtrack's order. */
export function symbolRole(
  name: string,
  symbolDatabases: readonly string[],
  commonName: string | null,
): SymbolRole | null {
  const meaning = ITEMS.get(name);
  if (meaning?.holds !== AUTHORITY) return null;
  const authority = symbolDatabases[0] ?? null;
  if (name === authority) return { role: "authority" };
  const projection = docs.databases.projections.find(
    (p) => p.database === name && projectedOnto(p.organisms, commonName),
  );
  if (projection && symbolDatabases.includes(name) && authority)
    return { role: "projected", phrase: projection.phrase, authority };
  // The organism whose authority it is: the first of the organisms idtrack's table names for it ("human, and ...").
  const of = (meaning.note ?? "").split(/,\s*/)[0] ?? "";
  return { role: "other", of, authority };
}

/** Whether idtrack's note on a group of names says they are the projections of the organism's own name authority
 *  ("HGNC's projections" on a graph whose authority is HGNC Symbol): a projection is onto another organism's genes, so
 *  on the authority's own organism the note does not hold and is not said. */
export function projectionOfOwnAuthority(note: string | null, authority: string | null): boolean {
  const of = note === null ? null : (/^(.+?)'s projections$/.exec(note.trim())?.[1] ?? null);
  return of !== null && authority !== null && authority.split(/\s+/)[0] === of;
}

export function describeDatabase(
  name: string,
  graph: { symbolDatabases: readonly string[]; commonName: string | null },
): DatabaseDescription {
  const listed = databaseMeaning(name);
  const meaning =
    listed && projectionOfOwnAuthority(listed.note, graph.symbolDatabases[0] ?? null)
      ? { ...listed, note: null }
      : listed;
  return {
    name,
    meaning,
    source: sourceOf(name, meaning?.holds ?? null),
    symbols: symbolRole(name, graph.symbolDatabases, graph.commonName),
  };
}

/** The page of idtrack's documentation the meanings come from, and its page of data sources. */
export const DATABASE_MEANINGS_SOURCE = docs.databases.source;
export const DATA_SOURCES_SOURCE = docs.sources.source;
export const DATABASE_FILING_SOURCE = docs.databases.filing;
