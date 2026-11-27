// The benchmarks' published results (src/generated/benchmarks.json, made by scripts/benchmarks.ts from the files of
// idtrack-reproducibility at the commit it names): what the Method page and the organism pages read of them.
import data from "../generated/benchmarks.json" with { type: "json" };
import { commonName, organismName } from "./organismNames";

export type FamilyRow = (typeof data.families)[number]["rows"][number];
export type Family = (typeof data.families)[number];
type ToolRow = (typeof data.tools.tools)[number];

export const BENCHMARKS = data;

export { BENCHMARK_ORGANISMS, measuredGraph } from "./benchmarksMeta";

/** The repository's address of a file at the commit the results were read at. */
export function benchmarkFile(path: string): string {
  const [file = "", anchor] = path.split("#");
  return `${data.repository}/blob/${data.commit}/${file}${anchor ? `#${anchor}` : ""}`;
}

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

/** Whether a stratum is one in which no line is judged right in any organism (the generator's `wrongOnly`): its
 *  lines can only be judged wrong or undetermined (D's open lines, judged by open_within), so its rate is 0 whatever
 *  idtrack answers. Such a stratum is no measure of agreement: it is said as a count, never as a rate. */
export function wrongOnly(family: Family, stratum: string): boolean {
  const codes: readonly string[] = family.strata.wrongOnly;
  return codes.includes(stratum);
}

/** The stratum of a family that is surely the weakest in an organism: the lowest upper end of its interval, among
 *  the strata that can be judged right (`wrongOnly` ones are counts, not rates). */
export function hardest(family: Family, organism: string): Stratum | null {
  return strataByRate(family).find((s) => s.organism === organism && !wrongOnly(family, s.stratum)) ?? null;
}

/** The lines of an organism in the strata where no answer can be judged right: how many, and how many of them are
 *  answered wrong (the rest undetermined). */
export function wrongOnlyCounts(family: Family, organism: string): { strata: number; wrong: number; n: number } {
  const rows = family.strata.rows.filter((s) => s.organism === organism && wrongOnly(family, s.stratum));
  return {
    strata: rows.length,
    wrong: rows.reduce((t, s) => t + s.wrong, 0),
    n: rows.reduce((t, s) => t + s.n, 0),
  };
}

/** What a stratum asks, in its family document's words, or null where the document does not describe it. */
export function stratumMeaning(family: Family, stratum: string): string | null {
  const meanings: Record<string, string | null | undefined> = family.strata.meanings;
  return meanings[stratum] ?? null;
}

/** The 95 % interval of a stratum as the page writes it: the published one, unless its two ends are written alike
 *  (a cluster bootstrap whose units all answer alike, or ends rounded to one value), which is no interval: then,
 *  from the counts, the exact (Clopper–Pearson) interval where every judged line is right or every one wrong, and
 *  Wilson's otherwise, each with as many decimals as its two ends need to differ (at least the published ones). */
export function shownInterval(row: { low: string; high: string; rate: string; right: number; wrong: number }): {
  text: string;
  method: "published" | "exact" | "wilson";
} {
  if (row.low !== row.high) return { text: intervalText(row), method: "published" };
  const n = row.right + row.wrong;
  const alpha = 0.05;
  let low: number;
  let high: number;
  let method: "exact" | "wilson";
  if (row.right === 0) {
    [low, high, method] = [0, 1 - (alpha / 2) ** (1 / n), "exact"];
  } else if (row.wrong === 0) {
    [low, high, method] = [(alpha / 2) ** (1 / n), 1, "exact"];
  } else {
    [low, high] = wilsonInterval(row.right, n);
    method = "wilson";
  }
  const published = Math.max(1, (row.low.split(".")[1] ?? "").length);
  let digits = published;
  while (digits < 8 && low.toFixed(digits) === high.toFixed(digits)) digits += 1;
  // Ends written outward, so that the written interval holds the computed one.
  const floor = (x: number) => (Math.floor(x * 10 ** digits) / 10 ** digits).toFixed(digits);
  const ceil = (x: number) => Math.min(1, Math.ceil(x * 10 ** digits) / 10 ** digits).toFixed(digits);
  return { text: `${floor(low)}–${ceil(high)}`, method };
}

