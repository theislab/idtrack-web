import { describe, expect, it } from "vitest";
import { parseList } from "../src/lib/batchList";

describe("parseList", () => {
  it("reads one identifier per line and the first cell of a table", () => {
    expect(parseList("INS\n\n PDX1 \r\nGCG\tglucagon\nNM_000207,x\nA;B\n")).toEqual([
      "INS",
      "PDX1",
      "GCG",
      "NM_000207",
      "A",
    ]);
  });
  it("keeps the order and repeats", () => {
    expect(parseList("b\na\nb")).toEqual(["b", "a", "b"]);
  });
});
