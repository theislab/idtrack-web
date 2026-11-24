// What the end-to-end tests share: the graph's test data, screenshots of each flow, the accessibility check.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Query {
  identifier: string;
  from?: number;
  to?: number;
  db?: string;
}

/** A real path of a kind of step or check (cases.spec.ts), with the status the graph gives it. */
interface Case {
  name: string;
  query: Query;
  status?: string;
}

export interface Data {
  organism: string;
  symbol: Query;
  long: Query;
  backward: Query;
  notFound: Query;
  unknownVersion: Query;
  noTarget: Query;
  noConversion: Query;
  batch: string[];
  name: string;
  /** An identifier whose answer names genes on alternative loci (a graph with such genes only). */
  alternativeLoci?: Query;
  /** A very large answer (hundreds of candidates and steps). */
  large?: Query;
  /** Real paths of every kind of step and check (cases.spec.ts). */
  cases?: Case[];
}

export const data = JSON.parse(
  readFileSync(join(import.meta.dirname, "data", `${process.env.E2E_DATA ?? "pig"}.json`), "utf8"),
) as Data;

/** The address of a conversion. */
export function convertUrl(query: Query): string {
  const parameters = new URLSearchParams({ organism: data.organism, id: query.identifier });
  if (query.from !== undefined) parameters.set("from", String(query.from));
  if (query.to !== undefined) parameters.set("to", String(query.to));
  if (query.db !== undefined) parameters.set("db", query.db);
  return `/?${parameters.toString()}`;
}

/** The api's query of the same conversion (explain on, as the page asks). */
export function apiConvertUrl(query: Query): string {
  const parameters = new URLSearchParams({ identifier: query.identifier, explain: "true" });
  if (query.from !== undefined) parameters.set("from_release", String(query.from));
  if (query.to !== undefined) parameters.set("to_release", String(query.to));
  if (query.db !== undefined) parameters.set("final_database", query.db);
  return `/api/v1/organisms/${data.organism}/convert?${parameters.toString()}`;
}

const folder = resolve(process.env.E2E_SCREENSHOTS ?? join(import.meta.dirname, "..", "test-results", "screenshots"));

/** What the page shows is whole and typed: no value cut by its box, a table wider than its frame announces that it
 *  scrolls, the page itself never scrolls sideways, and no value is written in a programming language's spelling. */
export async function expectWholeAndTyped(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) {
      found.push(`the page is ${document.documentElement.scrollWidth} px wide in a ${width} px window`);
    }
    for (const wrap of document.querySelectorAll<HTMLElement>(".table-wrap")) {
      const outer = wrap.closest(".table-frame-outer");
      if (wrap.scrollWidth > wrap.clientWidth + 1 && !outer?.querySelector(".table-frame__cue")) {
        found.push(`table ${wrap.getAttribute("aria-label") ?? ""} is wider than its frame without the cue`);
      }
    }
    for (const value of document.querySelectorAll<HTMLElement>("td .mono, .answer .mono, .readout__value .mono")) {
      if (value.scrollWidth > value.clientWidth + 1 && getComputedStyle(value).overflow !== "visible") {
        found.push(`a value is cut: ${value.textContent}`);
      }
      const box = value.getBoundingClientRect();
      const cell = value.closest("td, .readout, .answer")?.getBoundingClientRect();
      if (cell && box.width > 0 && (box.right > cell.right + 1 || box.left < cell.left - 1)) {
        found.push(`a value is wider than its cell: ${value.textContent}`);
      }
    }
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("pre.raw, script, style").forEach((e) => {
      e.remove();
    });
    const text = [
      clone.innerText || clone.textContent || "",
      ...[...clone.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? ""),
      ...[...clone.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? ""),
    ].join(" ");
    const spelling = /\b(None|True|False|null|undefined|NaN)\b/.exec(text);
    if (spelling) found.push(`a value is spelt "${spelling[0]}"`);
    return found;
  });
  expect(problems, problems.join("\n")).toEqual([]);
}

/** A full-page screenshot of the flow's state, named by flow and project (width and theme), after checking that what
 *  it shows is whole and typed. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await expectWholeAndTyped(page);
  mkdirSync(folder, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: join(folder, `${name}--${info.project.name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

/** axe-core over the page: no violation of serious or critical impact. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const grave = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact ?? ""}): ${v.help} — ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 5)
          .join(" | ")}`,
    );
  expect(grave, grave.join("\n")).toEqual([]);
}

/** Wait until a conversion's answer is shown (or its state without answer). */
export async function waitForResult(page: Page): Promise<void> {
  await expect(page.locator(".result-area")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("article.result")).toBeVisible();
}

export const isPhone = (info: TestInfo) => info.project.name.startsWith("phone");
