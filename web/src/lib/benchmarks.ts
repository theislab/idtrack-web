// The benchmarks' published results (src/generated/benchmarks.json, made by scripts/benchmarks.ts from the files of
// idtrack-reproducibility at the commit it names): what the Method page and the organism pages read of them.
import data from "../generated/benchmarks.json" with { type: "json" };

export type FamilyRow = (typeof data.families)[number]["rows"][number];
export type Family = (typeof data.families)[number];
type ToolRow = (typeof data.tools.tools)[number];

export const BENCHMARKS = data;

/** The repository's address of a file at the commit the results were read at. */
export function benchmarkFile(path: string): string {
  const [file = "", anchor] = path.split("#");
  return `${data.repository}/blob/${data.commit}/${file}${anchor ? `#${anchor}` : ""}`;
}

/** The organisms in the repository's order. */
export const BENCHMARK_ORGANISMS: string[] = data.tools.organisms;

/** A family's rows of its main measurement (not of a part measured apart), by judge where it has two. */
export function familyRows(family: Family): { judge: string | null; rows: Map<string, FamilyRow> }[] {
  const main = family.rows.filter((r) => r.part === null);
  const judges = [...new Set(main.map((r) => r.judge))];
  return judges.map((judge) => ({
    judge,
    rows: new Map(main.filter((r) => r.judge === judge).map((r) => [r.organism, r])),
  }));
}

/** The parts a family measures apart (its document's other rows of totals). */
export function familyParts(family: Family): string[] {
  return [...new Set(family.rows.map((r) => r.part).filter((p): p is string => p !== null))];
}

/** The answers judged (right or wrong; undetermined apart) and the wrong share of them. */
export function judged(row: Pick<FamilyRow, "right" | "wrong">): { judged: number; wrongShare: number } {
  const n = row.right + row.wrong;
  return { judged: n, wrongShare: n ? row.wrong / n : 0 };
}

/** Whether the benchmarks measured the graph this server holds: the same content digest. */
export function measuredGraph(organism: string, digest: string | null): boolean {
  const graphs: Record<string, string> = data.graphs;
  return digest !== null && graphs[organism] === digest;
}

/** The decades of the wrong-share axis both panels share: from one in a million (10⁻⁶) to every answer wrong (1). */
const WRONG_DECADES = 6;

/** The ticks of the wrong-share axis: their exponent and their place on it (0 to 1). */
export const WRONG_TICKS: { exponent: number; at: number }[] = [-6, -4, -2, 0].map((exponent) => ({
  exponent,
  at: (exponent + WRONG_DECADES) / WRONG_DECADES,
}));

/** The place of a wrong share on the logarithmic axis from one in a million (0) to one (1); none at 0. */
export function wrongPosition(share: number): number | null {
  if (share <= 0) return null;
  return Math.min(1, Math.max(0, (Math.log10(share) + WRONG_DECADES) / WRONG_DECADES));
}

/** A rate as published, written so that it never says more than its counts: a rate the source rounded to 1 while
 *  some answer is wrong reads "> 0.99999" (true of its counts), one rounded to 0 while some is right "< 0.00001";
 *  `digits` pads the published text to one precision (a published "0.685" is 0.6850 exactly). The published text
 *  is kept for the note on focus. */
export function rateText(
  published: string,
  counts: { right: number; wrong: number },
  digits?: number,
): { text: string; published: string; rounded: boolean } {
  const decimals = digits ?? Math.max(1, (published.split(".")[1] ?? "").length);
  const value = Number(published);
  if (value >= 1 && counts.wrong > 0) return { text: `> 0.${"9".repeat(decimals)}`, published, rounded: true };
  if (value <= 0 && counts.right > 0) return { text: `< 0.${"0".repeat(decimals - 1)}1`, published, rounded: true };
  const [whole = "0", fraction = ""] = published.split(".");
  return { text: `${whole}.${fraction.padEnd(decimals, "0")}`, published, rounded: false };
}

export type Stratum = Family["strata"]["rows"][number];

/** A family's strata with a wrong answer, those surely the weakest first: by the upper end of the interval (a
 *  stratum of few lines has a wide interval, so a low rate on twelve lines does not stand before a low rate on
 *  thousands), then the rate, then the name. */
export function strataByRate(family: Family): Stratum[] {
  return [...family.strata.rows].sort(
    (a, b) => Number(a.high) - Number(b.high) || Number(a.rate) - Number(b.rate) || (a.stratum < b.stratum ? -1 : 1),
  );
}

/** The stratum of a family that is surely the weakest in an organism: the lowest upper end of its interval. */
export function hardest(family: Family, organism: string): Stratum | null {
  return strataByRate(family).find((s) => s.organism === organism) ?? null;
}

/** An interval as published, written so that it never says more than its counts: where the source rounded its rate
 *  to 1 while some answer is wrong, the interval lies within the last unit below 1 ("within 0.99999–1"). */
export function intervalText(row: { low: string; high: string; rate: string; right: number; wrong: number }): string {
  if (rateText(row.rate, row).rounded && Number(row.low) >= 1) {
    const decimals = (row.low.split(".")[1] ?? "").length;
    return `within 0.${"9".repeat(decimals)}–1`;
  }
  return `${row.low}–${row.high}`;
}

/** How many strata of a family have no wrong answer in each organism. */
export function cleanStrata(family: Family): [string, number][] {
  const clean: Record<string, number | undefined> = family.strata.clean;
  return Object.entries(clean).filter((e): e is [string, number] => e[1] !== undefined);
}

export type ToolCell = NonNullable<ToolRow["cells"][number]>;

/** A tool's wrong share on its kept lines, from its counts: (wrong + error) / (right + wrong + error). */
export function toolWrongShare(cell: ToolCell): number {
  const n = cell.right + cell.wrong + cell.error;
  return n ? (cell.wrong + cell.error) / n : 0;
}

/** idtrack's wrong share on the same lines, from its published rate (4 decimals): exact 0 where the rate is 1 and
 *  half a unit of the last decimal is less than one line of the lines asked, else 1 − the rate, with whether it is
 *  only bounded (a published 1 that a wrong line could hide in). */
export function idtrackWrongShare(cell: ToolCell): { share: number; bounded: boolean } {
  const rate = Number(cell.idtrack);
  const decimals = (cell.idtrack.split(".")[1] ?? "").length;
  if (rate >= 1) return { share: 0, bounded: 0.5 * 10 ** -Math.max(decimals, 4) * cell.idtrackN >= 1 };
  return { share: 1 - rate, bounded: false };
}

/** How many times idtrack's wrong share the tool's is, in words. idtrack's share comes from a rate published to 4
 *  decimals, so it is known to half a unit of the last one: the ratio is written as the range that leaves ("460–770×"),
 *  or as one value where that range is narrow ("about 6.2×"); null where there is nothing to compare. */
export function wrongRatio(tool: number, idtrack: number, half = 0.5e-4): string | null {
  if (idtrack <= 0 || tool <= 0) return null;
  const two = (x: number) => Number(x.toPrecision(2)).toString();
  const lo = tool / (idtrack + half);
  if (idtrack - half <= 0) return `more than ${two(lo)}×`;
  const hi = tool / (idtrack - half);
  if (hi / lo <= 1.1) return `about ${two(tool / idtrack)}×`;
  return `${two(lo)}–${two(hi)}×`;
}
