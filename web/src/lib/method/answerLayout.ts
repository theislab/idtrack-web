// The layout of the Method page's figure of an answer's last steps (stage e): the identifier, the best answers' gene,
// the Ensembl forms through which each target is attached, and the targets, one row per target, from the api's path
// (the entry and `final` steps of every best candidate). Nothing is drawn that the api does not send.
import type { ConversionResult, PathStep } from "../../api/types";

export const FORMS = ["read", "ensembl_gene", "ensembl_transcript", "ensembl_translation", "target"] as const;
export type Column = (typeof FORMS)[number];
export const HEADS: Record<Column, string> = {
  read: "read",
  ensembl_gene: "gene",
  ensembl_transcript: "transcript",
  ensembl_translation: "translation",
  target: "id in the database asked",
};

export interface Placed {
  /** Its column and id: an id can stand in two columns (the identifier asked, and the same id as an answer). */
  key: string;
  id: string;
  column: Column;
  row: number;
  best: boolean;
}

/** The nodes and edges of the answer's last steps: the identifier, the best answers' gene, the forms through which
 *  each target is attached, the targets; one row per target. */
export function answerLayout(result: ConversionResult) {
  const path = result.path;
  const steps = path?.steps ?? [];
  const nodes = new Map((path?.nodes ?? []).map((n) => [n.id, n]));
  const best = result.candidates.filter((c) => c.best);
  const placed = new Map<string, Placed>();
  const edges: { from: string; to: string; step: PathStep | null }[] = [];
  const formOf = (id: string): Column => {
    const kind = nodes.get(id)?.kind;
    return kind === "ensembl_gene" || kind === "ensembl_transcript" || kind === "ensembl_translation" ? kind : "read";
  };
  const place = (id: string, column: Column, row: number, isBest: boolean) => {
    const key = `${column}|${id}`;
    if (!placed.has(key)) placed.set(key, { key, id, column, row, best: isBest });
    return key;
  };
  // The identifier, read as its gene: one edge (the forms it was read through are the entry's, in the path's words).
  const read = place(result.query_id, "read", -1, false);
  best.forEach((c, row) => {
    const gene = place(c.gene, "ensembl_gene", -1, c.target === c.gene);
    if (!edges.some((e) => e.from === read && e.to === gene)) edges.push({ from: read, to: gene, step: null });
    for (const i of c.final_path) {
      const step = steps[i];
      if (step?.kind !== "final" || step.source === null) continue;
      const fromColumn = formOf(step.source);
      const from = place(step.source, fromColumn, fromColumn === "ensembl_gene" ? -1 : row, false);
      const isTarget = step.target === c.target;
      const toColumn = isTarget ? "target" : formOf(step.target);
      const to = place(step.target, toColumn, toColumn === "ensembl_gene" ? -1 : row, isTarget);
      if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, step });
    }
  });
  return { placed: [...placed.values()], edges, rows: Math.max(1, best.length) };
}
