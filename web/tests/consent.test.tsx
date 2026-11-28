// @vitest-environment jsdom
// Counting visits (lib/analytics.ts, components/shell/Consent.tsx): Google is told only a page's path and its name and
// as a referrer only another site's origin, before its tag loads and at every change of page; its cookies stay on this
// host; a consent withdrawn in any tab stops the tag, and a page that never counted touches no cookie. The notice is a
// bar whose two answers weigh the same, that reserves its height, lets Escape leave it and hands the focus on.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Analytics from "../src/lib/analytics";

vi.mock("../src/lib/organisms", () => ({ useOrganisms: () => ({ version: { analytics_id: "G-TEST1234" } }) }));

/** The module afresh (its tag not started, its choice not read), as a newly opened page has it. */
async function fresh(): Promise<typeof Analytics> {
  vi.resetModules();
  return import("../src/lib/analytics");
}

const layer = () =>
  ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a): unknown[] =>
    Array.from(a as ArrayLike<unknown>),
  );

function clearCookies(): void {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  delete (window as unknown as { dataLayer?: unknown }).dataLayer;
  delete (window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"];
  for (const s of document.head.querySelectorAll("script")) s.remove();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  clearCookies();
  document.documentElement.style.removeProperty("--consent-h");
  window.history.replaceState(null, "", "/");
});

describe("what Google is told", () => {
  it("loads the tag once, configured with the page's path and name, host-only cookies, signals and ads off", async () => {
    const { startAnalytics } = await fresh();
    document.title = "TP53 → ENSG00000141510.20 · Convert · IDTrack";
    startAnalytics("G-TEST1234", "/convert");
    startAnalytics("G-TEST1234", "/convert");
    const scripts = [...document.head.querySelectorAll("script")].filter((s) => s.src.includes("googletagmanager"));
    expect(scripts.map((s) => s.src)).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-TEST1234"]);
    const fields = {
      page_location: `${window.location.origin}/convert`,
      page_title: "Convert · IDTrack",
      page_referrer: "",
    };
    const calls = layer();
    // The fields are set before the tag is configured, so that its first hit already carries them.
    expect(calls.map((a) => a[0])).toEqual(["js", "set", "config"]);
    expect(calls[1]?.[1]).toEqual(fields);
    expect(calls[2]?.[2]).toEqual({
      ...fields,
      send_page_view: false,
      cookie_domain: "none",
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(JSON.stringify(calls)).not.toContain("TP53");
  });

  it("sets the page's fields again before it counts each page, whatever the tab's title", async () => {
    const { countPage, startAnalytics } = await fresh();
    startAnalytics("G-TEST1234", "/convert");
    document.title = "Q304W3 → ENSSSCG00000052950.1 · Convert · IDTrack";
    countPage("/convert");
    countPage("/organisms/sus_scrofa");
    const after = layer().slice(3);
    expect(after.map((a) => (a[0] === "event" ? `event ${String(a[1])}` : String(a[0])))).toEqual([
      "set",
      "event page_view",
      "set",
      "event page_view",
    ]);
    expect(after[1]?.[2]).toEqual({
      page_location: `${window.location.origin}/convert`,
      page_title: "Convert · IDTrack",
      page_referrer: "",
    });
    expect(after[2]?.[1]).toMatchObject({ page_location: `${window.location.origin}/organisms/sus_scrofa` });
    expect(after[3]?.[2]).toMatchObject({ page_title: "Sus scrofa · IDTrack" });
    expect(JSON.stringify(after)).not.toContain("Q304W3");
  });

  it("names a page by its route alone, an organism's by its name, never by what the address asks", async () => {
    const { pageNameOf } = await import("../src/lib/title");
    expect(pageNameOf("/convert")).toBe("Convert");
    expect(pageNameOf("/organisms/homo_sapiens")).toBe("Homo sapiens");
    expect(pageNameOf("/organisms/<script>")).toBe("An unknown graph");
    // A name that is no production name is written as it was typed, never made to look like one.
    expect(pageNameOf("/organisms/nope")).toBe("nope");
    expect(pageNameOf("/organisms/PIG")).toBe("PIG");
  });

  it("counts an address that is no page as /404, never as typed", async () => {
    const { countedPath } = await fresh();
    expect(countedPath("/convert")).toBe("/convert");
    expect(countedPath("/batch/")).toBe("/batch");
    expect(countedPath("/organisms/homo_sapiens")).toBe("/organisms/homo_sapiens");
    expect(countedPath("/organisms/ENSG00000141510")).toBe("/404");
    expect(countedPath("/ENSG00000141510")).toBe("/404");
    expect(countedPath("/convert/TP53")).toBe("/404");
  });

  it("names as the referrer only another site's origin, never an address of this site", async () => {
    const { pageFields } = await fresh();
    const referrer = (value: string) => {
      Object.defineProperty(document, "referrer", { configurable: true, get: () => value });
    };
    referrer(`${window.location.origin}/convert?organism=sus_scrofa&id=HSPB1`);
    expect(pageFields("/batch").page_referrer).toBe("");
    referrer("https://idtrack.readthedocs.io/en/stable/usage.html?highlight=convert#section");
    expect(pageFields("/batch").page_referrer).toBe("https://idtrack.readthedocs.io/");
    referrer("");
    expect(pageFields("/batch").page_referrer).toBe("");
  });
});

describe("a consent withdrawn", () => {
  it("stops the tag and deletes its cookies on this host, and nothing is counted after", async () => {
    const { countPage, startAnalytics, stopAnalytics } = await fresh();
    startAnalytics("G-TEST1234", "/convert");
    document.cookie = "_ga=GA1.1.1.1; path=/";
    document.cookie = "_ga_TEST1234=GS1.1.1; path=/";
    document.cookie = "kept=1; path=/";
    stopAnalytics("G-TEST1234");
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(true);
    expect(document.cookie).not.toContain("_ga");
    expect(document.cookie).toContain("kept=1");
    const before = layer().length;
    countPage("/batch");
    expect(layer().length).toBe(before);
    // Accepted again: the tag counts again.
    startAnalytics("G-TEST1234", "/batch");
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(false);
    countPage("/batch");
    expect(layer().length).toBe(before + 2);
  });

  it("touches no cookie in a page that never counted", async () => {
    const { stopAnalytics } = await fresh();
    document.cookie = "_ga=GA1.1.other-site; path=/";
    stopAnalytics("G-TEST1234");
    expect(document.cookie).toContain("_ga=GA1.1.other-site");
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBeUndefined();
  });

  it("in another tab reaches this one (the browser's storage event)", async () => {
    window.localStorage.setItem("idtrack-consent", "granted");
    await fresh();
    const { Consent } = await import("../src/components/shell/Consent");
    render(<Consent />);
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(false);
    // The other tab removes the choice ("Cookie settings"): this tab stops and asks again.
    window.localStorage.removeItem("idtrack-consent");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "idtrack-consent", oldValue: "granted", newValue: null }),
      );
    });
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(true);
    expect(screen.getByRole("region", { name: "Counting visits" })).toBeTruthy();
  });
});

