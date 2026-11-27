// The limitations the answer's evidence cites are idtrack's own: the documentation of the commit the api is pinned to,
// at the same documentation commit as the Method page (one text for both). The generated file names the commit of
// api/uv.lock, so a re-pin fails here until `npm run limitations` has read the new documentation (and
// `npm run limitations:check`, run in CI, fails whenever the section's lead sentences differ from the file's).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import docs from "../src/generated/idtrack_docs.json";
import limitations from "../src/generated/limitations.json";

const lock = readFileSync(join(import.meta.dirname, "..", "..", "api", "uv.lock"), "utf8");

describe("idtrack's known limitations", () => {
  it("are those of the idtrack commit the api is pinned to", () => {
    const pinned = /source = \{ git = "https:\/\/github\.com\/theislab\/idtrack\.git\?[^"#]*#([0-9a-f]{40})" \}/.exec(
      lock,
    );
    expect(pinned?.[1]).toBe(limitations.commit);
    // One text with the Method page: the same code commit and documentation commit as idtrack_docs.json.
    expect(limitations.commit).toBe(docs.commit);
    expect(limitations.docsCommit).toBe(docs.docsCommit);
    expect(limitations.source).toBe(
      `https://github.com/theislab/idtrack/blob/${limitations.docsCommit}/docs/limitations.rst#limitations`,
    );
    // The Method page's list and the answer's sections are the same sections of that text.
    expect(docs.limitations.items.map((item) => item.anchor)).toEqual(limitations.sections.map((s) => s.anchor));
  });

  it("are the lead sentences of the section's limitations, each once", () => {
    expect(limitations.items.length).toBeGreaterThan(0);
    expect(new Set(limitations.items).size).toBe(limitations.items.length);
    for (const item of limitations.items) expect(item).toMatch(/^[A-Z].*[.?!…]$/);
  });
});
