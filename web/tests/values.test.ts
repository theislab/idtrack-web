// The ranking record is shown by type: yes or no, a dash for an absent value (its meaning on focus), numbers as the
// api wrote them, and a sort key shown as given and marked.
import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/api/types";
import { ABSENT, candidateValue, prose, yesNo } from "../src/lib/values";
import { conversions } from "./fixtures";

const SPELLINGS = /\b(None|True|False|null|true|false|undefined|NaN)\b/;

describe("candidateValue", () => {
  const candidates: Candidate[] = conversions().flatMap(({ result }) => result.candidates);
  const fields = [
    "own_version",
    "final_confidence",
    "bridges",
    "bridge_gap",
    "entry_support",
    "score",
    "same_as_query",
    "annotation",
  ];

  it("never writes a language's spelling of a value", () => {
    for (const candidate of candidates) {
      for (const field of fields) expect(candidateValue(field, candidate, "x").text).not.toMatch(SPELLINGS);
    }
  });

  it("writes truth values as yes and no, absent values as a dash with the field's meaning", () => {
    const candidate = candidates.find((c) => c.annotation === null && c.final_confidence !== null);
    expect(candidate).toBeDefined();
    if (!candidate) return;
    expect(candidateValue("own_version", candidate).text).toBe(yesNo(candidate.own_version));
    const absent = candidateValue("annotation", candidate, "`None` where it did not.");
    expect(absent.text).toBe(ABSENT);
    expect(absent.title).toContain("none where it did not");
  });

  it("marks a sort key and keeps its numbers as given", () => {
    const candidate = candidates.find((c) => c.annotation !== null);
    expect(candidate).toBeDefined();
    if (!candidate?.annotation) return;
    const shown = candidateValue("annotation", candidate, "meaning");
    expect(shown.sortKey).toBe(true);
    expect(shown.text).toBe(`(${candidate.annotation.join(", ")})`);
  });
});

describe("prose", () => {
  it("writes idtrack's absent value as none and keeps every other code span", () => {
    expect(prose("`None`: no gene; `ensembl_gene` otherwise")).toBe("none: no gene; `ensembl_gene` otherwise");
  });
});
