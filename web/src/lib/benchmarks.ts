// The benchmarks' published results (src/generated/benchmarks.json, made by scripts/benchmarks.ts from the files of
// idtrack-reproducibility at the commit it names): what the Method page and the organism pages read of them.
import data from "../generated/benchmarks.json" with { type: "json" };
import { groupedInteger } from "./numbers";
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

/** The share of a row's lines that were judged (right or wrong; the undetermined lines are not counted), written to one
 *  decimal of a per cent so that it never says more than its counts: "100 %" only where every line is judged, "0 %"
 *  only where none is (a share that rounds to either while it is not is "> 99.9 %" or "< 0.1 %"). */
export function judgedText(row: Pick<FamilyRow, "right" | "wrong" | "n">): string {
  const judgedLines = row.right + row.wrong;
  if (!row.n) return "—";
  if (judgedLines === row.n) return "100 %";
  if (judgedLines === 0) return "0 %";
  const share = (judgedLines / row.n) * 100;
  const text = share.toFixed(1);
  if (text === "100.0") return "> 99.9 %";
  if (text === "0.0") return "< 0.1 %";
  return `${text} %`;
}

/** The items of a family's truth that name a commit of code (a quoted hexadecimal commit): the parts of its truth read
 *  from a checkout of IDTrack's code (the benchmarks name no other code by commit), so not independent of it. */
export function truthFromIdtrack(family: Family): { lead: string; text: string }[] {
  return family.truth.items.filter((item) => /`[0-9a-f]{7,40}`/.test(item.text));
}

/** The range of a family-by-organism rate the page states first: the lowest and the highest headline rate (each
 *  family's main measurement under the judge its document says to read), each with its family and organism. */
export function rateRange(): {
  low: { family: Family; organism: string; row: FamilyRow };
  high: { family: Family; organism: string; row: FamilyRow };
  families: number;
  organisms: number;
} | null {
  const all: { family: Family; organism: string; row: FamilyRow }[] = [];
  for (const family of data.families) {
    const [first] = familyRows(family);
    for (const [organism, row] of first?.rows ?? []) all.push({ family, organism, row });
  }
  if (!all.length) return null;
  const sorted = [...all].sort((a, b) => Number(a.row.rate) - Number(b.row.rate) || a.row.wrong - b.row.wrong);
  const low = sorted[0];
  const high = [...all].sort((a, b) => Number(b.row.rate) - Number(a.row.rate) || a.row.wrong - b.row.wrong)[0];
  if (!low || !high) return null;
  return {
    low,
    high,
    families: new Set(all.map((x) => x.family.key)).size,
    organisms: new Set(all.map((x) => x.organism)).size,
  };
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
 *  IDTrack answers. Such a stratum is no measure of agreement: it is said as a count, never as a rate. */
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

/** Whether a tool's cell can be set beside IDTrack's: not where no kept line has an answer (coverage 0 on kept
 *  lines), for then every right line is one whose truth is nothing and the tool named no gene of the graph's
 *  annotation (G's reading names why: another annotation's genes only); its rate there measures no answer. */
export function comparable(cell: ToolCell): boolean {
  return !(cell.kept > 0 && Number(cell.coverage) === 0);
}

/** For one task, the comparisons of the tools with IDTrack on the same lines, every organism together: how many
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
  /** The comparisons with no ratio: the tool disagrees on some lines, IDTrack on none (or on fewer than its published
   *  rate can show: `bounded`), each with the tool's share of disagreements. */
  unrated: { tool: string; organism: string; share: number; bounded: boolean }[];
  /** What the family's reading of a sample of each tool's disagreements found truly wrong (weighted per cent). */
  truly: { tool: string; truly: number; read: number }[];
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
  const unrated: { tool: string; organism: string; share: number; bounded: boolean }[] = [];
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
      else if (tool > 0 && ours.share === 0)
        unrated.push({ tool: t.tool, organism: c.organism, share: tool, bounded: ours.bounded });
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
    unrated,
    truly: rows
      .map((t) => t.reading)
      .filter((r): r is NonNullable<ToolRow["reading"]> => r !== null)
      .map((r) => ({ tool: r.tool, truly: r.truly, read: r.read })),
    tools: new Set(rows.map((t) => t.tool)).size,
    only: new Set(rows.map((t) => t.tool)).size === 1 ? (rows[0]?.tool ?? null) : null,
  };
}

/** A tool's wrong share on its kept lines, from its counts: (wrong + error) / (right + wrong + error). */
export function toolWrongShare(cell: ToolCell): number {
  const n = cell.right + cell.wrong + cell.error;
  return n ? (cell.wrong + cell.error) / n : 0;
}

