// @vitest-environment jsdom
// The rules the shell's disclosures share: where a card goes (inside the window, below or above its trigger), the focus
// a closing card gives back, a hover card that opens on the keyboard's focus; how the palette finds and orders what is
// typed; the one order of organisms; the conversions kept as recent.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HoverCard } from "../src/components/v2/HoverCard";
import { placeCard } from "../src/components/v2/placeCard";
import { ensemblSpecies, idShaped, matchScore, ranked } from "../src/lib/palette";
import { addRecent, clearRecent, readRecent } from "../src/lib/recent";
import { inSiteOrder } from "../src/lib/siteOrder";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const phone = { width: 320, height: 568 };

describe("where a card goes", () => {
  it("never past the window's edges, 16 px inside them, whatever the trigger's place", () => {
    // The organism chip at the masthead's right on a phone: a card of 250 px aligned to the trigger's right would run
    // off the left edge (it did: -97 px); it is held inside.
    const chip = { left: 150, right: 240, top: 10, bottom: 46 };
    const at = placeCard(chip, { width: 250, height: 280 }, phone);
    expect(at.left).toBeGreaterThanOrEqual(16);
    expect(at.left + 250).toBeLessThanOrEqual(320 - 16);
    expect(at.top).toBe(54);
    // A trigger at the left edge: the card begins at its left, no further left than the edge.
    expect(placeCard({ left: 4, right: 30, top: 100, bottom: 120 }, { width: 200, height: 100 }, phone).left).toBe(16);
  });

  it("below where it fits, else above, else on the side with more room with its own height", () => {
    const low = { left: 100, right: 120, top: 400, bottom: 420 };
    const above = placeCard(low, { width: 200, height: 200 }, phone);
    expect(above.above).toBe(true);
    expect(above.top).toBe(400 - 8 - 200);
    // A card taller than either side: the larger side, its height that side's room.
    const middle = { left: 100, right: 120, top: 250, bottom: 270 };
    const tall = placeCard(middle, { width: 200, height: 480 }, phone);
    expect(tall).toMatchObject({ top: 270 + 8, maxHeight: 568 - 270 - 8 - 16, above: false });
    // No side with room for a card at all (a short window): the window's height, from its top.
    const squeezed = placeCard(
      { left: 0, right: 20, top: 100, bottom: 140 },
      { width: 200, height: 300 },
      { width: 320, height: 256 },
    );
    expect(squeezed).toMatchObject({ top: 16, maxHeight: 256 - 32 });
  });
});

describe("a card that closes", () => {
  it("gives the focus back to its trigger when it held it (Escape, a choice)", () => {
    render(
      <HoverCard trigger="Organism" label="Organism" hover={false}>
        {(close) => (
          <button type="button" onClick={close}>
            Pig
          </button>
        )}
      </HoverCard>,
    );
    const trigger = screen.getByRole("button", { name: "Organism" });
    fireEvent.click(trigger);
    const choice = screen.getByRole("button", { name: "Pig" });
    choice.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Pig" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Pig" }));
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("is drawn over the page, outside a frame that would clip it", () => {
    render(
      <div style={{ overflow: "hidden" }} data-testid="clip">
        <HoverCard trigger="Term" label="What it means">
          <p>the meaning</p>
        </HoverCard>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "What it means" }));
    const card = screen.getByRole("region", { name: "What it means" });
    expect(screen.getByTestId("clip").contains(card)).toBe(false);
    expect(card.closest(".hovercard__layer")).not.toBeNull();
  });
});

describe("the palette's order", () => {
  const entries = [
    { id: "page-api", group: "Pages", label: "The API", words: "http openapi" },
    { id: "page-method", group: "Pages", label: "Method and accuracy", words: "benchmarks" },
    { id: "human", group: "Organisms", label: "Use Human (Homo sapiens)", words: "human homo_sapiens" },
    { id: "pig", group: "Organisms", label: "Use Pig (Sus scrofa)", words: "pig sus_scrofa" },
  ];
  const typed = (q: string) => [{ id: "convert", group: "Convert", label: `Convert ${q}` }];

  const entry = (id: string) => entries.find((e) => e.id === id) ?? { id, group: "", label: "" };

  it("finds the starts of words, never a piece inside one", () => {
    expect(matchScore(entry("page-api"), "api")).toBe(1);
    // "api" is inside "sapiens": not a match.
    expect(matchScore(entry("human"), "api")).toBe(0);
    expect(matchScore(entry("page-method"), "method")).toBe(2);
  });

  it("puts a match before what is typed, unless what is typed is shaped like an identifier", () => {
    expect(ranked(entries, typed("api"), "api").map((e) => e.id)).toEqual(["page-api", "convert"]);
    expect(ranked(entries, typed("pig"), "pig")[0]?.id).toBe("pig");
    expect(ranked(entries, typed("TP53"), "TP53")[0]?.id).toBe("convert");
    expect(ranked(entries, typed("nothing"), "nothing").map((e) => e.id)).toEqual(["convert"]);
    expect(idShaped("ENSG00000141510")).toBe(true);
    expect(idShaped("INS")).toBe(true);
    expect(idShaped("pig")).toBe(false);
    expect(idShaped("Homo sapiens")).toBe(false);
  });

  it("reads the species part of an Ensembl id", () => {
    expect(ensemblSpecies("ENSSSCG00000038317")).toBe("ENSSSC");
    expect(ensemblSpecies("ENSG00000141510.20")).toBe("ENS");
    expect(ensemblSpecies("ENSMUST00000000001")).toBe("ENSMUS");
    expect(ensemblSpecies("TP53")).toBeNull();
  });
});

describe("the one order of organisms", () => {
  it("is the server's; a view's own set keeps it, unknown ones after", () => {
    const served = ["homo_sapiens", "macaca_fascicularis", "macaca_mulatta", "mus_musculus", "sus_scrofa"];
    expect(inSiteOrder(["sus_scrofa", "mus_musculus", "homo_sapiens", "macaca_mulatta"], served)).toEqual([
      "homo_sapiens",
      "macaca_mulatta",
      "mus_musculus",
      "sus_scrofa",
    ]);
    expect(inSiteOrder(["danio_rerio", "sus_scrofa"], served)).toEqual(["sus_scrofa", "danio_rerio"]);
  });
});

describe("the conversions kept as recent", () => {
  it("keeps the last five, newest first, each once, until cleared", () => {
    for (let i = 0; i < 7; i++)
      addRecent({ organism: "homo_sapiens", identifier: `ID${i}`, from: null, to: null, db: null });
    addRecent({ organism: "homo_sapiens", identifier: "ID4", from: null, to: null, db: null });
    expect(readRecent().map((r) => r.identifier)).toEqual(["ID4", "ID6", "ID5", "ID3", "ID2"]);
    clearRecent();
    expect(readRecent()).toEqual([]);
    window.localStorage.setItem("idtrack-recent", "{not json");
    expect(readRecent()).toEqual([]);
  });
});
