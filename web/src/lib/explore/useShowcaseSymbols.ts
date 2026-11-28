// The symbols of the Ensembl genes the home names (the journeys' answers, the cases' genes), each at the release it is
// named at: IDTrack's own conversion of the gene into the organism's name authority at that release, one batch per
// release for the whole page (lib/symbols.ts, held for the page session), never a request per gene. A gene the
// authority gives no symbol shows none; where they cannot be had, the page shows the ids alone.
import { useEffect, useState } from "react";
import { symbolsOf } from "../symbols";

export interface Named {
  gene: string;
  release: number;
}

/** The symbols of `genes`, by gene id (null until every batch has answered, or where none could be had), and whether
 *  the batches have answered (or failed): a view that would move when the symbols come can wait for it. */
export function useShowcaseSymbols(
  organism: string,
  genes: readonly Named[],
): { symbols: Map<string, string[]> | null; settled: boolean } {
  const byRelease = new Map<number, string[]>();
  for (const g of genes) byRelease.set(g.release, [...(byRelease.get(g.release) ?? []), g.gene]);
  const key = `${organism}|${[...byRelease.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, ids]) => `${r}:${[...new Set(ids)].sort().join(",")}`)
    .join(";")}`;
  const [state, setState] = useState<{ key: string; symbols: Map<string, string[]> | null } | null>(null);
  useEffect(() => {
    if (!genes.length) return;
    let live = true;
    Promise.all([...byRelease.entries()].map(([release, ids]) => symbolsOf(organism, release, ids))).then(
      (answers) => {
        if (!live) return;
        const merged = new Map<string, string[]>();
        for (const a of answers) for (const [gene, symbols] of a?.of ?? []) merged.set(gene, symbols);
        setState({ key, symbols: answers.some((a) => a !== null) ? merged : null });
      },
      () => {
        if (live) setState({ key, symbols: null });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the genes and organism are named by the key
  }, [key]);
  if (!genes.length) return { symbols: null, settled: true };
  return state?.key === key ? { symbols: state.symbols, settled: true } : { symbols: null, settled: false };
}