/** IDTrack's wrong share on the same lines, from its published rate (4 decimals): exact 0 where the rate is 1 and
 *  half a unit of the last decimal is less than one line of the lines asked, else 1 − the rate, with whether it is
 *  only bounded (a published 1 that a wrong line could hide in). */
export function idtrackWrongShare(cell: ToolCell): { share: number; bounded: boolean } {
  const rate = Number(cell.idtrack);
  const decimals = (cell.idtrack.split(".")[1] ?? "").length;
  if (rate >= 1) return { share: 0, bounded: 0.5 * 10 ** -Math.max(decimals, 4) * cell.idtrackN >= 1 };
  return { share: 1 - rate, bounded: false };
}

/** How many times IDTrack's wrong share the tool's is, in words. IDTrack's share comes from a rate published to 4
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
    return "with the rules IDTrack has decided: a line a decided rule changes expects its answer";
  if (judge === "now") return "by the base set: each line as IDTrack documented it before its decided rules";
  return judge;
}

const plural = (n: number, one: string, many = `${one}s`) => `${groupedInteger(n)} ${n === 1 ? one : many}`;

const percent = (share: number) => `${(share * 100).toFixed(1)} %`;

/** One task's comparisons in words, as wide as their evidence: how often each tool disagrees with the truth on the
 *  same lines more often than IDTrack; the range of the ratios of the shares of disagreement, with the comparisons it
 *  leaves out (where IDTrack disagrees on none, so no ratio exists) named; the cells not compared; and what the
 *  family's reading of a sample of the disagreements found truly wrong. */
export function taskWords(c: ReturnType<typeof taskComparison>): string {
  const where = (x: { tool: string; organism: string }) =>
    c.tools === 1 ? organismWord(x.organism) : `${x.tool}, ${organismWord(x.organism)}`;
  const counts = [
    c.more ? `more often than IDTrack in ${groupedInteger(c.more)}` : null,
    c.same ? `as often in ${groupedInteger(c.same)}` : null,
    c.fewer ? `less often in ${groupedInteger(c.fewer)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lead =
    c.tools === 1
      ? `${c.only ?? "One tool"}, the one tool that poses it, disagrees with the truth on the same lines ${c.more === c.compared ? "more often than IDTrack in every organism" : `${counts} of ${plural(c.compared, "organism")}`}`
      : `Of ${plural(c.tools, "tool")} asked on the same lines, ${c.more === c.compared ? `each disagrees with the truth more often than IDTrack, in each of ${plural(c.compared, "organism comparison")}` : `a tool disagrees with the truth ${counts} of ${plural(c.compared, "tool and organism comparison")}`}`;
  const range =
    c.least && c.most
      ? c.least.ratio === c.most.ratio
        ? `: ${c.most.ratio} IDTrack's share of disagreements (${where(c.most)})`
        : `: from ${c.least.ratio} IDTrack's share of disagreements (${where(c.least)}) to ${c.most.ratio} (${where(c.most)})`
      : "";
  // The comparisons with no ratio are among those counted above: named where they are few, counted where many.
  const unrated = c.unrated.length
    ? c.unrated.length <= 2
      ? `; in ${c.unrated.length === 1 ? "one" : "two"} of them IDTrack disagrees on no line, so there is no ratio: ${c.unrated
          .map(
            (u) =>
              `${where(u)}, where the tool disagrees on ${percent(u.share)}${u.bounded ? " (IDTrack on fewer than its four published decimals show)" : ""}`,
          )
          .join("; ")}`
      : `; in ${groupedInteger(c.unrated.length)} of them IDTrack disagrees on no line (or on fewer than its four published decimals show), so they have no ratio`
    : "";
  const apart = c.apart ? `; ${plural(c.apart, "cell")} not compared, no kept line having an answer` : "";
  const read = c.truly.length
    ? c.truly.length === 1
      ? ` Of ${groupedInteger(c.truly[0]?.read ?? 0)} of its disagreements read, ${String(c.truly[0]?.truly ?? 0)} % are truly wrong.`
      : (() => {
          const sorted = [...c.truly].sort((a, b) => a.truly - b.truly);
          const lo = sorted[0];
          const hi = sorted[sorted.length - 1];
          return lo && hi
            ? lo.truly === hi.truly
              ? ` Of their disagreements read, ${String(lo.truly)} % are truly wrong for each tool.`
              : ` Of their disagreements read, from ${String(lo.truly)} % (${lo.tool}) to ${String(hi.truly)} % (${hi.tool}) are truly wrong.`
            : "";
        })()
    : "";
  return `${lead}${range}${unrated}${apart}.${read}`;
}
