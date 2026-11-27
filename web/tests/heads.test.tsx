// @vitest-environment jsdom
// Every page's head (DESIGN.md, "Type", "One page head"): one title, and a lede short enough to stand beside it on one
// grid (at most about three lines of its column, so that no hole opens under the title); what a page says more is said
// in its first panel.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiHead } from "../src/pages/ApiPage";
import { BatchHead } from "../src/pages/BatchPage";
import { MethodHead } from "../src/pages/MethodPage";
import { NamesHead } from "../src/pages/NamesPage";
import { ExploreHead } from "../src/pages/OrganismPage";

/** The longest lede: three lines of the lede's column (about 66 characters) at most. */
const LEDE_MOST = 200;

describe("the heads of the pages", () => {
  for (const [name, Head] of [
    ["Batch", BatchHead],
    ["Names", NamesHead],
    ["Explore", ExploreHead],
    ["Method", MethodHead],
    ["API", ApiHead],
  ] as const) {
    it(`${name}: an eyebrow, one title and a lede of at most ${String(LEDE_MOST)} characters`, () => {
      const { container } = render(<Head />);
      expect(container.querySelectorAll(".page-head > .eyebrow")).toHaveLength(1);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      const lede = container.querySelector(".page-head > .lede")?.textContent ?? "";
      expect(lede.length, lede).toBeGreaterThan(40);
      expect(lede.length, lede).toBeLessThanOrEqual(LEDE_MOST);
    });
  }
});
