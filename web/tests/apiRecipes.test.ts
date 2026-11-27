// The api page's recipes for a whole feature list run as copied: the Python is parsed by Python (the CI's runner has
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
    expect(code).toContain("graph {digests['homo_sapiens']}\\n\")");
    expect(code).toContain('delimiter="\\t"');
    expect(code).not.toContain("\t");
  });

  it.runIf(has("Rscript"))("the R recipe is R that parses", () => {
    const out = execFileSync("Rscript", ["-e", "invisible(parse(file('stdin'))); cat('ok')"], {
      input: pipelineR(BASE),
      encoding: "utf8",
    });
    expect(out.trim()).toBe("ok");
  });

  it("both keep a name and its copies (-1, .1, _1 appended) in one request, and ask with the server's bound", () => {
    for (const code of [pipelinePython(BASE), pipelineR(BASE)]) {
      expect(code).toContain("([-._]1)+$");
      expect(code).toContain("batch_max");
      expect(code).toContain(BASE);
      // The evidence a pipeline should keep beside each answer.
      for (const column of ["match", "bridges", "decided_by"]) expect(code).toContain(column);
    }
  });
});
