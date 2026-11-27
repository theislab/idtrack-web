// What a batch's identifiers that convert to nothing were (`no_conversion`): the life of the gene each was at the
// release it was read at (its releases, its last release, its assembly) and the name the organism's name authority gave
// it there. Read from the api alone, as the answer page's life of a retired id is: the identifiers of one release
// converted at that release with their paths (each gene's `active` releases and assemblies), and the same identifiers
// converted there into the name authority. One or two requests per release read at, in requests of the server's bound.
import { api } from "../api/client";
import type { BatchRequest, ConversionResult, GraphDescription, PathNode } from "../api/types";
import { assemblyNames, assemblyText } from "./pathReading";
import { useRequest } from "./useRequest";
import { useLimits } from "./vocabularyContext";

/** One gene the identifier was at its release: its id, its releases, the last of them (null: still active at the
 *  graph's last release), its assemblies by name. */
interface LifeGene {
  gene: string;
  active: [number, number | null][];
  last: number | null;
  assemblies: string[];
}

export interface Life {
  /** The release the identifier was read at. */
  release: number;
  genes: LifeGene[];
  /** The ids the name authority gave it at that release (empty: none); null where the authority was not asked. */
  names: string[] | null;
  /** The name authority asked. */
  authority: string | null;
}

/** The last release of a gene, where its life ends inside the graph (null: still active). */
function lastOf(active: PathNode["active"]): number | null {
  if (!active.length || active.some(([, b]) => b === null)) return null;
  return Math.max(...active.map(([, b]) => b ?? 0));
}

/** The genes of a result at the release it was read at, with their lives, read from its path's nodes. */
function lifeGenes(result: ConversionResult, description: GraphDescription): LifeGene[] {
  const nodes = new Map((result.path?.nodes ?? []).map((n) => [n.id, n]));
  const names = assemblyNames(description.assemblies);
  return [...new Set(result.candidates.map((c) => c.gene))].flatMap((id) => {
    const node = nodes.get(id);
    if (!node?.active.length) return [];
    return [
      {
        gene: node.label,
        active: node.active.map(([a, b]): [number, number | null] => [a, b]),
        last: lastOf(node.active),
        assemblies: node.assemblies.map((a) => assemblyText(a, names)),
      },
    ];
  });
}

/** A gene's releases as Ensembl writes a life: "62–75", "115 on" (active at the graph's last release). */
export function lifeText(active: readonly (readonly [number, number | null])[]): string {
  return active.map(([a, b]) => (b === null ? `${a} on` : a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

/** The lives of the rows that convert to nothing, by the row's index, and the requests that gave them; null while they
 *  are asked or where the server did not give them. */
export interface Lives {
  byRow: ReadonlyMap<number, Life>;
  requestIds: (string | null)[];
  /** The releases asked, each with the number of identifiers. */
  asked: [number, number][];
}

export function useRetiredLives(
  description: GraphDescription,
  rows: readonly { index: number; result: ConversionResult }[],
  authority: string | null,
): Lives | null {
  const organism = description.organism;
  const limits = useLimits();
  const bound = limits?.batch_max ?? 1000;
  const byRelease = new Map<number, string[]>();
  for (const { result: r } of rows) {
    if (r.status !== "no_conversion" || r.graph_id === null || r.from_release === null) continue;
    const list = byRelease.get(r.from_release) ?? [];
    if (!list.includes(r.graph_id)) list.push(r.graph_id);
    byRelease.set(r.from_release, list);
  }
  const wanted = [...byRelease.entries()].sort((a, b) => a[0] - b[0]);
  const key = wanted.length ? `${organism}|lives|${authority ?? ""}|${JSON.stringify(wanted)}` : null;
  const answer = useRequest(key, async (signal) => {
    const lives = new Map<string, Life>();
    const requestIds: (string | null)[] = [];
    let last: { requestId: string | null; serverTiming: string | null } = { requestId: null, serverTiming: null };
    const at = (release: number, identifiers: string[], final: string | null, explain: boolean) => {
      const body: BatchRequest = {
        identifiers,
        from_release: release,
        to_release: release,
        final_database: final,
        from_database: null,
        explain,
        allow_bridges: false,
        read_copies: false,
      };
      return api.batch(organism, body, signal);
    };
    for (const [release, ids] of wanted) {
      for (let i = 0; i < ids.length; i += bound) {
        const part = ids.slice(i, i + bound);
        const lifeReply = await at(release, part, null, true);
        last = lifeReply;
        requestIds.push(lifeReply.requestId);
        const nameReply = authority ? await at(release, part, authority, false) : null;
        if (nameReply) requestIds.push(nameReply.requestId);
        part.forEach((id, k) => {
          const life = lifeReply.data.results[k];
          const named = nameReply?.data.results[k];
          lives.set(`${String(release)}|${id}`, {
            release,
            genes: life ? lifeGenes(life, description) : [],
            names:
              named === undefined
                ? null
                : named.no_target
                  ? []
                  : [...new Set(named.candidates.filter((c) => c.best).map((c) => c.target))],
            authority,
          });
        });
      }
    }
    return { data: { lives, requestIds }, raw: "", requestId: last.requestId, serverTiming: last.serverTiming };
  });
  if (!wanted.length) return { byRow: new Map(), requestIds: [], asked: [] };
  if (answer.state !== "done") return null;
  const byRow = new Map<number, Life>();
  for (const { index, result: r } of rows) {
    if (r.status !== "no_conversion" || r.graph_id === null || r.from_release === null) continue;
    const life = answer.answer.data.lives.get(`${String(r.from_release)}|${r.graph_id}`);
    if (life) byRow.set(index, life);
  }
  return {
    byRow,
    requestIds: answer.answer.data.requestIds,
    asked: wanted.map(([release, ids]): [number, number] => [release, ids.length]),
  };
}
