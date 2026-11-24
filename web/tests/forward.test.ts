// The model reads every field the api's document names (gene places on nodes and history steps among them) and keeps
// a field it does not name, shown with its exact value: nothing it does not know is dropped.
import { describe, expect, it } from "vitest";
import type { ConversionResult } from "../src/api/types";
import { databaseLabel } from "../src/lib/databases";
import { buildModel } from "../src/lib/pathModel";
import { assemblyNames, nodeFacts, stepFacts } from "../src/lib/pathReading";
import { readVocabulary } from "../src/lib/vocabulary";
import { description, fixture, recorded, vocabularyResponse } from "./fixtures";

describe("databases", () => {
  it("names Ensembl's relations in words and every other database as the api sends it", () => {
    expect(databaseLabel("ensembl_gene")).toBe("Ensembl gene (with version)");
    expect(databaseLabel("base_ensembl_gene")).toBe("Ensembl gene (without version)");
    expect(databaseLabel("HGNC Symbol")).toBe("HGNC Symbol");
  });

  it("finds no graph prefix in any recorded answer: idtrack names synonyms and their databases as they are", () => {
    for (const organism of ["sus_scrofa", "homo_sapiens"])
      for (const entry of recorded(organism)) expect(entry.raw).not.toContain("synonym_id::");
  });
});

describe("gene places", () => {
  it("are read on the nodes and steps of a real answer", () => {
    const recorded = JSON.parse(fixture("homo_sapiens", "convert_handoff").raw) as ConversionResult;
    const model = buildModel(recorded);
    const names = assemblyNames(description("homo_sapiens").assemblies);
    const vocabulary = readVocabulary(vocabularyResponse());
    const genes = model.nodes.filter((n) => n.api.kind === "ensembl_gene");
    expect(genes.length).toBeGreaterThan(0);
    for (const gene of genes) {
      expect(gene.extra).toEqual({});
      expect(gene.api.places.length).toBeGreaterThan(0);
      const facts = nodeFacts(gene, names);
      for (const place of gene.api.places)
        expect(facts.some(([k, v]) => k.startsWith("Place") && v.includes(`${place.region}:${place.start}`))).toBe(
          true,
        );
    }
    const history = model.steps.filter((s) => s.api.kind === "history" && s.api.places !== null);
    expect(history.length).toBeGreaterThan(0);
    for (const step of history) {
      expect(step.extra).toEqual({});
      const facts = stepFacts(step, model, names, vocabulary);
      expect(facts.some(([k, v]) => k === "Places" && v.startsWith(String(step.api.places).replace(/_/g, " ")))).toBe(
        true,
      );
    }
  });
});

describe("fields the model does not know", () => {
  const recorded = JSON.parse(fixture("homo_sapiens", "convert_handoff").raw) as ConversionResult;
  const withMore = {
    ...recorded,
    path: recorded.path && {
      ...recorded.path,
      nodes: recorded.path.nodes.map((n) => (n.kind === "ensembl_gene" ? { ...n, future_field: [1, 2] } : n)),
      steps: recorded.path.steps.map((s) => ({ ...s, place_overlap: true })),
    },
  } as ConversionResult;

  it("keeps them and shows their exact values", () => {
    const model = buildModel(withMore);
    const names = assemblyNames(description("homo_sapiens").assemblies);
    const gene = model.nodes.find((n) => n.api.kind === "ensembl_gene");
    expect(gene?.extra).toEqual({ future_field: [1, 2] });
    if (gene) expect(nodeFacts(gene, names)).toContainEqual(["future_field", "[1,2]"]);
    const step = model.steps[0];
    expect(step?.extra).toEqual({ place_overlap: true });
    if (step)
      expect(stepFacts(step, model, names, readVocabulary(vocabularyResponse()))).toContainEqual([
        "place_overlap",
        "true",
      ]);
  });

  it("draws the same path with or without them", () => {
    const a = buildModel(recorded);
    const b = buildModel(withMore);
    expect(b.candidates.map((c) => c.steps)).toEqual(a.candidates.map((c) => c.steps));
    expect(b.steps.map((s) => [s.kind, s.sourceRelease, s.targetRelease, s.handoff])).toEqual(
      a.steps.map((s) => [s.kind, s.sourceRelease, s.targetRelease, s.handoff]),
    );
  });
});
