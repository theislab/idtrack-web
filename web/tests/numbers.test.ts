import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pythonFloat, releaseRanges, shortFloat } from "../src/lib/numbers";

const table = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "python_float_repr.json"), "utf8")) as {
  repr: string[];
};

describe("pythonFloat", () => {
  it.each(table.repr)("writes %s as Python's repr does", (text) => {
    expect(pythonFloat(Number(text))).toBe(text);
  });

  it("reads back every value exactly", () => {
    for (const text of table.repr) expect(Number(pythonFloat(Number(text)))).toBe(Number(text));
  });
});

describe("shortFloat", () => {
  it("cuts, never rounds, and marks a cut", () => {
    expect(shortFloat(0.9598796202450001)).toEqual({ text: "0.959…", shortened: true });
    expect(shortFloat(0.99999)).toEqual({ text: "0.999…", shortened: true });
    expect(shortFloat(0.29)).toEqual({ text: "0.29", shortened: false });
    expect(shortFloat(1.0)).toEqual({ text: "1.0", shortened: false });
    expect(shortFloat(0.000123456)).toEqual({ text: "0.000123…", shortened: true });
    expect(shortFloat(1e-5)).toEqual({ text: "1e-05", shortened: false });
    expect(shortFloat(12.3456)).toEqual({ text: "12.3…", shortened: true });
  });

  it("keeps the digits it shows from the api's own text", () => {
    for (const text of table.repr) {
      const value = Number(text);
      const short = shortFloat(value);
      if (short.shortened) expect(text.startsWith(short.text.slice(0, -1))).toBe(true);
      else expect(short.text).toBe(text);
    }
  });
});

describe("releaseRanges", () => {
  it("writes every release, in ranges", () => {
    expect(releaseRanges([56, 57, 58, 60])).toBe("56–58, 60");
    expect(releaseRanges([90, 92, 93, 94])).toBe("90, 92–94");
    expect(releaseRanges([115])).toBe("115");
    expect(releaseRanges([])).toBe("");
  });
});
