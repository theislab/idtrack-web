// The indented view of an answer changes only the white space: every value keeps the text the api sent, on every
// recorded answer of the real pig and human graphs; the Server-Timing header is read as sent.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { indentedText, indentJson, rawValueAt } from "../src/lib/jsonView";
import { parseServerTiming } from "../src/lib/serverTiming";
import { ORGANISMS, recorded } from "./fixtures";

/** The text without the white space between tokens (strings kept whole). */
function squeeze(text: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      out += c;
      if (c === "\\") out += text.charAt(++i);
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      out += c;
    } else if (!" \n\r\t".includes(c)) out += c;
  }
  return out;
}

describe("indentJson", () => {
  it("keeps the spelling of numbers and literals", () => {
    expect(indentedText('{"score":1.0,"x":0.9598796202450001,"e":1e-07,"n":null,"t":true,"a":[],"o":{}}')).toBe(
      '{\n  "score": 1.0,\n  "x": 0.9598796202450001,\n  "e": 1e-07,\n  "n": null,\n  "t": true,\n  "a": [],\n  "o": {}\n}',
    );
  });

  it("tells keys from string values and keeps escapes", () => {
    const tokens = indentJson('{"k":"a\\"b","l":["c"]}') ?? [];
    expect(tokens.filter((t) => t.kind === "key").map((t) => t.text)).toEqual(['"k"', '"l"']);
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.text)).toEqual(['"a\\"b"', '"c"']);
  });

  it("refuses what is not JSON", () => {
    expect(indentJson("{")).toBeNull();
    expect(indentJson('{"a":1]')).toBeNull();
    expect(indentJson("input_index\tquery_id")).toBeNull();
  });

  it("changes only white space on every recorded answer", () => {
    let checked = 0;
    for (const organism of ORGANISMS) {
      for (const entry of recorded(organism).filter((e) => e.file.endsWith(".json"))) {
        const indented = indentedText(entry.raw);
        expect(indented, entry.name).not.toBeNull();
        expect(squeeze(indented ?? ""), entry.name).toBe(squeeze(entry.raw));
        // The same value: both texts parsed and written again compare as one string (indenting keeps the order of
        // keys), which is as strict as a deep comparison and fast enough for the largest recorded answers.
        expect(JSON.stringify(JSON.parse(indented ?? "")), entry.name).toBe(JSON.stringify(JSON.parse(entry.raw)));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("parseServerTiming", () => {
  it("reads the api's metrics with their durations as sent", () => {
    expect(parseServerTiming("app;dur=167.187, queue;dur=0.221, search;dur=163.000")).toEqual([
      { name: "app", dur: "167.187", desc: null },
      { name: "queue", dur: "0.221", desc: null },
      { name: "search", dur: "163.000", desc: null },
    ]);
  });

  it("reads descriptions, quoted commas and a missing header", () => {
    expect(parseServerTiming('db;desc="a, b";dur=2, cache')).toEqual([
      { name: "db", dur: "2", desc: "a, b" },
      { name: "cache", dur: null, desc: null },
    ]);
    // One reader for every page (the batch's and the answer's too): a duration is kept as its text, whatever it is.
    expect(parseServerTiming('db;dur=12;desc="a b", cache;desc=hit')).toEqual([
      { name: "db", dur: "12", desc: "a b" },
      { name: "cache", dur: null, desc: "hit" },
    ]);
    expect(parseServerTiming(null)).toEqual([]);
    expect(parseServerTiming("")).toEqual([]);
  });
});

describe("rawValueAt", () => {
  const raw = '{"a": {"b c": [1, {"x": 1.0}], "d": {"e": 0.9773331776999999, "f": "}\\""}}, "g": true}';
  it("returns a value's text exactly as written, at any depth", () => {
    expect(rawValueAt(raw, ["a", "d", "e"])).toBe("0.9773331776999999");
    expect(rawValueAt(raw, ["a", "b c"])).toBe('[1, {"x": 1.0}]');
    expect(rawValueAt(raw, ["a", "d"])).toBe('{"e": 0.9773331776999999, "f": "}\\""}');
    expect(rawValueAt(raw, ["g"])).toBe("true");
    // An array's item by its index.
    expect(rawValueAt(raw, ["a", "b c", "1", "x"])).toBe("1.0");
    expect(rawValueAt(raw, ["a", "b c", "0"])).toBe("1");
  });
  it("answers null for a path that is not there", () => {
    expect(rawValueAt(raw, ["a", "missing"])).toBeNull();
    expect(rawValueAt(raw, ["g", "h"])).toBeNull();
    expect(rawValueAt("[1]", ["a"])).toBeNull();
    expect(rawValueAt(raw, ["a", "b c", "2"])).toBeNull();
    expect(rawValueAt("{not json", ["a"])).toBeNull();
  });
  it("reads a recorded answer of the OpenAPI document with its numbers' spellings", () => {
    const document = readFileSync(new URL("../../api/openapi.json", import.meta.url), "utf8");
    const text = rawValueAt(document, [
      "paths",
      "/api/v1/organisms/{organism}/convert",
      "get",
      "responses",
      "200",
      "content",
      "application/json",
      "example",
    ]);
    expect(text).not.toBeNull();
    expect(JSON.parse(text ?? "null")).toMatchObject({ query_id: "ENSG00000141510", status: "converted" });
  });
});
