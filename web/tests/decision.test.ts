// The deciding criterion shown at the path's end compares the pair idtrack compared: on every recorded answer that has
// one, the shown pair is equal in every criterion before the deciding one and differs in it.
import { describe, expect, it } from "vitest";
import type { Candidate, ConversionResult } from "../src/api/types";
import { buildModel } from "../src/lib/pathModel";
import { readVocabulary } from "../src/lib/vocabulary";
import { conversions, vocabularyResponse } from "./fixtures";

const CRITERIA = readVocabulary(vocabularyResponse()).criteria;

/** A criterion's values as idtrack's ranking compares them: each field the api's vocabulary names for it (the score
 * rounded to 12 places, engine/ranking.py). */
function compared(key: string, c: Candidate): unknown {
  const fields = CRITERIA.find((t) => t.code === key)?.fields ?? [];
  return fields.map(({ field }) => {
    const value = c[field as keyof Candidate];
    return field === "score" && typeof value === "number" ? Math.round(value * 1e12) / 1e12 : JSON.stringify(value);
  });
}

const decided = conversions().filter(({ result }) => result.decided_by !== null);

describe("the recorded answers with a deciding criterion", () => {
  it("cover several criteria", () => {
    const keys = new Set(decided.map(({ result }) => result.decided_by));
    for (const key of ["own_version", "bridge_gap", "entry_support", "score", "same_as_query", "annotation"])
      expect(keys).toContain(key);
  });

  it.each(decided.map((d) => [`${d.entry.organism}/${d.entry.name}`, d.result] as const))(
    "%s",
    (_, result: ConversionResult) => {
      const model = buildModel(result);
      const decision = model.decision;
      expect(decision).not.toBeNull();
      if (!decision) return;
      expect(decision.key).toBe(result.decided_by);
      expect(decision.best.best).toBe(true);
      expect(decision.runnerUp.best).toBe(false);
      expect(decision.runnerUp).toBe(model.candidates.find((c) => !c.best));
      const order = CRITERIA.map((c) => c.code);
      const at = order.indexOf(decision.key);
      expect(at).toBeGreaterThanOrEqual(0);
      for (const key of order.slice(0, at)) {
        if (key === "annotation") continue;
        expect(compared(key, decision.runnerUp.api), key).toEqual(compared(key, decision.best.api));
      }
      if (decision.key === "annotation") {
        expect(decision.runnerUp.api.annotation).not.toBeNull();
      } else {
        expect(compared(decision.key, decision.runnerUp.api)).not.toEqual(compared(decision.key, decision.best.api));
      }
    },
  );
});
