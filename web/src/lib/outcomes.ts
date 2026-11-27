// An outcome in one sentence, for the page's status line and the tab's title: what was asked and what came back,
// in the api's own terms (its status, its targets); never the whole answer.
import type { ConversionResult } from "../api/types";
import { groupedInteger } from "./numbers";
import { statusTitle } from "./vocabulary";

/** The best targets, at most `shown` of them named, the rest counted. */
function targetsText(targets: readonly string[], shown = 3): string {
  const named = targets.slice(0, shown).join(", ");
  const rest = targets.length - shown;
  return rest > 0 ? `${named} and ${groupedInteger(rest)} more` : named;
}

function bestTargets(result: ConversionResult): string[] {
  return [...new Set(result.candidates.filter((c) => c.best).map((c) => c.target))];
}

/** "Converted: TP53 at release 115 is ENSG00000141510.20 (1 candidate)." */
export function conversionSentence(result: ConversionResult): string {
  const status = statusTitle(result.status);
  const targets = bestTargets(result);
  const candidates = result.candidates.length;
  const counted = candidates ? ` (${groupedInteger(candidates)} candidate${candidates === 1 ? "" : "s"})` : "";
  if (targets.length && !result.no_target) {
    const database =
      result.final_database && result.final_database !== "ensembl_gene" ? ` in ${result.final_database}` : "";
    return `${status}: ${result.query_id} at release ${result.to_release}${database} is ${targetsText(targets)}${counted}.`;
  }
  return `${status}: ${result.query_id}, no answer at release ${result.to_release}${counted}.`;
}

/** The tab's detail of an answer: "TP53 → ENSG00000141510.20", or the status where there is no target. */
export function conversionTitle(result: ConversionResult): string {
  const targets = bestTargets(result);
  if (targets.length && !result.no_target) return `${result.query_id} → ${targetsText(targets, 2)}`;
  return `${result.query_id}: ${statusTitle(result.status)}`;
}

/** "Converted 40 identifiers: 35 converted, 3 not found, 2 tie." */
export function batchSentence(results: readonly ConversionResult[]): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const parts = [...counts].map(([status, n]) => `${groupedInteger(n)} ${statusTitle(status).toLowerCase()}`);
  const n = results.length;
  return `The batch of ${groupedInteger(n)} identifier${n === 1 ? "" : "s"} is answered: ${parts.join(", ")}.`;
}