describe("the notice", () => {
  it("asks with two answers of one weight, reserves its height, and hands the focus to the page", async () => {
    await fresh();
    const { Consent } = await import("../src/components/shell/Consent");
    const main = document.createElement("main");
    main.id = "main";
    main.tabIndex = -1;
    document.body.append(main);
    render(<Consent />);
    const notice = screen.getByRole("region", { name: "Counting visits" });
    const [decline, accept] = [
      screen.getByRole("button", { name: "Decline" }),
      screen.getByRole("button", { name: "Accept" }),
    ];
    expect(decline.className).toBe(accept.className);
    expect(document.documentElement.style.getPropertyValue("--consent-h")).toMatch(/^\d+px$/);
    // Escape leaves the notice for the page, answering nothing.
    accept.focus();
    fireEvent.keyDown(accept, { key: "Escape" });
    expect(document.activeElement).toBe(main);
    expect(notice.isConnected).toBe(true);
    expect(window.localStorage.getItem("idtrack-consent")).toBeNull();
    // An answer: the notice goes, its room is given back, the focus is the page's.
    decline.focus();
    fireEvent.click(decline);
    expect(screen.queryByRole("region", { name: "Counting visits" })).toBeNull();
    expect(window.localStorage.getItem("idtrack-consent")).toBe("denied");
    expect(document.documentElement.style.getPropertyValue("--consent-h")).toBe("");
    expect(document.activeElement).toBe(main);
    main.remove();
  });

  it("takes the focus when the visitor asks again (Cookie settings), not when it first asks", async () => {
    window.localStorage.setItem("idtrack-consent", "denied");
    await fresh();
    const { Consent, ConsentSettings } = await import("../src/components/shell/Consent");
    render(
      <>
        <Consent />
        <ConsentSettings />
      </>,
    );
    expect(screen.queryByRole("region", { name: "Counting visits" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Decline" }));
  });
});
