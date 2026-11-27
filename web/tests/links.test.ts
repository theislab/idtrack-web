import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCS, docsPage, setDocsRoot } from "../src/lib/links";

describe("the documentation's address", () => {
  it("is Read the Docs until the server names another, and every page of it is resolved under that root", () => {
    expect(docsPage()).toBe(DEFAULT_DOCS);
    expect(docsPage("concepts.html#concept-history")).toBe(`${DEFAULT_DOCS}concepts.html#concept-history`);
    setDocsRoot("https://docs.example.org");
    expect(docsPage()).toBe("https://docs.example.org/");
    expect(docsPage("/cli.html")).toBe("https://docs.example.org/cli.html");
    setDocsRoot("javascript:alert(1)");
    expect(docsPage()).toBe("https://docs.example.org/");
    setDocsRoot(DEFAULT_DOCS);
  });

  it("is written in one place: no page or component names the documentation's host itself", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "generated") walk(path);
        } else if (
          /\.(ts|tsx)$/.test(name) &&
          !path.endsWith(join("lib", "links.ts")) &&
          // Generated from the api's document, which states the default address in its descriptions.
          !path.endsWith(join("api", "schema.ts")) &&
          !path.endsWith(join("api", "shapes.ts"))
        )
          files.push(path);
      }
    };
    walk(root);
    const naming = files.filter((f) => readFileSync(f, "utf8").includes("readthedocs.io"));
    expect(naming).toEqual([]);
  });
});
