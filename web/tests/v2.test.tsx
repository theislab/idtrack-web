// @vitest-environment jsdom
// v2's disclosure components behave as DIRECTION.md says (keyboard, screen readers, the address), the theme button
// goes round its three themes, and the home's picture menu is a menu of radio items (the pictures themselves:
// tests/hero.test.ts).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HeroMenu } from "../src/components/shell/HeroMenu";
import { ThemeSwitch } from "../src/components/ThemeSwitch";
import { nextTheme, themeLabel } from "../src/lib/theme";
import { Field } from "../src/components/ui";
import { Drawer } from "../src/components/v2/Drawer";
import { Expandable } from "../src/components/v2/Expandable";
import { HoverCard } from "../src/components/v2/HoverCard";
import { Segmented } from "../src/components/v2/Segmented";
import { Tabs } from "../src/components/v2/Tabs";
import { resetAddress } from "./disclose";

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

describe("a hover card that does something when pressed", () => {
  it("acts on a press, shows its card to the pointer and to the keyboard's focus, and is described by its text", () => {
    let pressed = 0;
    render(
      <>
        <HoverCard
          trigger="10 names"
          describedBy="about"
          onPress={() => {
            pressed += 1;
          }}
        >
          <span>read at 50 · to 115</span>
        </HoverCard>
        <span id="about" hidden>
          read at 50 · to 115
        </span>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "10 names" });
    expect(trigger.getAttribute("aria-expanded")).toBeNull();
    expect(trigger.getAttribute("aria-describedby")).toBe("about");
    fireEvent.click(trigger);
    expect(pressed).toBe(1);
    expect(document.querySelector(".hovercard__card")).toBeNull();
  });
});

describe("a field's hint", () => {
  it("is a card on an (i) beside the label, and the control's description, never printed under it", () => {
    render(
      <Field label="From release" hint="The release of the dataset's annotation.">
        {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "From release" });
    const described = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("The release of the dataset's annotation.");
    expect(described?.hidden).toBe(true);
    // The mark's name never repeats the label (a field is found by its label alone); its description is the hint.
    expect(screen.getAllByLabelText(/From release/)).toHaveLength(1);
    const mark = screen.getByRole("button", { name: "Hint" });
    expect(mark.getAttribute("aria-describedby")).toBe(described?.id);
    expect(screen.queryByRole("region", { name: "Hint" })).toBeNull();
    fireEvent.click(mark);
    expect(screen.getByRole("region", { name: "Hint" }).textContent).toBe("The release of the dataset's annotation.");
  });
});

describe("a drawer", () => {
  it("offers Escape to its content first, and closes on its button", () => {
    let taken = true;
    function Open() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Server load"
          closeLabel="Close the server load"
          onEscape={() => taken}
        >
          <p>the readings</p>
        </Drawer>
      );
    }
    render(<Open />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(screen.getByText("the readings")).toBeTruthy();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByText("the readings")).not.toBeNull();
    taken = false;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByText("the readings")).toBeNull();
  });
});

describe("tabs and rows the page holds", () => {
  it("show the tab and the openness the page gives them", () => {
    function Held() {
      const [tab, setTab] = useState("decision");
      const [open, setOpen] = useState(false);
      return (
        <>
          <Tabs items={items} label="The answer" value={tab} onChange={setTab} />
          <button
            type="button"
            onClick={() => {
              setTab("record");
              setOpen(true);
            }}
          >
            Show the record
          </button>
          <Expandable summary="Setting" expanded={open} onExpandedChange={setOpen}>
            <p>the fields</p>
          </Expandable>
        </>
      );
    }
    render(<Held />);
    expect(screen.getByRole("tabpanel").textContent).toBe("the decision");
    expect(screen.queryByText("the fields")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the record" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("the record");
    expect(screen.getByText("the fields")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Path/ }));
    expect(screen.getByRole("tabpanel").textContent).toBe("the path");
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

describe("counting visits", () => {
  it("loads Google's tag once, with signals and ad personalisation off, and counts a page by its path alone", async () => {
    const { countPage, setConsent, startAnalytics } = await import("../src/lib/analytics");
    const { pageNameOf } = await import("../src/lib/title");
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
    // An answer's page shows the identifier in the tab's title: the count names the page alone.
    document.title = "TP53 → ENSG00000141510.20 · Convert · IDTrack";
    countPage("/convert", pageNameOf("/convert"));
    const view = layer.map((a): unknown[] => Array.from(a as ArrayLike<unknown>)).find((a) => a[0] === "event");
    expect(view?.[2]).toEqual({
      page_path: "/convert",
      page_location: `${window.location.origin}/convert`,
      page_title: "Convert · IDTrack",
    });
    expect(JSON.stringify(view)).not.toContain("TP53");
    setConsent(null);
    expect(window.localStorage.getItem("idtrack-consent")).toBeNull();
  });

  it("names a page by its route alone, an organism's by its name, never by what the address asks", async () => {
    const { pageNameOf } = await import("../src/lib/title");
    expect(pageNameOf("/convert")).toBe("Convert");
    expect(pageNameOf("/organisms/homo_sapiens")).toBe("Homo sapiens");
    expect(pageNameOf("/organisms/<script>")).toBe("An unknown graph");
  });

  it("stops Google's tag and deletes its cookies when a consent is withdrawn, and counts nothing after", async () => {
    const { countPage, startAnalytics, stopAnalytics } = await import("../src/lib/analytics");
    startAnalytics("G-TEST1234");
    document.cookie = "_ga=GA1.1.1.1; path=/";
    document.cookie = "_ga_TEST1234=GS1.1.1; path=/";
    document.cookie = "kept=1; path=/";
    stopAnalytics("G-TEST1234");
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(true);
    expect(document.cookie).not.toContain("_ga");
    expect(document.cookie).toContain("kept=1");
    const layer = (window as unknown as { dataLayer: IArguments[] }).dataLayer;
    const before = layer.length;
    countPage("/batch", "Batch");
    expect(layer.length).toBe(before);
    // Accepted again: the tag counts again.
    startAnalytics("G-TEST1234");
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(false);
    countPage("/batch", "Batch");
    expect(layer.length).toBe(before + 1);
  });
});
