// The symbol of each gene an answer shows, at the answer's target release: idtrack's own conversion of the gene (an
// Ensembl gene with version, at that release) into the organism's name authority at the same release, asked in one
// batch for every gene of the answer (never one request per gene), without bridges. A gene the authority gives no
// symbol there has none shown (no name is guessed); a gene it gives several (a tie) has each.
//
// The name authority of an organism is idtrack's table `idtrack.organisms.SYMBOL_DATABASES` (HGNC for human, MGI for
// mouse, VGNC then HGNC for pig and the macaques), served by `GET /organisms/{organism}/databases` as
// `symbol_databases`: the first of them a conversion to the release can end in is the one asked.
import { useEffect, useState } from "react";
import { api } from "../api/client";

/** The organism's name authority at a release: the first of its symbol databases (idtrack's order) that a conversion
 *  to the release can end in, or null where the graph holds none there. */
export function authorityOf(
  symbolDatabases: readonly string[],
  databases: readonly { name: string; releases: readonly number[] }[],
  release: number,
): string | null {
  return symbolDatabases.find((d) => databases.some((x) => x.name === d && x.releases.includes(release))) ?? null;
}

export interface Symbols {
  /** The database the symbols are of ("HGNC Symbol"). */
  database: string;
  release: number;
  /** Each gene asked, with the symbols idtrack gives it there (empty: none). */
  of: Map<string, string[]>;
  /** The database asked is the authority itself: the answer's targets are the symbols, nothing was asked. */
  fromTargets?: boolean;
}

const held = new Map<string, Promise<Symbols | null>>();

/** The most genes asked in one batch (the server's bound is larger; an answer shows far fewer genes). */
const SYMBOLS_MAX = 200;

/** The symbols of `genes` at `release` (one batch request, held for the page's session). */
export function symbolsOf(
  organism: string,
  release: number,
  genes: readonly string[],
  requested: string | null = null,
): Promise<Symbols | null> {
  const unique = [...new Set(genes)].slice(0, SYMBOLS_MAX).sort();
  const key = `${organism}|${release}|${requested ?? ""}|${unique.join(",")}`;
  const known = held.get(key);
  if (known) return known;
  const promise = (async () => {
    if (!unique.length) return null;
    const matrix = await api.databases(organism);
    const database = authorityOf(matrix.data.symbol_databases, matrix.data.databases, release);
    if (!database) return null;
    if (database === requested) return { database, release, of: new Map(), fromTargets: true };
    const answer = await api.batch(organism, {
      identifiers: unique,
      from_release: release,
      to_release: release,
      final_database: database,
      from_database: null,
      explain: false,
      allow_bridges: false,
      // Each gene on its own: no item is read as a copy of another.
      read_copies: false,
    });
    const of = new Map<string, string[]>();
    for (const result of answer.data.results) {
      const symbols =
        result.no_target || result.status === "error"
          ? []
          : [...new Set(result.candidates.filter((c) => c.best).map((c) => c.target))];
      of.set(result.query_id, symbols);
    }
    return { database, release, of };
  })();
  // A failure is not held: a later view asks again.
  promise.catch(() => held.delete(key));
  held.set(key, promise);
  return promise;
}

/** The symbols of an answer's genes, once they come (null before, and where they cannot be had: the answer is shown
 *  without them). */
export function useSymbols(
  organism: string,
  release: number,
  genes: readonly string[],
  requested: string | null = null,
  skip = false,
): Symbols | null {
  const key = `${organism}|${release}|${requested ?? ""}|${[...new Set(genes)].sort().join(",")}`;
  const [state, setState] = useState<{ key: string; symbols: Symbols | null } | null>(null);
  useEffect(() => {
    if (skip || !genes.length) return;
    let live = true;
    symbolsOf(organism, release, genes, requested).then(
      (symbols) => {
        if (live) setState({ key, symbols });
      },
      () => {
        if (live) setState({ key, symbols: null });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the genes, organism and release are named by the key
  }, [key, skip]);
  return state?.key === key ? state.symbols : null;
}
