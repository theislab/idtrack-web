// The path view draws the api's path, step for step: on every recorded answer of the pig and human graphs.
import { describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { pythonFloat } from "../src/lib/numbers";
import { HORIZONTAL_METRICS, layoutPath, shownCandidates } from "../src/lib/pathLayout";
import { buildModel } from "../src/lib/pathModel";
import { assemblyNames, readingOrder, readingText, stepFacts, stepSentence } from "../src/lib/pathReading";
import { readVocabulary } from "../src/lib/vocabulary";
import { conversions, description, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

const all = conversions();
const withPath = all.filter(({ result }) => result.path !== null && result.path.steps.length > 0);
const named = (list: typeof all) => list.map((c) => [`${c.entry.organism}/${c.entry.name}`, c] as const);

/** The `"weight":<text>` tokens of the raw answer, in the order of the steps. */
function rawWeights(raw: string): string[] {
  const steps = raw.slice(raw.indexOf('"steps":'));
  return [...steps.matchAll(/"weight":(null|-?[0-9.eE+-]+)/g)].map((m) => m[1] ?? "");
}

describe("the recorded answers", () => {
  it("cover every kind of step and the features the path view draws", () => {
    const kinds = new Set<string>();
    const reasons = new Set<string>();
    let handoffs = 0;
    let backward = 0;
    let nonReference = 0;
    for (const { result } of withPath) {
      const model = buildModel(result);
      for (const step of model.steps) {
        kinds.add(step.api.kind);
        reasons.add(step.api.reason);
        if (step.handoff) handoffs += 1;
        if (step.direction === "backward") backward += 1;
      }
      nonReference += model.nodes.filter((n) => n.api.non_reference.length > 0).length;
    }
    expect([...kinds].sort()).toEqual([
      "bridge_far",
      "bridge_near",
      "entry",
      "final",
      "history",
      "identity",
      "self_loop",
    ]);
    for (const reason of [
      "new_version",
      "replaced",
      "split",
      "merge",
      "split_and_merge",
      "self_loop",
      "entry",
      "final",
      "identity",
      "bridge_near",
      "bridge_far",
    ]) {
      expect(reasons).toContain(reason);
    }
    expect(handoffs).toBeGreaterThan(0);
    expect(backward).toBeGreaterThan(0);
    expect(nonReference).toBeGreaterThan(0);
    expect(withPath.length).toBeGreaterThan(80);
  });
});

describe.each(named(withPath))("%s", (_, { entry, result }) => {
  const model = buildModel(result);
  const names = assemblyNames(description(entry.organism).assemblies);
  const apiSteps = result.path?.steps ?? [];

  it("keeps every step and node as the api sent it", () => {
    expect(model.problems).toEqual([]);
    expect(model.steps.map((s) => s.api)).toEqual(apiSteps);
    expect(model.nodes.map((n) => n.api)).toEqual(result.path?.nodes);
  });

  it("gives each candidate exactly its api path, then its final path, in order", () => {
    expect(model.candidates).toHaveLength(result.candidates.length);
    result.candidates.forEach((candidate, i) => {
      const drawn = model.candidates[i];
      expect(drawn?.api).toBe(candidate);
      expect(drawn?.steps).toEqual([...candidate.path, ...candidate.final_path]);
      expect(drawn?.steps.map((s) => model.steps[s]?.api)).toEqual(
        [...candidate.path, ...candidate.final_path].map((s) => apiSteps[s]),
      );
    });
  });

  it("draws a continuous line from the identifier to each target", () => {
    for (const candidate of model.candidates) {
      const steps = candidate.steps.map((s) => model.steps[s]);
      steps.forEach((step, i) => {
        const previous = steps[i - 1];
        if (previous) expect(step?.api.source).toBe(previous.api.target);
      });
      const first = steps[0];
      // The path begins at the identifier as read; an LRG record's id read as its gene (`lrg:`) begins at that gene.
      if (first && first.api.kind !== "identity")
        expect(first.api.source).toBe(result.match?.startsWith("lrg:") ? candidate.api.entry_gene : result.graph_id);
      const lastOfPath = model.steps[candidate.api.path[candidate.api.path.length - 1] ?? -1];
      if (lastOfPath) expect(lastOfPath.api.target).toBe(candidate.api.gene);
    }
  });

  it("puts each step at the releases the api gives it", () => {
    for (const step of model.steps) {
      const a = step.api;
      if (a.kind === "history" || a.kind === "self_loop") {
        expect([step.sourceRelease, step.targetRelease].sort((x, y) => x - y)).toEqual(
          [a.old_release, a.new_release].sort((x, y) => (x ?? 0) - (y ?? 0)),
        );
        const forward = step.sourceRelease === a.old_release && step.targetRelease === a.new_release;
        expect(step.direction).toBe(
          a.old_release === a.new_release ? step.direction : forward ? "forward" : "backward",
        );
      } else if (a.kind === "identity") {
        expect(step.targetRelease).toBe(result.to_release);
      } else {
        expect(step.sourceRelease).toBe(a.release ?? result.to_release);
        expect(step.targetRelease).toBe(a.release ?? result.to_release);
      }
      expect(step.handoff !== null).toBe(
        a.kind === "history" && a.old_assembly !== null && a.assembly !== null && a.old_assembly !== a.assembly,
      );
    }
  });

  it("lays out every drawn step between its nodes at their releases", () => {
    const scale = (r: number) => 100 + r * 10;
    const layout = layoutPath(model, {
      scale,
      answerT: 2000,
      metrics: HORIZONTAL_METRICS,
      limit: Number.POSITIVE_INFINITY,
    });
    expect(layout.shown).toHaveLength(result.candidates.length);
    expect(layout.hidden).toBe(0);
    const drawn = new Map(layout.edges.map((e) => [e.step.index, e]));
    expect([...drawn.keys()].sort((a, b) => a - b)).toEqual(
      [...new Set(result.candidates.flatMap((c) => [...c.path, ...c.final_path]))].sort((a, b) => a - b),
    );
    for (const edge of layout.edges) {
      const a = edge.step.api;
      const target = layout.nodes.get(a.target);
      expect(target).toBeDefined();
      if (a.kind === "identity" || a.source === null) continue;
      const source = layout.nodes.get(a.source);
      expect(source).toBeDefined();
      if (!source || !target) continue;
      expect(edge.from.s).toBe(source.s);
      if (source.node.role === "gene") expect(edge.from.t).toBe(scale(edge.step.sourceRelease));
      if (target.node.role === "gene") {
        expect(edge.to.t).toBe(scale(edge.step.targetRelease));
        expect(edge.to.s).toBe(target.s);
      }
      // A gene's bar covers every release at which a drawn step touches it.
      for (const [place, release] of [
        [source, edge.step.sourceRelease],
        [target, edge.step.targetRelease],
      ] as const) {
        if (place.node.role !== "gene") continue;
        expect(scale(release)).toBeGreaterThanOrEqual(place.t0);
        expect(scale(release)).toBeLessThanOrEqual(place.t1);
      }
    }
    // Each candidate's gene is on a lane and reaches the target release.
    for (const candidate of result.candidates) {
      const place = layout.nodes.get(candidate.gene);
      expect(place?.lane).not.toBeNull();
      expect(place?.t1).toBeGreaterThanOrEqual(scale(result.to_release));
    }
    // Genes that share releases never share a lane.
    const genes = [...layout.nodes.values()].filter((p) => p.node.role === "gene");
    for (const a of genes) {
      for (const b of genes) {
        if (a === b || a.lane !== b.lane) continue;
        expect(a.node.last < b.node.first || b.node.last < a.node.first).toBe(true);
      }
    }
    // One lane per stable id: the best candidates' ids first; an alternative's gene is on a lane of the best paths only
    // where its stable id is that lane's (another version of the same id).
    const stable = (id: string) => id.replace(/\.\d+$/, "");
    const laneIds = new Map<number, Set<string>>();
    for (const place of genes)
      if (place.lane !== null)
        laneIds.set(place.lane, (laneIds.get(place.lane) ?? new Set()).add(stable(place.node.label)));
    for (const ids of laneIds.values()) expect(ids.size).toBe(1);
    const bestLanes = new Set(genes.filter((p) => p.best).map((p) => p.lane));
    for (const place of genes)
      if (!place.best && bestLanes.has(place.lane))
        expect(
          genes.some((p) => p.best && p.lane === place.lane && stable(p.node.label) === stable(place.node.label)),
        ).toBe(true);
  });

  it("writes every score exactly as the api's text", () => {
    const tokens = rawWeights(entry.raw);
    expect(tokens).toHaveLength(apiSteps.length);
    model.steps.forEach((step, i) => {
      const token = tokens[i];
      if (step.api.weight === null) {
        expect(token).toBe("null");
        return;
      }
      expect(pythonFloat(step.api.weight)).toBe(token);
      const facts = Object.fromEntries(stepFacts(step, model, names, vocabulary));
      expect(facts["Score"]).toBe(token);
      expect(stepSentence(step, model, names)).toContain(`score ${token ?? ""}`);
    });
  });

  it("reads every step of every candidate, in order", () => {
    const text = readingText(model, names);
    let from = 0;
    for (const candidate of model.candidates) {
      // The walk's order (a run of re-mappings of one gene listed in the walk's direction).
      const order = readingOrder(candidate, model);
      expect([...order].sort((a, b) => a - b)).toEqual([...candidate.steps].sort((a, b) => a - b));
      for (const index of order) {
        const step = model.steps[index];
        if (!step) continue;
        const sentence = stepSentence(step, model, names);
        const at = text.indexOf(sentence, from);
        expect(at).toBeGreaterThanOrEqual(0);
        from = at + sentence.length;
      }
    }
  });
});

describe("the candidates drawn by default", () => {
  it.each(named(withPath))("%s: every best answer is drawn", (_, { result }) => {
    const model = buildModel(result);
    const shown = shownCandidates(model, 4);
    for (const candidate of model.candidates.filter((c) => c.best)) expect(shown).toContain(candidate);
    expect(shown.length).toBe(
      Math.max(Math.min(4, model.candidates.length), model.candidates.filter((c) => c.best).length),
    );
  });

  it("draws the first best answers alone where the width holds fewer lanes than the best answers (a phone)", () => {
    const tie = withPath.find(({ result }) => result.candidates.filter((c) => c.best).length > 2);
    expect(tie).toBeDefined();
    if (!tie) return;
    const model = buildModel(tie.result);
    const bests = model.candidates.filter((c) => c.best);
    const shown = shownCandidates(model, 4, 2);
    expect(shown).toEqual(bests.slice(0, 2));
    // Every best answer drawn: the others follow up to the limit, as before.
    expect(shownCandidates(model, 4, bests.length)).toEqual(shownCandidates(model, 4));
  });
});

describe("answers without a path", () => {
  it.each(named(all.filter(({ result }) => result.path === null || result.path.steps.length === 0)))(
    "%s: a model with no step and no problem",
    (_, { result }) => {
      const model = buildModel(result);
      expect(model.steps).toEqual([]);
      expect(model.problems).toEqual([]);
      expect(model.span).toBeNull();
    },
  );
});

export type { ConversionResult };
