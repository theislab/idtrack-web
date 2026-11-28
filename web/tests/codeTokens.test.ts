// The code view's reading of a program by kind: the text exactly, each kind where it is.
import { describe, expect, it } from "vitest";
import { pythonFloat } from "../src/lib/numbers";
import { codeTokens, type CodeLanguage } from "../src/lib/codeTokens";
import { LANGUAGES, exampleRequest } from "../src/lib/apiExamples";
import { pipelinePython, pipelineR } from "../src/lib/apiRecipes";
import { firstSentence } from "../src/lib/openapi";

const kinds = (code: string, language: CodeLanguage) =>
  codeTokens(code, language)
    .filter((t) => t.kind !== "plain")
    .map((t) => `${t.kind}:${t.text}`);

describe("code read by kind", () => {
  it("gives back the text exactly, for every language and recipe", () => {
    const texts: [string, CodeLanguage][] = [
      [pipelinePython("http://x/api/v1"), "python"],
      [pipelineR("http://x/api/v1"), "r"],
      ['{"a": [1, 2.5e3, true, null], "b": "c\\"d"}', "json"],
      ["curl -sS 'http://x/api/v1?a=1#b' \\\n  -H 'Accept: application/json'", "bash"],
      ['const a = `x ${y}`; // done\nif (!r.ok) throw new Error("no");', "javascript"],
    ];
    for (const [text, language] of texts) {
      expect(
        codeTokens(text, language)
          .map((t) => t.text)
          .join(""),
      ).toBe(text);
    }
    expect(pythonFloat(1)).toBe("1.0"); // the page's numbers are untouched by the code view
  });

  it("sets comments, strings, numbers, words and literals apart", () => {
    expect(kinds('x = f"{a}" + 3  # a "note"\nif x is None: pass', "python")).toEqual([
      'string:f"{a}"',
      "number:3",
      'comment:# a "note"',
      "keyword:if",
      "keyword:is",
      "literal:None",
      "keyword:pass",
    ]);
    expect(kinds("x <- TRUE # yes", "r")).toEqual(["literal:TRUE", "comment:# yes"]);
    expect(kinds("curl -sS 'http://h/#x' -H 'A: b'", "bash")).toEqual([
      "keyword:curl",
      "keyword:-sS",
      "string:'http://h/#x'",
      "keyword:-H",
      "string:'A: b'",
    ]);
    expect(kinds("a1 = b2", "python")).toEqual([]); // a number inside a name is the name's
  });

  it("reads every language of the page's examples", () => {
    const endpoint = {
      method: "GET",
      path: "/api/v1/organisms/{organism}/convert",
      parameters: [],
      body: null,
      answers: [],
    } as unknown as Parameters<typeof exampleRequest>[0];
    const spec = exampleRequest(endpoint, "homo_sapiens", null);
    for (const language of LANGUAGES) expect(language.write("http://x", spec).length).toBeGreaterThan(0);
  });
});

describe("a parameter's first sentence", () => {
  it("ends at a full stop outside code and abbreviations", () => {
    expect(firstSentence("The release, e.g. `115`. Then more.")).toEqual({
      first: "The release, e.g. `115`.",
      rest: "Then more.",
    });
    expect(firstSentence("A name (`a. b`) as written. More")).toEqual({
      first: "A name (`a. b`) as written.",
      rest: "More",
    });
    expect(firstSentence("One sentence only")).toEqual({ first: "One sentence only", rest: "" });
  });
});
