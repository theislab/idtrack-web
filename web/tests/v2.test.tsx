// @vitest-environment jsdom
// v2's disclosure components behave as DIRECTION.md says (keyboard, screen readers, the address), the theme button
// goes round its three themes, the home's picture menu is a menu of radio items, and the home's pictures are read from
// the api's data exactly: the lineages' layout, the rings' counts, the constellation's journeys.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryResponse, LineagesResponse, ShowcaseResponse } from "../src/api/types";
import { simplified } from "../src/components/hero/field";
import { ringsOf } from "../src/components/hero/rings";
import { HeroMenu } from "../src/components/shell/HeroMenu";
import { ThemeSwitch } from "../src/components/ThemeSwitch";
import { nextTheme, themeLabel } from "../src/lib/theme";
import { Expandable } from "../src/components/v2/Expandable";
import { HoverCard } from "../src/components/v2/HoverCard";
import { Segmented } from "../src/components/v2/Segmented";
import { Tabs } from "../src/components/v2/Tabs";
import {
  constellationOf,
  convolutedAnswers,
  fitPose,
  KIND,
  project,
  ROLE,
  roomOf,
  SEGMENT,
  STAR,
  TILT,
} from "../src/lib/hero/constellationModel";
import { idAt, layoutLineages, SEGMENT_FLOATS } from "../src/lib/hero/lineageLayout";
import { resetAddress } from "./disclose";
import { conversions } from "./fixtures";

afterEach(() => {
  cleanup();
  resetAddress();
  window.localStorage.clear();
});

const items = [
  { id: "path", label: "Path", count: "3 steps", panel: () => <p>the path</p> },
  { id: "decision", label: "Decision", panel: () => <p>the decision</p> },
  { id: "record", label: "Record", panel: () => <p>the record</p> },
];

