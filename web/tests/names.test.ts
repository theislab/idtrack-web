// The rule of scripts/names.ts: IDTrack in the pages' words and the documents, `idtrack` only as code.
import { describe, expect, it } from "vitest";
import { markdownBare, pageBare } from "../scripts/names.ts";

describe("the name in the pages and the documents", () => {
  it("finds the bare name in a page's words and its read attributes, with their lines", () => {
    const page = 'const A = () => (\n  <p title="by idtrack">\n    Converted by idtrack.\n  </p>\n);\n';
    expect(pageBare("a.tsx", page).map((b) => b.line)).toEqual([2, 3]);
  });

  it("leaves code, addresses, joined names and the source's own strings alone", () => {
    const page = [
      "const B = () => (",
      "  <p>",
      "    Run <code>idtrack verify</code>, <Mono>import idtrack</Mono>, `idtrack-web` and idtrack-web,",
      "    https://idtrack.readthedocs.io/ or idtrack.API; IDTrack is the name.",
      "  </p>",
      ");",
      'const key = "idtrack";',
    ].join("\n");
    expect(pageBare("b.tsx", page)).toEqual([]);
  });

  it("reads Markdown's prose only", () => {
    const text = [
      "# IDTrack web app",
      "The web app of idtrack.",
      "```console",
      "$ idtrack build pig 115",
      "```",
      "[IDTrack](https://github.com/theislab/idtrack) and `idtrack`.",
      "> idtrack's own words, quoted.",
    ].join("\n");
    expect(markdownBare("a.md", text).map((b) => b.line)).toEqual([2]);
  });
});
