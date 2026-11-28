// The API page's requests: read from the API's own OpenAPI document, every endpoint has an example (the request the
// document recorded an answer of, where the server holds its organism), and the curl line written for it is the
// request the console sends (the same address, method, headers and body, byte for byte).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "../src/api/client";
import {
  curl,
  EXAMPLES,
  exampleOrganism,
  exampleRequest,
  javascript,
  recordedRequest,
  sameRequest,
  python,
  rName,
  pythonLiteral,
  r,
  requestUrl,
  rLiteral,
  shellQuote,
  type RequestSpec,
} from "../src/lib/apiExamples";
import { anchorOf, endpoints, fieldsOf, grouped, tocPath, typeText, type OpenApiDocument } from "../src/lib/openapi";

const DOCUMENT = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "api", "openapi.json"), "utf8"),
) as OpenApiDocument;
const ORIGIN = "https://idtrack.example";

/** The words of a shell command line, as a POSIX shell reads single-quoted words and line continuations. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === "\\" && line.charAt(i + 1) === "\n") {
      i += 1;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      word = (word ?? "") + line.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === "\\") {
      word = (word ?? "") + line.charAt(i + 1);
      i += 1;
      continue;
    }
    if (c === " " || c === "\n") {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    word = (word ?? "") + c;
  }
  if (word !== null) words.push(word);
  return words;
}

/** The request a curl line makes: method, address, headers and body. */
function curlRequest(line: string) {
  const words = shellWords(line);
  expect(words[0]).toBe("curl");
  let method = "GET";
  let url = "";
  const headers: Record<string, string> = {};
  let body: string | null = null;
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? "";
    if (w === "-sS") continue;
    if (w === "-X") method = words[++i] ?? "";
    else if (w === "-H") {
      const [name = "", ...value] = (words[++i] ?? "").split(": ");
      headers[name] = value.join(": ");
    } else if (w === "--data-raw") body = words[++i] ?? "";
    else url = w;
  }
  return { method, url, headers, body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const list = endpoints(DOCUMENT);
const { organism, example } = exampleOrganism(Object.keys(EXAMPLES));

describe("the OpenAPI document as the page reads it", () => {
  it("names every endpoint of the document once, each in one group", () => {
    const expected = Object.entries(DOCUMENT.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(list.map((e) => e.key).sort()).toEqual(expected.sort());
    const inGroups = grouped(list).flatMap((g) => g.endpoints.map((e) => e.key));
    expect(inGroups.sort()).toEqual(expected.sort());
    expect(new Set(list.map((e) => e.anchor)).size).toBe(list.length);
  });

  it("reads parameters with their types, defaults and bounds", () => {
    const convert = list.find((e) => e.key === "GET /api/v1/organisms/{organism}/convert");
    const byName = Object.fromEntries((convert?.parameters ?? []).map((p) => [p.name, p]));
    expect(byName["identifier"]?.required).toBe(true);
    expect(byName["to_release"]).toMatchObject({
      type: "integer",
      kind: "integer",
      nullable: true,
      bounds: "0 to 999999999",
    });
    expect(byName["explain"]).toMatchObject({ kind: "boolean", default: false });
    expect(byName["organism"]).toMatchObject({ in: "path", bounds: "at most 100 characters" });
    const batch = list.find((e) => e.method === "POST");
    expect(batch?.parameters.find((p) => p.name === "format")).toMatchObject({
      kind: "enum",
      enumValues: ["json", "tsv"],
      type: '"json" | "tsv"',
    });
    expect(batch?.body).toMatchObject({ schema: "BatchRequest", contentType: "application/json", required: true });
  });

  it("writes schema types as the document states them", () => {
    expect(typeText({ anyOf: [{ type: "integer" }, { type: "null" }] })).toBe("integer | null");
    expect(typeText({ type: "array", items: { $ref: "#/components/schemas/Candidate" } })).toBe("list of Candidate");
    const fields = fieldsOf(DOCUMENT, "ConversionResult");
    expect(fields.find((f) => f.name === "candidates")).toMatchObject({
      type: "list of Candidate",
      refs: ["Candidate"],
    });
    expect(fieldsOf(DOCUMENT, "LimitsResponse").map((f) => f.name)).toContain("batch_max");
  });

  it("anchors and contents entries", () => {
    expect(anchorOf("GET", "/api/v1/organisms/{organism}/convert")).toBe("get-organisms-organism-convert");
    expect(tocPath("/api/v1/organisms/{organism}/convert")).toBe("…/convert");
    expect(tocPath("/api/v1/organisms/{organism}")).toBe("/organisms/{organism}");
    expect(tocPath("/api/v1/health")).toBe("/health");
  });
});

describe("the examples", () => {
  it("use an organism of this site's examples and fill every required parameter", () => {
    expect(exampleOrganism(["sus_scrofa", "mus_musculus"]).organism).toBe("sus_scrofa");
    expect(exampleOrganism(["danio_rerio"])).toEqual({ organism: "danio_rerio", example: null });
    for (const e of list) {
      const spec = exampleRequest(e, organism, example);
      for (const p of e.parameters.filter((q) => q.required))
        expect(spec.values[p.name], `${e.key} ${p.name}`).not.toBe("");
    }
  });

  it("the curl line is the request the console sends, for every endpoint", async () => {
    for (const e of list) {
      const spec = exampleRequest(e, organism, example);
      const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
      );
      vi.stubGlobal("fetch", fetch);
      await send(spec.method, requestUrl(ORIGIN, spec), spec.body);
      const [url, init] = fetch.mock.calls[0] ?? ["", {}];
      const made = curlRequest(curl(ORIGIN, spec));
      expect(made.url, e.key).toBe(url);
      expect(made.method, e.key).toBe(init.method);
      expect(made.headers, e.key).toEqual(init.headers);
      expect(made.body, e.key).toBe(init.body ?? null);
    }
  });

  it("the same for values a shell or an address must escape", async () => {
    const spec: RequestSpec = {
      method: "GET",
      path: "/api/v1/organisms/{organism}/genes-named",
      values: { organism: "homo sapiens's", name: 'it\'s a "name" & more/€', fold_case: "true" },
      kinds: { name: "string", fold_case: "boolean" },
      order: ["name", "fold_case"],
      pathNames: ["organism"],
      body: null,
    };
    const fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetch);
    await send(spec.method, requestUrl(ORIGIN, spec), null);
    const made = curlRequest(curl(ORIGIN, spec));
    expect(made.url).toBe((fetch.mock.calls[0] as unknown as [string])[0]);
    expect(new URL(made.url).searchParams.get("name")).toBe('it\'s a "name" & more/€');
    expect(decodeURIComponent(new URL(made.url).pathname.split("/")[4] ?? "")).toBe("homo sapiens's");
    expect(shellWords(shellQuote("a'b'c"))).toEqual(["a'b'c"]);
    const post: RequestSpec = { ...spec, method: "POST", body: '{"identifiers": ["it\'s"]}' };
    expect(curlRequest(curl(ORIGIN, post)).body).toBe('{"identifiers": ["it\'s"]}');
  });

  it("are the request the document recorded an answer of, where the server holds its organism", () => {
    let recorded = 0;
    for (const e of list) {
      const own = recordedRequest(e);
      const success = e.answers.find((a) => a.status.startsWith("2"));
      if (!success?.media.some((m) => m.recorded)) {
        expect(own, e.key).toBeNull();
        continue;
      }
      if (own === null) continue; // a recorded answer whose request the document does not state whole
      recorded += 1;
      // Each value is the parameter's example in the document, as typed; a parameter without one is not sent.
      for (const p of e.parameters)
        expect(own.values[p.name], `${e.key} ${p.name}`).toBe(
          p.example === undefined ? "" : typeof p.example === "string" ? p.example : JSON.stringify(p.example),
        );
      if (e.body) expect(JSON.parse(own.body ?? "null"), e.key).toEqual(e.body.example);
      // A server holding the recorded organism shows that request; one that does not, its own example.
      const humanServer = exampleRequest(e, "homo_sapiens", EXAMPLES["homo_sapiens"] ?? null, ["homo_sapiens"]);
      expect(sameRequest(humanServer, own), e.key).toBe(true);
      if (own.pathNames.includes("organism")) {
        const pigServer = exampleRequest(e, "sus_scrofa", EXAMPLES["sus_scrofa"] ?? null, ["sus_scrofa"]);
        expect(pigServer.values["organism"], e.key).toBe("sus_scrofa");
        expect(sameRequest(pigServer, own), e.key).toBe(false);
      }
    }
    // Every endpoint of the document but one whose answer is not recorded has its request recorded whole.
    expect(recorded).toBeGreaterThanOrEqual(list.length - 1);
    const convert = list.find((x) => x.key === "GET /api/v1/organisms/{organism}/convert");
    if (!convert) throw new Error("no convert endpoint");
    const own = recordedRequest(convert);
    expect(own?.values).toMatchObject({
      organism: "homo_sapiens",
      identifier: "ENSG00000141510",
      from_release: "100",
      final_database: "HGNC Symbol",
      to_release: "",
    });
  });

  it("writes the request in Python, R and JavaScript with the same address, query and body", () => {
    const e = list.find((x) => x.key === "GET /api/v1/organisms/{organism}/convert");
    if (!e) throw new Error("no convert endpoint");
    const spec = exampleRequest(e, "sus_scrofa", EXAMPLES["sus_scrofa"] ?? null, ["sus_scrofa"]);
    spec.values["to_release"] = "100";
    spec.values["final_database"] = "HGNC Symbol";
    expect(python(ORIGIN, spec)).toContain(
      'params={"identifier": "HSPB1", "to_release": 100, "final_database": "HGNC Symbol"}',
    );
    expect(python(ORIGIN, spec)).toContain(`"${ORIGIN}/api/v1/organisms/sus_scrofa/convert"`);
    expect(r(ORIGIN, spec)).toContain(
      'req_url_query(identifier = "HSPB1", to_release = 100, final_database = "HGNC Symbol")',
    );
    expect(javascript(ORIGIN, spec)).toContain(
      'new URLSearchParams({ identifier: "HSPB1", to_release: "100", final_database: "HGNC Symbol" })',
    );
    const batch = list.find((x) => x.method === "POST" && x.path.endsWith("/batch"));
    if (!batch) throw new Error("no batch endpoint");
    const body = exampleRequest(batch, "sus_scrofa", EXAMPLES["sus_scrofa"] ?? null, ["sus_scrofa"]);
    expect(body.body).toBe('{"identifiers":["HSPB1","ENSSSCG00000039962","NOT_A_GENE"]}');
    expect(python(ORIGIN, body)).toContain('json={"identifiers": ["HSPB1", "ENSSSCG00000039962", "NOT_A_GENE"]}');
    expect(r(ORIGIN, body)).toContain(
      'req_body_json(list(identifiers = list("HSPB1", "ENSSSCG00000039962", "NOT_A_GENE")))',
    );
    expect(javascript(ORIGIN, body)).toContain('method: "POST"');
  });

  it("writes JSON values as Python and R literals", () => {
    expect(pythonLiteral({ a: null, b: true, c: [1, "x"] })).toBe('{"a": None, "b": True, "c": [1, "x"]}');
    expect(rLiteral({ a: null, b: false, c: [1, "x"] })).toBe('list(a = NA, b = FALSE, c = list(1, "x"))');
    expect(rLiteral({ "from-x": 1 })).toBe("list(`from-x` = 1)");
  });
});

describe("names in R", () => {
  const hostile = ["a` = file.create('PWNED'), `b", "back\\slash", "new\nline", "tab\there", "plain_name", "1st"];

  it("are bare where syntactic, else backtick-quoted with every backtick, backslash and line break escaped", () => {
    expect(rName("plain_name")).toBe("plain_name");
    expect(rName("a` = x, `b")).toBe("`a\\` = x, \\`b`");
    for (const name of hostile) {
      const written = rName(name);
      // Between its backticks, no backtick stands unescaped: the name cannot close itself and become code.
      const inner = written.startsWith("`") ? written.slice(1, -1) : written;
      expect(inner.replace(/\\\\/g, "").replace(/\\`/g, "")).not.toContain("`");
      expect(written).not.toContain("\n");
    }
  });

  it.runIf(spawnSync("Rscript", ["--version"]).status === 0)(
    "read back in R as exactly the name given",
    () => {
      for (const name of hostile) {
        const code = `x <- list(${rName(name)} = 1); cat(names(x), sep = "")`;
        const out = execFileSync("Rscript", ["-e", code], { encoding: "utf8" });
        expect(out).toBe(name);
      }
    },
    60_000,
  ); // Rscript takes seconds to start
});
