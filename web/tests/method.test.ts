// The rules of the Method page's figures and words: the window fitted to a path, one lane per stable id with labels
// that resolve to their lane's id, the last steps of an answer laid out from the api's path, and idtrack's meanings
// read for a person.
import { describe, expect, it } from "vitest";
import { figureModel } from "../src/lib/home/figureModel";
import { answerLayout } from "../src/lib/method/answerLayout";
import { holdsStage } from "../src/lib/method/cases";
import { firstSentence, readerText } from "../src/lib/method/readerText";
import { stableId, stageModel, versionOf, windowOf } from "../src/lib/method/stageFigure";
import { conversions, description, ORGANISMS } from "./fixtures";

const all = conversions();
const graphs = new Map(ORGANISMS.map((o) => [o, description(o)]));
const graphOf = (organism: string) => {
  const graph = graphs.get(organism);
  if (!graph) throw new Error(`no description of ${organism}`);
  return graph;
};

describe("the window of a path", () => {
  const releases = Array.from({ length: 60 }, (_, i) => 56 + i);
  it("holds the path with two releases on each side, at least fourteen wide, inside the graph", () => {
    expect(windowOf([86, 97], releases)).toEqual(Array.from({ length: 16 }, (_, i) => 84 + i));
    const one = windowOf([115, 115], releases);
    expect(one.length).toBe(14);
    expect(one[one.length - 1]).toBe(115);
    expect(windowOf([56, 106], releases)[0]).toBe(56);
  });
});

describe("the lanes of a path", () => {
  it("split an id into its stable id and its version", () => {
    expect(stableId("ENSSSCG00000001079.2")).toBe("ENSSSCG00000001079");
    expect(versionOf("ENSSSCG00000001079.2")).toBe(".2");
    expect(stableId("E2F3")).toBe("E2F3");
  });

  it("put every version of one stable id on one lane, so that a version label names its lane's id", () => {
    for (const { entry, result } of all) {
      const model = figureModel(result);
      if (!model) continue;
      const stage = stageModel(model, graphOf(entry.organism));
      for (const gene of model.genes) {
        const lane = stage.lanes[stage.laneOf.get(gene.node.id) ?? -1];
        expect(lane?.id).toBe(stableId(gene.node.id));
      }
      expect(new Set(stage.lanes.map((l) => l.id)).size).toBe(stage.lanes.length);
    }
  });

  it("draw a bridged path with the gene bridged into on a lane of its own", () => {
    const bridged = all.find((c) => holdsStage("bridge", c.result));
    const model = bridged ? figureModel(bridged.result) : null;
    expect(model).not.toBeNull();
    if (!bridged || !model) return;
    const stage = stageModel(model, graphOf(bridged.entry.organism));
    expect(stage.lanes.length).toBeGreaterThan(1);
  });
});

describe("the last steps of an answer", () => {
  it("lay out the identifier, its gene and every best target with the forms that carry it", () => {
    for (const { result } of all) {
      if (!holdsStage("answer", result)) continue;
      const layout = answerLayout(result);
      const targets = layout.placed.filter((p) => p.column === "target").map((p) => p.id);
      const best = result.candidates.filter((c) => c.best).map((c) => c.target);
      expect(new Set(targets)).toEqual(new Set(best));
      expect(layout.placed.filter((p) => p.column === "ensembl_gene").length).toBeGreaterThan(0);
    }
  });
});

describe("idtrack's meanings, read for a person", () => {
  it("keep an aside's words, drop an aside of code, and say values and sort keys in words", () => {
    expect(readerText('A name (`gene.display_xref_id`: Ensembl\'s own name) ranks first (`x.y`; `a` is `"b"`).')).toBe(
      "A name (Ensembl's own name) ranks first.",
    );
    expect(readerText("`(-external ids, -transcripts, -translations)` of the gene; `null` where not.")).toBe(
      "the numbers of external ids, transcripts and translations (the more of each, the earlier, in that order) of the gene; none where not.",
    );
    expect(readerText("listed (`known_versions`), and `entry_support` counts.")).toBe(
      "listed, and `entry support` counts.",
    );
  });

  it("take a first sentence for a one-line list", () => {
    expect(firstSentence("One thing. Two things.")).toBe("One thing.");
    expect(firstSentence("No end")).toBe("No end");
  });
});
