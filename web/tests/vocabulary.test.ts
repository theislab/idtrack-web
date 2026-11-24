// The page's words for the api's codes are the api's own (`/vocabulary`): every code the recorded answers carry has its
// entry there, and the page writes none of its own.
import { describe, expect, it } from "vitest";
import { criterionOf, readVocabulary, spaced, statusTitle } from "../src/lib/vocabulary";
import { conversions, ORGANISMS, recorded, vocabularyResponse } from "./fixtures";

const served = vocabularyResponse();
const vocabulary = readVocabulary(served);

describe("the api's vocabulary", () => {
  it("names every status, reason, step reason and criterion of the recorded answers", () => {
    for (const { result } of conversions()) {
      expect(vocabulary.statuses.has(result.status), result.status).toBe(true);
      if (result.reason) expect(vocabulary.reasons.get(result.reason), result.reason).toBeTruthy();
      if (result.decided_by) expect(criterionOf(vocabulary, result.decided_by)?.meaning).toBeTruthy();
      for (const step of result.path?.steps ?? []) {
        expect(vocabulary.stepReasons.get(step.reason), step.reason).toBeTruthy();
      }
    }
  });

  it("names every error code the recorded answers hold", () => {
    for (const organism of ORGANISMS) {
      for (const entry of recorded(organism).filter((e) => e.status >= 400)) {
        const body = JSON.parse(entry.raw) as { error: { code: string } };
        const term = vocabulary.errors.get(body.error.code);
        expect(term, body.error.code).toBeDefined();
        expect(term?.status).toBe(entry.status);
      }
    }
  });

  it("gives the criteria in the order in which they decide", () => {
    expect(vocabulary.criteria.map((c) => c.code)).toEqual(served.criteria.map((c) => c.code));
    expect(criterionOf(vocabulary, "score")?.index).toBe(served.criteria.findIndex((c) => c.code === "score"));
    expect(criterionOf(vocabulary, "no_such_criterion")).toBeNull();
  });

  it("is read as served, meanings unchanged", () => {
    for (const term of served.reasons) expect(vocabulary.reasons.get(term.code)).toBe(term.meaning);
    for (const term of served.step_reasons) expect(vocabulary.stepReasons.get(term.code)).toBe(term.meaning);
    for (const term of served.errors) expect(vocabulary.errors.get(term.code)?.meaning).toBe(term.meaning);
  });
});

describe("codes for reading", () => {
  it("are the codes spaced, never a meaning", () => {
    expect(spaced("split_and_merge")).toBe("split and merge");
    expect(statusTitle("no_target")).toBe("No target");
    expect(statusTitle("converted")).toBe("Converted");
  });
});
