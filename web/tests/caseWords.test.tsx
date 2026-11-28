// @vitest-environment jsdom
// The gallery's sentences write every history step in Ensembl's direction (the event's earlier id, then its later
// id), whichever way the walk went, and word a walk back in time as one: on the showcase's backward cases of the
// human and pig graphs (a merge, a replacement and a split each), the later id is named as the merge's product or the
// replacement, and the split's genes at the release asked are its ancestors, never genes that descend from it.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { CaseStory } from "../src/components/explore/CaseGallery";
import type { CaseKind } from "../src/lib/home/caseKinds";
import { conceptClauses, ensemblSteps } from "../src/lib/path/steps";
import { readVocabulary } from "../src/lib/vocabulary";
import { description, fixture, vocabularyResponse } from "./fixtures";

afterEach(cleanup);

const vocabulary = readVocabulary(vocabularyResponse());
const answer = (organism: string, name: string) => JSON.parse(fixture(organism, name).raw) as ConversionResult;
const words = (organism: string, kind: CaseKind, result: ConversionResult) =>
  render(
    <CaseStory kind={kind} result={result} graph={description(organism)} vocabulary={vocabulary} />,
  ).container.textContent.replace(/\s+/g, " ");

/** The first step of the best path of the first reason it holds, in Ensembl's direction (as the cards choose it). */
const first = (result: ConversionResult, reasons: string[]) => {
  const steps = ensemblSteps(result);
  const s = reasons.map((r) => steps.find((e) => e.step.reason === r)).find(Boolean);
  if (!s) throw new Error(`no step of ${reasons.join(", ")}`);
  return s;
};

/** The gene's life in the answer's path: the releases at which a version of it is active. */
const activeAt = (result: ConversionResult, id: string, release: number) =>
  (result.path?.nodes.find((n) => n.id === id)?.active ?? []).some(
    ([a, b]) => release >= a && (b === null || release <= b),
  );

describe.each(["homo_sapiens", "sus_scrofa"])("the gallery's sentences of %s's backward cases", (organism) => {
  it("name the merge's product as the later id, which the walk followed back", () => {
    const result = answer(organism, "showcase_merge_back");
    expect(result.to_release).toBeLessThan(result.from_release ?? 0);
    const s = first(result, ["merge"]);
    // Ensembl's direction, read from the genes' own lives: the earlier id at the old release, the later at the new.
    expect(s.backward).toBe(true);
    expect(activeAt(result, s.earlier ?? "", s.old ?? 0)).toBe(true);
    expect(activeAt(result, s.later, s.new ?? 0)).toBe(true);
    const text = words(organism, "merge", result);
    expect(text).toMatch(new RegExp(`merged ${s.earlier ?? ""}( and \\d+ other ids?)? into ${s.later}`));
    expect(text).toContain(`the walk followed it back, from ${s.later} to ${s.earlier ?? ""}`);
    expect(text).not.toContain(`into ${s.earlier ?? ""}`);
    expect(text).not.toContain("merged it with");
  });

  it("name the replacement as the later id", () => {
    const result = answer(organism, "showcase_replaced_back");
    const s = first(result, ["replaced"]);
    expect(s.backward).toBe(true);
    expect(activeAt(result, s.later, s.new ?? 0)).toBe(true);
    const text = words(organism, "replaced", result);
    expect(text).toContain(`Ensembl replaced ${s.earlier ?? ""} by ${s.later}`);
    expect(text).not.toContain(`replaced ${s.later} by`);
    expect(text).toContain("the walk followed it back");
  });

  it("call the split's genes at the release asked its ancestors, never genes that descend from it", () => {
    const result = answer(organism, "showcase_split_back");
    const s = first(result, ["split", "split_and_merge"]);
    expect(s.backward).toBe(true);
    const text = words(organism, "split", result);
    const genes = new Set(result.candidates.map((c) => c.gene)).size;
    expect(text).toContain(`walked back, it leads to its ${genes} ancestors at ${result.to_release}`);
    expect(text).not.toContain("descend");
    expect(text).toMatch(new RegExp(`split ${s.earlier ?? ""} into ${s.later}`));
  });

  it("say in the kind's concept that the walk runs back in time", () => {
    for (const [name, kind] of [
      ["showcase_merge_back", "merge"],
      ["showcase_replaced_back", "replaced"],
      ["showcase_split_back", "split"],
    ] as const) {
      const result = answer(organism, name);
      expect(conceptClauses(kind, result).join(" ")).toContain(
        `the walk runs back in time, from release ${result.from_release ?? ""} to ${result.to_release}`,
      );
    }
  });
});

describe("a forward step", () => {
  it("keeps the walk's order, which is Ensembl's", () => {
    const forward = ["homo_sapiens", "sus_scrofa"]
      .flatMap((o) =>
        ["convert_step_reason_split_and_merge", "convert_step_reason_replaced", "convert_merges_0"].flatMap((n) => {
          try {
            return [answer(o, n)];
          } catch {
            return [];
          }
        }),
      )
      .filter((r) => r.from_release !== null && r.to_release > r.from_release);
    expect(forward.length).toBeGreaterThan(0);
    for (const r of forward)
      for (const s of ensemblSteps(r).filter((e) => e.step.kind === "history")) {
        expect(s.backward).toBe(false);
        expect([s.earlier, s.later]).toEqual([s.step.source, s.step.target]);
      }
  });
});
