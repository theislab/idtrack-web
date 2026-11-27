// What the result's figure adds to the path view's model, checked on every recorded real answer: the labels never
// overlap and say only the ids and scores the api sent; the anatomy of an answer counts the api's own lists; the
// timeline's parts are the words of the step's sentence; a lane's answers fold without losing a candidate.
import { describe, expect, it } from "vitest";
import { anatomyOf } from "../src/lib/anatomy";
import { middleCut, placeLabels, type LabelRequest } from "../src/components/figure/labels";
import { pythonFloat } from "../src/lib/numbers";
import {
  HORIZONTAL_METRICS,
  laneLabel,
  laneNames,
  layoutPath,
  pathLabels,
  scoreSteps,
  versionPart,
} from "../src/lib/pathLayout";
import { buildModel } from "../src/lib/pathModel";
import { assemblyNames, stepParts, stepSentence } from "../src/lib/pathReading";
import { readVocabulary } from "../src/lib/vocabulary";
import { conversions, description, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());
const criteria = vocabulary.criteria.map((c) => c.code);
const all = conversions();
const withPath = all.filter(({ result }) => result.path !== null && result.path.steps.length > 0);
const named = (list: typeof all) => list.map((c) => [`${c.entry.organism}/${c.entry.name}`, c] as const);

describe("placeLabels", () => {
  it("places labels in order, never two overlapping in a row, and leaves out what fits nowhere", () => {
    const requests: LabelRequest[] = Array.from({ length: 40 }, (_, i) => ({
      key: `k${i}`,
      anchor: 30 + i * 7,
      forms: [`label${i}`],
      align: i % 3 ? "start" : "center",
      rows: ["a", "b"],
    }));
    const placed = placeLabels(requests, { bounds: [0, 300] });
    expect(placeLabels(requests, { bounds: [0, 300] })).toEqual(placed);
    const byRow = new Map<string, [number, number][]>();
    for (const label of placed.values()) {
      expect(label.t0).toBeGreaterThanOrEqual(0);
      expect(label.t1).toBeLessThanOrEqual(300);
      for (const [a, b] of byRow.get(label.row) ?? []) expect(label.t0 >= b + 6 || a >= label.t1 + 6).toBe(true);
      byRow.set(label.row, [...(byRow.get(label.row) ?? []), [label.t0, label.t1]]);
    }
    expect(placed.size).toBeLessThan(requests.length);
    expect(placed.has("k0")).toBe(true);
  });

  it("labels a gene after a gene of the same id by its version only", () => {
    expect(laneLabel("ENSG00000141510.6", "ENSG00000141510.5")).toBe(".6");
    expect(laneLabel("ENSG00000141510.6", null)).toBe("ENSG00000141510.6");
    expect(laneLabel("ENSG00000141511.1", "ENSG00000141510.5")).toBe("ENSG00000141511.1");
    expect(laneLabel("MIR21", "ENSG00000199004.1")).toBe("MIR21");
    expect(versionPart("ENSG00000141510")).toBeNull();
    // A lane named by the id its genes share: its first gene by its version.
    expect(laneLabel("ENSG00000141510.5", "ENSG00000141510")).toBe(".5");
  });

  it("cuts only an identifier, in its middle, keeping its start and its version", () => {
    expect(middleCut("ENSSSCG00000008047.2", 15)).toBe("ENSSSCG…08047.2");
    expect(middleCut("TP53", 15)).toBe("TP53");
    expect(middleCut("ENSSSCG00000008047.2", 5)).toBeNull();
  });
});

