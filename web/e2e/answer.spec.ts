// The answer's rules checked on the page: the evidence counts what the answer's path holds, another gene that may be
// the one meant is said first among the cautions with its way on, a tie of candidates of different entry genes is said to be
// equal in the lineage only, an identifier not found is told what its form is and where another graph holds it (on the
// real graphs, by the cases idtrack's documentation names); and on any graph, the layout rules of the answer: the card
// of a candidate on a phone sets each value beside its column's name, the places' drawing sets no text on a bar, and
// the answer comes before its actions on a phone.
import { expect, test, type Page } from "@playwright/test";
import { convertUrl, data, expectAccessible, isPhone, waitForResult } from "./helpers";

// The real graphs (the small graph of the api's tests is also a pig's, without these cases).
const graph = process.env["E2E_DATA"] ?? "pig";
const human = graph === "human" && data.organism === "homo_sapiens";
const pig = graph === "pig" && data.organism === "sus_scrofa";

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?organism=${data.organism}&${query}`);
  await waitForResult(page);
}

test("a bridge across assemblies is counted once per bridge the best answer's paths take", async ({ page }) => {
  test.skip(!pig, "the pig graph's bridges");
  await open(page, "id=ENSSSCP00000069370.1&to=56");
  await expect(page.locator(".answer__cautions")).toContainText("places not compared across assemblies");
  await expect(page.locator(".answer__cautions")).not.toContainText("steps across assemblies");
  await open(page, "id=XM_001925116&to=56");
  await expect(page.locator(".answer__cautions")).toContainText("2 steps across assemblies, places not compared");
});

test("a branch that outranks the id's own continuation is said beside the status", async ({ page }) => {
  test.skip(!pig, "the pig graph's branch (IDTrack's documented example)");
  await open(page, "id=ENSSSCG00000014532&from=56&to=98");
  const cautions = page.getByRole("list", { name: "Cautions to weigh" });
  const alert = cautions.locator(".answer__caution--alert");
  await expect(alert).toContainText("Another gene may be the one meant");
  await expect(alert).toContainText("the id's own continuation ranks below a branch");
  // The limitation it falls under is on its triangle's card, a press away.
  await alert.getByRole("button", { name: /^Caution:/ }).click();
  await expect(alert.getByRole("link", { name: /A branch can outrank the gene's own continuation/ })).toBeVisible();
  await expectAccessible(page);
});

test("another gene that may be the one meant is said beside the status, with the conversion that answers it", async ({
  page,
}) => {
  test.skip(!human, "the human graph's documented cases");
  await open(page, "id=HLA-DRB3&from=70&to=70&db=HGNC%20Symbol");
  const alerts = page.getByRole("list", { name: "Cautions to weigh" }).locator(".answer__caution--alert");
  await expect(alerts).toContainText("Another gene may be the one meant");
  await expect(alerts).toContainText("read only through UniProtKB Gene Name");
  const ask = alerts.getByRole("link", { name: /Ask with HGNC Symbol as the source database/ });
  await expect(ask).toHaveAttribute("href", /from_db=HGNC\+Symbol|from_db=HGNC%20Symbol/);
  await expectAccessible(page);
  // The retired MIR21 id: answered by its host gene through a bridge; the runner-up holds its accessions today.
  await open(page, "id=ENSG00000199004&from=84");
  await expect(page.getByRole("list", { name: "Cautions to weigh" }).locator(".answer__caution--alert")).toContainText(
    "another gene shares the bridged gene's ids",
  );
  await page.getByRole("link", { name: /Ask MI0000077 at release 115/ }).click();
  await waitForResult(page);
  await expect(page.locator(".answer__target").first()).toContainText("ENSG00000284190");
});

test("a tie of candidates of different entry genes is equal in the lineage only, its scores beside it", async ({
  page,
}) => {
  test.skip(!human, "the human graph's MAT1");
  await open(page, "id=MAT1&from=60");
  const text = page.locator(".decision-none");
  await expect(text).toContainText("descend from 2 different entry genes");
  await expect(text).not.toContainText("equal in every criterion");
  await expect(page.locator(".answer__guidance")).toContainText("For a list or a count matrix");
});

test("an identifier not found is told what its form is, and where another graph holds it", async ({ page }) => {
  test.skip(!human, "the human graph beside the mouse graph");
  await open(page, "id=Q15086");
  await expect(page.locator(".answer__hint").first()).toContainText("has the form of a UniProt accession");
  await open(page, "id=1-Mar");
  await expect(page.locator(".answer__hint").first()).toContainText("date a spreadsheet makes of a cell");
  await open(page, "id=ENSMUSG00000059552");
  const elsewhere = page.locator(".answer__elsewhere");
  await expect(elsewhere).toContainText("IDTrack converts within one organism");
  await expect(elsewhere.getByRole("link", { name: /Mus musculus/ })).toBeVisible();
  await expectAccessible(page);
});

test("on a phone each card sets its values beside their column's names, and the answer comes before its actions", async ({
  page,
}, info) => {
  test.skip(!isPhone(info), "the cards of a phone");
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  // Every cell of a card: its name (the cell's ::before) ends before its value begins.
  const crossed = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".result .table--cards td[data-label]")]
      .filter((td) => td.getAttribute("data-label") !== "" && getComputedStyle(td).display !== "none")
      .filter((td) => {
        const before = getComputedStyle(td, "::before");
        const nameEnd = parseFloat(before.left) + parseFloat(before.width);
        return parseFloat(getComputedStyle(td).paddingLeft) < nameEnd - 1;
      })
      .map((td) => td.getAttribute("data-label")),
  );
  expect(crossed).toEqual([]);
  // The answer, then its actions.
  const answer = await page.locator(".answer__flow").boundingBox();
  const actions = await page.locator(".answer__actions").boundingBox();
  expect(answer && actions ? answer.y < actions.y : false).toBe(true);
});

test("the places' drawing sets no text on a bar", async ({ page }) => {
  await page.goto(convertUrl(data.long));
  await waitForResult(page);
  const figure = page.locator(".places-fig svg");
  test.skip((await figure.count()) === 0, "a path without places");
  const crossings = await figure.evaluate((svg) => {
    const bars = [...svg.querySelectorAll(".places-fig__bar")].map((b) => b.getBoundingClientRect());
    return [...svg.querySelectorAll("text")]
      .map((t) => ({ text: t.textContent, box: t.getBoundingClientRect() }))
      .filter(({ box }) =>
        bars.some((b) => box.left < b.right && b.left < box.right && box.top < b.bottom - 1 && b.top + 1 < box.bottom),
      )
      .map(({ text }) => text);
  });
  expect(crossings).toEqual([]);
});
