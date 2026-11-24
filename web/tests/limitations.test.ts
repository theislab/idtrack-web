// The limitations on the About page are idtrack's own, at the commit the api is pinned to: the generated file names the
// commit of api/uv.lock, so a re-pin fails here until `npm run limitations` has read the new commit's documentation
// (and `npm run limitations:check`, run in CI, fails whenever the section's lead sentences differ from the file's).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import limitations from "../src/generated/limitations.json";

const lock = readFileSync(join(import.meta.dirname, "..", "..", "api", "uv.lock"), "utf8");

describe("idtrack's known limitations", () => {
  it("are those of the idtrack commit the api is pinned to", () => {
    const pinned = /source = \{ git = "https:\/\/github\.com\/theislab\/idtrack\.git\?[^"#]*#([0-9a-f]{40})" \}/.exec(
      lock,
    );
    expect(pinned?.[1]).toBe(limitations.commit);
    expect(limitations.source).toBe(
      `https://github.com/theislab/idtrack/blob/${limitations.commit}/docs/limitations.rst#limitations`,
    );
  });

  it("are the lead sentences of the section's limitations, each once", () => {
    expect(limitations.items.length).toBeGreaterThan(0);
    expect(new Set(limitations.items).size).toBe(limitations.items.length);
    for (const item of limitations.items) expect(item).toMatch(/^[A-Z].*[.?!…]$/);
  });
});