/** Wilson's 95 % interval of a share. */
function wilsonInterval(right: number, judged: number): [number, number] {
  const z = 1.959963984540054;
  if (!judged) return [0, 1];
  const p = right / judged;
  const d = 1 + (z * z) / judged;
  const c = (p + (z * z) / (2 * judged)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / judged + (z * z) / (4 * judged * judged))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
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
export type Tool = ToolRow;

/** Whether a tool's cell can be set beside idtrack's: not where no kept line has an answer (coverage 0 on kept
 *  lines), for then every right line is one whose truth is nothing and the tool named no gene of the graph's
 *  annotation (G's reading names why: another annotation's genes only); its rate there measures no answer. */
export function comparable(cell: ToolCell): boolean {
  return !(cell.kept > 0 && Number(cell.coverage) === 0);
}

/** For one task, the comparisons of the tools with idtrack on the same lines, every organism together: how many
 *  find the tool wrong more often, as often (both none wrong), or less often, and the smallest and largest ratio of
 *  the wrong shares with their tool and organism; the cells that cannot be compared are counted apart. */
export function taskComparison(task: string): {
  compared: number;
  more: number;
  same: number;
  fewer: number;
  apart: number;
  least: { tool: string; organism: string; ratio: string } | null;
  most: { tool: string; organism: string; ratio: string } | null;
  tools: number;
  /** The tool's name where only one poses the task. */
  only: string | null;
} {
  let compared = 0;
  let more = 0;
  let same = 0;
  let fewer = 0;
  let apart = 0;
  const ratios: { tool: string; organism: string; value: number; ratio: string }[] = [];
  const rows = data.tools.tools.filter((t) => t.task === task);
  for (const t of rows)
    for (const c of t.cells) {
      if (!c) continue;
      if (!comparable(c)) {
        apart += 1;
        continue;
      }
      compared += 1;
      const tool = toolWrongShare(c);
      const ours = idtrackWrongShare(c);
      if (tool === 0 && ours.share === 0) same += 1;
      else if (tool > ours.share) more += 1;
      else if (tool < ours.share) fewer += 1;
      else same += 1;
      const ratio = wrongRatio(tool, ours.share);
      if (ratio && ours.share > 0) ratios.push({ tool: t.tool, organism: c.organism, value: tool / ours.share, ratio });
    }
  ratios.sort((a, b) => a.value - b.value);
  const pick = (r: (typeof ratios)[number] | undefined) =>
    r ? { tool: r.tool, organism: r.organism, ratio: r.ratio } : null;
  return {
    compared,
    more,
    same,
    fewer,
    apart,
    least: pick(ratios[0]),
    most: pick(ratios[ratios.length - 1]),
    tools: new Set(rows.map((t) => t.tool)).size,
    only: new Set(rows.map((t) => t.tool)).size === 1 ? (rows[0]?.tool ?? null) : null,
  };
}

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

/** An organism as the page names it: its common name, else its binomial. */
export const organismWord = (o: string): string => commonName(o) ?? organismName(o);

/** A power of ten as its label writes it: the base and the exponent (with a true minus sign), the exponent drawn
 *  raised at the floor of the type scale and the base a step above it, so no text is under 11 px; null for 1. */
export function powerParts(exponent: number): { base: string; exponent: string } | null {
  if (exponent === 0) return null;
  return { base: "10", exponent: String(exponent).replace("-", "−") };
}

/** What a judge measures, by its role (the commit and the repository's own words are in the provenance). */
export function judgeWords(judge: string): string {
  if (judge === "decided")
    return "with the rules idtrack has decided: a line a decided rule changes expects its answer";
  if (judge === "now") return "by the base set: each line as idtrack documented it before its decided rules";
  return judge;
}