describe.each(named(withPath))("%s", (_, { entry, result }) => {
  const model = buildModel(result);
  const names = assemblyNames(description(entry.organism).assemblies);

  it("labels the drawing without overlap, with the ids the api sent, and puts every strong score on the track", () => {
    for (const scale of [(r: number) => 100 + r * 4, (r: number) => 100 + r * 18, (r: number) => r * 60]) {
      const layout = layoutPath(model, { scale, answerT: scale(200), metrics: HORIZONTAL_METRICS, limit: 10 });
      const strong = (candidates: number[], best: boolean) => best && candidates.length >= 0;
      const names = laneNames(layout);
      const genes = pathLabels(layout, [scale(30), scale(130)], names);
      const rows = new Map<string, [number, number][]>();
      for (const label of genes.values()) {
        expect(label.t0).toBeGreaterThanOrEqual(scale(30) - 0.5);
        expect(label.t1).toBeLessThanOrEqual(scale(130) + 0.5);
        for (const [a, b] of rows.get(label.row) ?? []) expect(label.t0 >= b || a >= label.t1).toBe(true);
        rows.set(label.row, [...(rows.get(label.row) ?? []), [label.t0, label.t1]]);
      }
      for (const label of genes.values()) {
        const node = model.nodeById.get(label.key.slice(2));
        expect(node).toBeDefined();
        const full = node?.label ?? "";
        // The full id; its version where the gene before it on its lane (or the lane's name) has the same id; or the
        // id cut in its middle, its start and end kept.
        const [head = "", tail = ""] = label.text.split("…");
        expect(
          label.text === full ||
            (label.text.startsWith(".") && full.endsWith(label.text)) ||
            (label.text.includes("…") && full.startsWith(head) && full.endsWith(tail)),
        ).toBe(true);
      }
      // Every strong step of Ensembl's history is on the score track with the api's own score, and nothing else is.
      const track = scoreSteps(layout, strong);
      for (const { edge, weight } of track) {
        expect(["history", "self_loop"]).toContain(edge.step.api.kind);
        expect(weight).toBe(edge.step.api.weight);
      }
      const expected = layout.edges.filter(
        (e) => (e.step.api.kind === "history" || e.step.api.kind === "self_loop") && e.step.best,
      );
      expect(track.length).toBe(expected.length);
    }
  });

  it("states the anatomy from the result's own lists", () => {
    const anatomy = anatomyOf(result, model, criteria);
    const best = model.candidates.find((c) => c.best) ?? null;
    expect(anatomy.walked.steps).toBe(best?.steps.length ?? 0);
    expect(anatomy.walked.byReason.reduce((n, r) => n + r.count, 0)).toBe(anatomy.walked.steps);
    for (const r of anatomy.walked.byReason) {
      expect(r.count).toBe(best?.steps.filter((i) => model.steps[i]?.api.reason === r.reason).length);
    }
    expect(anatomy.walked.handoffs).toBe(best?.steps.filter((i) => model.steps[i]?.handoff).length ?? 0);
    // Each handoff is one change of assembly along the path.
    if (anatomy.walked.handoffs) expect(anatomy.walked.assemblies.length).toBeGreaterThan(anatomy.walked.handoffs);
    for (const a of anatomy.walked.assemblies) expect(names.has(a)).toBe(true);
    const bridges = result.path?.bridges ?? [];
    expect(anatomy.walked.bridgesTaken + anatomy.walked.bridgesRefused).toBe(bridges.length);
    expect(anatomy.walked.bridgesTaken).toBe(bridges.filter((b) => b.taken).length);
    expect(anatomy.walked.refused).toBe(result.path?.refused.length ?? 0);
    expect(anatomy.ranked.candidates).toBe(result.candidates.length);
    expect(anatomy.ranked.decidedBy).toBe(result.decided_by);
    if (result.decided_by) expect(anatomy.ranked.position).toBe(criteria.indexOf(result.decided_by) + 1);
    expect(anatomy.answered.targets).toEqual([
      ...new Set(result.candidates.filter((c) => c.best).map((c) => c.target)),
    ]);
    if (best && anatomy.walked.releases) {
      const first = model.steps[best.steps[0] ?? -1];
      const last = model.steps[best.steps[best.steps.length - 1] ?? -1];
      expect(anatomy.walked.releases).toEqual([first?.sourceRelease, last?.targetRelease]);
    }
  });

  it("writes each step of the timeline in the words of its sentence", () => {
    for (const step of model.steps) {
      const parts = stepParts(step, model, names);
      const sentence = stepSentence(step, model, names);
      if (parts.from !== null) expect(sentence).toContain(parts.from);
      expect(sentence).toContain(parts.to);
      for (const fact of parts.facts) {
        if (fact.kind === "databases") continue;
        expect(sentence).toContain(fact.text);
      }
      if (step.api.kind === "history" || step.api.kind === "self_loop") {
        expect(parts.when).toBe(`${step.api.old_release ?? "—"} → ${step.api.new_release ?? "—"}`);
        expect(sentence).toContain(parts.what);
        const score = parts.facts.find((f) => f.kind === "score");
        if (step.api.weight === null)
          expect(score?.text).toMatch(/^no score \((one stable id: not counted|counted) as unscored\)$/);
        else expect(score?.text).toBe(`score ${pythonFloat(step.api.weight)}`);
      } else if (step.api.release !== null && step.api.kind !== "identity") {
        expect(parts.when).toBe(String(step.api.release));
        expect(parts.what).toContain(`release ${step.api.release}`);
      }
    }
  });

  it("writes every history step in Ensembl's direction, the walk's direction apart", () => {
    const active = (id: string, release: number) =>
      (model.nodeById.get(id)?.api.active ?? []).some(([a, b]) => release >= a && (b === null || release <= b));
    for (const step of model.steps) {
      const a = step.api;
      if ((a.kind !== "history" && a.kind !== "self_loop") || a.old_release === null || a.new_release === null)
        continue;
      const parts = stepParts(step, model, names);
      // The earlier id first, at the event's old release; the later id at its new release; the releases ascending.
      expect(parts.when).toBe(`${a.old_release} → ${a.new_release}`);
      const earlier = (step.direction === "backward" ? a.target : a.source) ?? "";
      const later = (step.direction === "backward" ? a.source : a.target) ?? "";
      expect(parts.from).toBe(model.nodeById.get(earlier)?.label ?? earlier);
      expect(parts.to).toBe(model.nodeById.get(later)?.label ?? later);
      if (model.nodeById.get(earlier)?.api.active.length) expect(active(earlier, a.old_release)).toBe(true);
      if (model.nodeById.get(later)?.api.active.length) expect(active(later, a.new_release)).toBe(true);
      expect(parts.backward).toBe(step.direction === "backward");
      const sentence = stepSentence(step, model, names);
      expect(sentence.includes("Walked backward")).toBe(step.direction === "backward");
    }
  });

  it("folds a lane's answers beyond its rows, losing no candidate from the count", () => {
    const scale = (r: number) => 100 + r * 10;
    const layout = layoutPath(model, {
      scale,
      answerT: 3000,
      metrics: HORIZONTAL_METRICS,
      limit: Number.POSITIVE_INFINITY,
      rowsPerLane: 2,
    });
    const perLane = new Map<number, number>();
    for (const answer of layout.answers) {
      const lane = layout.nodes.get(answer.candidate.api.gene)?.lane ?? 0;
      perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
    }
    for (const count of perLane.values()) expect(count).toBeLessThanOrEqual(2);
    const folded = layout.folded.reduce((n, f) => n + f.count, 0);
    expect(layout.shown.length + folded).toBe(result.candidates.length);
    expect(layout.hidden).toBe(folded);
    // Every drawn step belongs to a drawn candidate.
    const drawn = new Set(layout.shown.map((c) => c.index));
    for (const edge of layout.edges) expect(edge.step.candidates.some((c) => drawn.has(c))).toBe(true);
  });
});
