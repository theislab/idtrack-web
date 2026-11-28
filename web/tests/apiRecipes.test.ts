// The API page's recipes for a whole feature list run as copied: the Python is parsed by Python (the CI's runner has
// it), the R by R where it is installed; both keep a name and its copies in one request.
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { pipelinePython, pipelineR } from "../src/lib/apiRecipes";

const BASE = "https://idtrack.example/api/v1";

function has(command: string): boolean {
  return spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0;
}

describe("the recipes of a whole feature list", () => {
  it("the Python recipe is Python that parses, with no line broken inside a string", () => {
    const code = pipelinePython(BASE);
    const out = execFileSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read()); print('ok')"], {
      input: code,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("ok");
    // The escapes are the recipe's own: a newline and a tab written as Python writes them.
    expect(code).toContain('to_release {targets.pop()}\\n")');
    expect(code).toContain('delimiter="\\t"');
    expect(code).not.toContain("\t");
  });

  it.runIf(has("Rscript"))(
    "the R recipe is R that parses",
    () => {
      const out = execFileSync("Rscript", ["-e", "invisible(parse(file('stdin'))); cat('ok')"], {
        input: pipelineR(BASE),
        encoding: "utf8",
      });
      expect(out.trim()).toBe("ok");
    },
    60_000,
  ); // Rscript takes seconds to start

  it("both keep a name and its copies (-1, .1, _1 appended) in one request, and ask with the server's bound", () => {
    for (const code of [pipelinePython(BASE), pipelineR(BASE)]) {
      expect(code).toContain("^(.+)([-_.])([0-9]+)$"); // idtrack.ids.NUMBERED_SUFFIX
      expect(code).toContain("batch_max");
      expect(code).toContain(BASE);
      // The evidence a pipeline should keep beside each answer.
      for (const column of ["match", "bridges", "decided_by"]) expect(code).toContain(column);
      // The list is read as it was made (its release given, or inferred from the list), and the table names the graph
      // every answer came from (one digest, from the answers' own header) with both releases.
      expect(code).toContain("/source-inference");
      expect(code).toMatch(/from_release/);
      expect(code).toContain("Idtrack-Graph-Digest");
      expect(code).toContain("mapping.tsv");
      expect(code).toMatch(/graph %?\{?.*from_release.*to_release/);
    }
  });

  it("both date the list by IDTrack's band and margin, and write them in the table's first line", () => {
    for (const code of [pipelinePython(BASE), pipelineR(BASE)]) {
      // The release asked of the list itself, in the mode of releases.
      expect(code).toMatch(/mode"?\s*[=:]\s*"release"/);
      // The margin decides: null (no release outside the band) is read as a list that does not date itself, and
      // no from_release is sent; a number takes the inferred from_release.
      expect(code).toContain("margin");
      expect(code).toContain("does not date itself");
      expect(code).toMatch(/band %?\{?.*to.*releases, margin/);
      expect(code).toContain("read_at");
    }
  });

  it("both send a batch in halves when request_budget_exceeded comes again, a name and its copies kept together", () => {
    for (const code of [pipelinePython(BASE), pipelineR(BASE)]) {
      expect(code).toContain("request_budget_exceeded");
      expect(code).toMatch(/budget == 2/);
      expect(code).toMatch(/batches\(chunk, (\(len\(chunk\) \+ 1\) \/\/ 2|ceiling\(length\(chunk\) \/ 2\))\)/);
    }
  });

  it("keep every item idtrack can read as another's copy in that item's request, chains too (Python)", () => {
    // The recipe's own function, run on a list where the copies are far apart and the requests small.
    const code = pipelinePython(BASE);
    const start = code.indexOf("def batches(");
    const end = code.indexOf("\nanswers, graphs", start);
    const program = `import re\n${code.slice(start, end)}\nimport json, sys\nprint(json.dumps(batches(json.loads(sys.argv[1]), 2)))`;
    const list = ["TP53", "BRCA1", "EGFR", "TP53-2", "KRAS", "TP53_10", "MYC", "TP53.3", "TP53-2-1", "ALB", "X-1"];
    const out = execFileSync("python3", ["-c", program, JSON.stringify(list)], { encoding: "utf8" });
    const chunks = JSON.parse(out) as string[][];
    const tp53 = chunks.find((c) => c.includes("TP53")) ?? [];
    for (const copy of ["TP53-2", "TP53_10", "TP53.3", "TP53-2-1"]) expect(tp53, copy).toContain(copy);
    expect(chunks.flat().sort()).toEqual([...list].sort()); // every item once
    expect(chunks.find((c) => c.includes("X-1"))).not.toContain("TP53"); // no item X: X-1 is itself
  });

  it.runIf(has("Rscript"))(
    "keep every item idtrack can read as another's copy in that item's request, chains too (R)",
    () => {
      const code = pipelineR(BASE);
      const start = code.indexOf("batches <- function(");
      const end = code.indexOf("\n}\n", start) + 2;
      const list = ["TP53", "BRCA1", "EGFR", "TP53-2", "KRAS", "TP53_10", "MYC", "TP53.3", "TP53-2-1", "ALB", "X-1"];
      const program = `${code.slice(start, end)}\nfor (chunk in batches(c(${list.map((x) => JSON.stringify(x)).join(", ")}), 2)) cat(chunk, "\\n")`;
      const out = execFileSync("Rscript", ["-e", program], { encoding: "utf8" });
      const tp53 = out.split("\n").find((line) => line.split(" ").includes("TP53")) ?? "";
      for (const copy of ["TP53-2", "TP53_10", "TP53.3", "TP53-2-1"]) expect(tp53.split(" "), copy).toContain(copy);
    },
    60_000,
  );
});
