// @vitest-environment jsdom
// Every page's head (DIRECTION.md, "The shell": a calm head): one title and one sentence under it, nothing beside them;
// a label over the title only where the page names its section (the Convert section's pages have its tabs instead).
// What a page says more is said in its first panel.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiHead } from "../src/pages/ApiPage";
import { BatchHead } from "../src/pages/BatchPage";
import { MethodHead } from "../src/pages/MethodPage";
import { NamesHead } from "../src/pages/NamesPage";
import { ExploreHead } from "../src/pages/OrganismPage";

/** The longest lede: three lines of the lede's measure (about 66 characters) at most. */
const LEDE_MOST = 200;

describe("the heads of the pages", () => {
  // A calm head (the art direction's): the title and one sentence, nothing beside them.
  for (const [name, Head] of [
    ["Explore", ExploreHead],
    ["Method", MethodHead],
    ["API", ApiHead],
  ] as const) {
    it(`${name}: one title and a lede of one sentence, at most ${String(LEDE_MOST)} characters, no label`, () => {
      const { container } = render(<Head />);
      expect(container.querySelectorAll(".eyebrow")).toHaveLength(0);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      const lede = container.querySelector(".page-head > .lede")?.textContent ?? "";
      expect(lede.length, lede).toBeGreaterThan(40);
      expect(lede.length, lede).toBeLessThanOrEqual(LEDE_MOST);
      expect(lede, lede).toMatch(/^[A-Z][^.;:!?]*\.$/);
    });
  }

  for (const [name, Head] of [
    ["Batch", BatchHead],
    ["Names", NamesHead],
  ] as const) {
    it(`${name}: the section's tabs name it (no label over the title), and the lede is one sentence`, () => {
      const { container } = render(<Head />);
      expect(container.querySelectorAll(".page-head > .eyebrow")).toHaveLength(0);
      const lede = container.querySelector(".page-head > .lede")?.textContent ?? "";
      expect(lede, lede).toMatch(/^[A-Z][^.;:!?]*\.$/);
    });
  }
});