describe("tabs", () => {
  it("draws the chosen panel only, labelled by its tab, and moves with the arrow keys, Home and End", () => {
    render(<Tabs items={items} label="The answer" />);
    const [path, decision, record] = screen.getAllByRole("tab");
    expect(screen.getByRole("tabpanel").textContent).toBe("the path");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(path?.id);
    expect(path?.getAttribute("tabindex")).toBe("0");
    expect(decision?.getAttribute("tabindex")).toBe("-1");
    if (!path || !record) throw new Error("no tabs");
    fireEvent.keyDown(path, { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel").textContent).toBe("the decision");
    fireEvent.keyDown(path, { key: "End" });
    expect(screen.getByRole("tabpanel").textContent).toBe("the record");
    expect(document.activeElement).toBe(record);
    fireEvent.keyDown(record, { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel").textContent).toBe("the path");
  });

  it("keeps the choice in the address when given a parameter, and reads it from there", () => {
    window.history.replaceState(null, "", "/convert?id=X&tab=record");
    render(<Tabs items={items} label="The answer" param="tab" />);
    expect(screen.getByRole("tabpanel").textContent).toBe("the record");
    fireEvent.click(screen.getByRole("tab", { name: "Decision" }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("decision");
    expect(new URLSearchParams(window.location.search).get("id")).toBe("X");
    // The first tab is the address without the parameter.
    fireEvent.click(screen.getByRole("tab", { name: /^Path/ }));
    expect(new URLSearchParams(window.location.search).has("tab")).toBe(false);
  });
});

describe("a segmented control", () => {
  function Both() {
    const [value, setValue] = useState<"drawing" | "words">("drawing");
    return (
      <Segmented
        label="The path"
        value={value}
        onChange={setValue}
        options={[
          { value: "drawing", label: "Drawing" },
          { value: "words", label: "In words" },
        ]}
      />
    );
  }
  it("is a radio group of one tab stop that the arrow keys move", () => {
    render(<Both />);
    const [drawing, words] = screen.getAllByRole("radio");
    expect(drawing?.getAttribute("aria-checked")).toBe("true");
    if (!drawing) throw new Error("no radio");
    fireEvent.keyDown(drawing, { key: "ArrowRight" });
    expect(words?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(words);
  });
});

describe("an expandable row", () => {
  it("opens its body on a press, labelled by its summary, and draws nothing of it closed", () => {
    render(
      <Expandable summary="The bridges" meta="3">
        <p>bridges</p>
      </Expandable>,
    );
    const button = screen.getByRole("button", { name: /The bridges/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("bridges")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: /The bridges/ }).textContent).toBe("bridges");
  });
});

describe("a hover card", () => {
  it("opens on a press and closes on Escape", () => {
    render(
      <HoverCard trigger="Term" label="What it means">
        <p>the meaning</p>
      </HoverCard>,
    );
    const trigger = screen.getByRole("button", { name: "What it means" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("the meaning")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("the meaning")).toBeNull();
  });
});

describe("the theme", () => {
  it("is one button that goes round light, dark and the system's, saying the theme in force and the next", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
    expect(themeLabel("light")).toBe("Light mode; switch to dark");
    render(<ThemeSwitch />);
    const button = screen.getByRole("button", { name: "Light mode; switch to dark" });
    fireEvent.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("idtrack-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Dark mode; switch to the system's" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    fireEvent.click(screen.getByRole("button", { name: /^System mode/ }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("idtrack-theme")).toBeNull();
  });
});

describe("the home's picture menu", () => {
  it("is a menu of radio items, the one shown checked; the keys move, Enter chooses, Escape returns", () => {
    render(<HeroMenu />);
    const button = screen.getByRole("button", { name: "Choose the home page picture" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Home page picture" });
    const choices = screen.getAllByRole("menuitemradio");
    expect(choices.map((c) => c.textContent)).toEqual([
      "Lineages through the releases",
      "The releases as rings",
      "Convoluted journeys",
    ]);
    expect(choices[0]?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(choices[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(choices[2]);
    const last = choices[2];
    if (!last) throw new Error("no third picture");
    fireEvent.keyDown(last, { key: "Enter" });
    expect(window.localStorage.getItem("idtrack-hero")).toBe("constellation");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.getAllByRole("menuitemradio")[2]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => undefined);
  });
});

/** A small graph's lineages as the api writes them: two families (one of two ids joined by an edge) and a third id. */
const lineages: LineagesResponse = {
  organism: "sus_scrofa",
  content_digest: null,
  releases: [10, 11, 12, 13],
  genes: 5,
  families: 3,
  focus_families: 1,
  limit: 4,
  ids: ["A", "B", "C", "D"],
  family_starts: [0, 2, 3],
  active: [[[10, 11]], [[12, 13]], [[10, 13]], [[11, 13]]],
  versions: [[11], [], [12, 13], []],
  edges: [[0, 1, 11, 12, 0.9]],
  compute_seconds: 0,
};

describe("the lineages' layout", () => {
  it("stands each release's active ids on one side of the centre, oldest nearest it, and draws only what the api says", () => {
    const layout = layoutLineages(lineages, [12]);
    // The column of each release holds exactly its active ids.
    expect(layout.columns.map((c) => [...c].sort())).toEqual([
      [0, 2],
      [0, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    // Every y within the field; no two ids at one height at one release.
    for (let k = 0; k < 4; k++) {
      const ys = [...(layout.columns[k] ?? [])].map((i) => layout.y[i * 4 + k] ?? Number.NaN);
      expect(new Set(ys).size).toBe(ys.length);
      for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
    }
    // A dot per new version at a release the id is active at; the edge between the two ids of a family.
    expect(layout.counts.versions).toBe(3);
    expect(layout.counts.edges).toBe(1);
    expect(layout.counts.fans).toBe(0);
    expect(layout.focusIds).toBe(2);
    // The id at a point is the id whose line is there.
    const k = 2;
    const id = layout.columns[k]?.[0] ?? -1;
    expect(idAt(layout, k / 3, layout.y[id * 4 + k] ?? Number.NaN)).toBe(id);
  });

  it("simplifies runs of a line that do not change height into one straight segment, and keeps every release", () => {
    const layout = layoutLineages(lineages);
    const { straight, curved } = simplified(layout, [2], 0.01);
    // C is active at every release; its line is straight wherever its height holds.
    const total = straight.length / SEGMENT_FLOATS + curved.length / SEGMENT_FLOATS;
    expect(total).toBeGreaterThan(0);
    const xs = [...straight, ...curved].filter((_, i) => i % SEGMENT_FLOATS === 0 || i % SEGMENT_FLOATS === 2);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1);
  });
});

describe("the rings", () => {
  it("count each release's ids, the ids created at it, those retired into it and the fans, as /history gives them", () => {
    const history: HistoryResponse = {
      organism: "sus_scrofa",
      content_digest: null,
      compute_seconds: 0,
      releases: [
        { release: 10, genes_active: 100, versions_active: 100, created: 100 },
        { release: 11, genes_active: 110, versions_active: 112, created: 20 },
      ],
      transitions: [
        {
          from_release: 10,
          to_release: 11,
          version_changes: 5,
          id_changes: 2,
          same_version: 80,
          retired: 10,
          scored: 90,
          one_to_many: 3,
          many_to_one: 1,
        },
      ],
    };
    const rings = ringsOf(history, [11]);
    expect(rings.active).toEqual([100, 110]);
    // The first release's ids are not drawn as created (they are where the graph begins).
    expect(rings.created).toEqual([0, 20]);
    expect(rings.retired).toEqual([0, 10]);
    expect(rings.fans).toEqual([0, 4]);
    expect(rings.changes).toEqual([1]);
    expect(rings.churn[1]).toBeCloseTo(17 / 110);
  });
});

describe("the constellation", () => {
  const answers = conversions()
    .map((c) => c.result)
    .filter((r) => r.path?.steps.length);
  const showcase = {
    organism: "homo_sapiens",
    content_digest: null,
    checked_on: null,
    journeys: answers.map((result) => ({
      query: { identifier: result.query_id, from_release: null, to_release: null, final_database: null, explain: true },
      result,
      error: null,
    })),
    cases: [],
  } as ShowcaseResponse;
  const span = { first: 48, last: 115, changes: [55, 76] };
  const model = constellationOf(showcase, 5, span);
  const xOf = (release: number) => ((release - span.first) / (span.last - span.first)) * 2 - 1;

  it("draws the answers whose paths pass the most ids and steps, each id a star and each step a curve", () => {
    const chosen = convolutedAnswers(showcase, 5);
    expect(model.journeys.map((j) => j.identifier)).toEqual(chosen.map((r) => r.query_id));
    expect(model.journeys.length).toBeGreaterThan(0);
    const size = (r: (typeof chosen)[number]) =>
      new Set(r.path?.steps.flatMap((s) => [s.source, s.target])).size + (r.path?.steps.length ?? 0);
    for (let i = 1; i < chosen.length; i++)
      expect(size(chosen[i - 1] ?? chosen[i]!)).toBeGreaterThanOrEqual(size(chosen[i]!));
    chosen.forEach((r, j) => {
      const journey = model.journeys[j];
      const steps = (r.path?.steps ?? []).filter((s) => s.source !== null && s.source !== s.target);
      const ids = new Set(steps.flatMap((s) => [s.source ?? "", s.target]));
      expect(journey?.steps).toBe(steps.length);
      expect(journey?.nodes).toBeGreaterThanOrEqual(ids.size);
      // The fans are the steps where Ensembl's mapping splits or merges.
      expect(journey?.fans).toBe(
        steps.filter((s) => (s.kind === "history" || s.kind === "self_loop") && (s.splits > 0 || s.merges > 0)).length,
      );
      expect(journey?.answer).toBe(
        r.candidates
          .filter((c) => c.best)
          .map((c) => c.target)
          .join(", "),
      );
      // The star of the id asked for is the journey's anchor, and it is the only one with the query's role.
      const anchor = journey?.anchor ?? -1;
      expect(model.stars[anchor * STAR + 3]).toBe(j);
      expect(model.stars[anchor * STAR + 6]).toBe(ROLE.query);
    });
    const stars = model.stars.length / STAR;
    expect(stars).toBe(model.journeys.reduce((n, j) => n + j.nodes, 0));
  });

  it("puts every star and segment at its releases on the axis of time, the axis and its rings at the changes", () => {
    for (let i = 0; i < model.stars.length; i += STAR) {
      expect(Math.abs(model.stars[i] ?? 2)).toBeLessThanOrEqual(1 + 1e-6);
      // Its place in the path is between the id asked for (0) and the farthest id (1).
      expect(model.stars[i + 5]).toBeGreaterThanOrEqual(0);
      expect(model.stars[i + 5]).toBeLessThanOrEqual(1);
    }
    let axis = 0;
    for (let i = 0; i < model.segments.length; i += SEGMENT) {
      expect(Math.abs(model.segments[i] ?? 2)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(model.segments[i + 3] ?? 2)).toBeLessThanOrEqual(1 + 1e-6);
      if (model.segments[i + 6] === KIND.axis) axis++;
    }
    expect(model.changes).toEqual([55, 76]);
    expect(axis).toBe(24 + 40 * 2);
    // A star of an Ensembl id stands where the id begins (its first active release).
    const r = convolutedAnswers(showcase, 1)[0];
    const begins = r?.path?.nodes.find((n) => n.kind === "ensembl_gene" && n.active.length && n.id !== r.query_id);
    if (begins) {
      const first = Math.max(span.first, begins.active[0]?.[0] ?? 0);
      const xs: number[] = [];
      for (let i = 0; i < model.stars.length; i += STAR) if (model.stars[i + 3] === 0) xs.push(model.stars[i] ?? 9);
      expect(xs.some((x) => Math.abs(x - xOf(first)) < 1e-5)).toBe(true);
    }
  });

  it("is composed beside the words on a wide screen and under them on a phone, never behind them", () => {
    const words = { left: 104, top: 120, right: 650, bottom: 520 };
    const caption = { left: 104, top: 820, right: 1336, bottom: 880 };
    const wide = roomOf(1440, 836, words, caption);
    expect(wide.left).toBeGreaterThan(words.right);
    expect(wide.bottom).toBeLessThan(caption.top);
    const phone = roomOf(
      390,
      788,
      { left: 16, top: 30, right: 374, bottom: 470 },
      { left: 16, top: 690, right: 374, bottom: 780 },
    );
    expect(phone.top).toBeGreaterThan(470);
    expect(phone.bottom).toBeLessThan(690);
    expect(phone.left).toBeGreaterThanOrEqual(16);
    expect(phone.right).toBeLessThanOrEqual(374);
  });

  it("stays inside its room at every turn and at every tilt the pointer may give it", () => {
    for (const room of [
      { left: 700, top: 40, right: 1370, bottom: 800 },
      { left: 16, top: 486, right: 374, bottom: 682 },
    ]) {
      const pose = fitPose(model, room, 10, { roll: 0.1, yaw: 0.62 });
      const seen = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let turn = 0; turn < Math.PI * 2; turn += 0.2)
        for (const yaw of [0.62 - TILT.yaw, 0.62, 0.62 + TILT.yaw])
          for (let i = 0; i < model.segments.length; i += SEGMENT) {
            const q = project(
              { ...pose, turn, yaw },
              model.segments[i] ?? 0,
              model.segments[i + 1] ?? 0,
              model.segments[i + 2] ?? 0,
            );
            seen.left = Math.min(seen.left, q.x);
            seen.right = Math.max(seen.right, q.x);
            seen.top = Math.min(seen.top, q.y);
            seen.bottom = Math.max(seen.bottom, q.y);
          }
      expect(seen.left).toBeGreaterThanOrEqual(room.left);
      expect(seen.right).toBeLessThanOrEqual(room.right);
      expect(seen.top).toBeGreaterThanOrEqual(room.top);
      expect(seen.bottom).toBeLessThanOrEqual(room.bottom);
      // And it fills its room: one side of it within its margin and a few px.
      const slack = Math.min(
        seen.left - room.left + (room.right - seen.right),
        seen.top - room.top + (room.bottom - seen.bottom),
      );
      expect(slack).toBeLessThan(2 * 10 + 40);
    }
  });
});

describe("counting visits", () => {
  it("loads Google's tag once, with signals and ad personalisation off, and counts a page by its path alone", async () => {
    const { countPage, setConsent, startAnalytics } = await import("../src/lib/analytics");
    setConsent("granted");
    expect(window.localStorage.getItem("idtrack-consent")).toBe("granted");
    startAnalytics("G-TEST1234");
    startAnalytics("G-TEST1234");
    const scripts = [...document.head.querySelectorAll("script")].filter((s) => s.src.includes("googletagmanager"));
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST1234");
    const layer = (window as unknown as { dataLayer: IArguments[] }).dataLayer;
    const calls = layer.map((a): unknown[] => Array.from(a as ArrayLike<unknown>));
    const config = calls.find((a) => a[0] === "config");
    expect(config?.[2]).toEqual({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    countPage("/convert");
    const view = layer.map((a): unknown[] => Array.from(a as ArrayLike<unknown>)).find((a) => a[0] === "event");
    expect(view?.[2]).toMatchObject({ page_path: "/convert", page_location: `${window.location.origin}/convert` });
    setConsent(null);
    expect(window.localStorage.getItem("idtrack-consent")).toBeNull();
  });
});
