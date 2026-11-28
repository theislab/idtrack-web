// The home's picture, robust: a picture and its caption only ever describe the organism named beside them (a switch
// with the new graph's answers slow or refused); what keeps a picture away is said in the caption's line, on the one
// screen (on its way, refused and asked again, the server unreachable, no graph, an organism not held); the worker
// that lays out the lineages failing to load changes nothing a visitor sees; a WebGL context the browser takes away is
// built again when it comes back, and the still drawn where it does not; and at every size the picture lies in the
// room the words leave, or is not drawn, its caption then saying nothing of it.
import { expect, test, type Page } from "@playwright/test";
import { data, isPhone, withoutPreload } from "./helpers";

/** The graphs the server holds. */
async function organismsOf(page: Page): Promise<string[]> {
  const body = (await (await page.request.get("/api/v1/organisms")).json()) as { organisms: { organism: string }[] };
  return body.organisms.map((o) => o.organism);
}

/** The count of gene ids of a graph as the lineages' answer gives it, written as the caption writes it. */
async function genesOf(page: Page, organism: string): Promise<string> {
  const body = (await (await page.request.get(`/api/v1/organisms/${organism}/lineages?limit=10`)).json()) as {
    genes: number;
  };
  return new Intl.NumberFormat("en-US").format(body.genes).replace(/,/g, " ");
}

/** Go to another organism the way the page does (its router, no reload). */
async function switchTo(page: Page, organism: string): Promise<void> {
  await page.evaluate((o) => {
    window.history.pushState(null, "", `/?organism=${o}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, organism);
}

/** The picture drawn whole: a frame of WebGL or a finished still. */
async function drawn(page: Page): Promise<void> {
  await expect
    .poll(async () => Number((await page.locator(".hero2__field").getAttribute("data-frames")) ?? 0), {
      timeout: 90_000,
    })
    .toBeGreaterThan(0);
}

const caption = (page: Page) => page.locator(".hero2__caption");

for (const picture of ["lineages", "rings"] as const) {
  test(`${picture}: a switch of organism never shows the previous graph's picture under the new name`, async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the switch is the same on every window");
    const all = await organismsOf(page);
    const other = all.find((o) => o !== data.organism);
    test.skip(!other, "the server holds one graph");
    if (!other) return;
    await page.addInitScript((p) => {
      if (p !== "lineages") localStorage.setItem("idtrack-hero", p);
    }, picture);
    await page.goto(`/?organism=${data.organism}`);
    await drawn(page);
    const before = await caption(page).textContent();
    const endpoint = picture === "lineages" ? "lineages" : "history";
    // The new graph's answer held back 8 s: meanwhile nothing of the previous graph is said or drawn.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/organisms/${other}/${endpoint}*`, async (route) => {
      await held;
      await route.continue();
    });
    await switchTo(page, other);
    await page.waitForTimeout(1500);
    const during = (await caption(page).textContent()) ?? "";
    expect(during).not.toBe(before);
    if (picture === "lineages") expect(during).not.toContain(await genesOf(page, data.organism));
    expect(during).toMatch(/Drawing the/);
    await expect(page.locator(".hero2__field canvas")).toHaveCount(0);
    release();
    await drawn(page);
    if (picture === "lineages") await expect(caption(page)).toContainText(await genesOf(page, other));
    await expect(caption(page)).toContainText(`GET /api/v1/organisms/${other}/${endpoint}`);
    // Refused: said, with the new graph's endpoint, and nothing of the previous graph.
    await page.unroute(`**/api/v1/organisms/${other}/${endpoint}*`);
    await page.route(`**/api/v1/organisms/${data.organism}/${endpoint}*`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "x-request-id": "e2e" },
        body: JSON.stringify({
          error: {
            code: "internal",
            message: "A fault.",
            argument: null,
            allowed: null,
            details: null,
            request_id: "e2e",
          },
        }),
      }),
    );
    await page.goto(`/?organism=${other}`);
    await drawn(page);
    await switchTo(page, data.organism);
    await expect(caption(page)).toContainText(
      `The picture could not be drawn: GET /api/v1/organisms/${data.organism}/${endpoint} answered 500 internal`,
    );
    await expect(page.locator(".hero2__field canvas")).toHaveCount(0);
    expect(await caption(page).textContent()).not.toContain(`/${other}/`);
  });
}

test("a refusal that names its wait is said in the caption's line and asked again after it", async ({ page }) => {
  // Refused for the first 1.5 s (every request then: a page may ask twice as it starts), answered after.
  let first = 0;
  let refused = 0;
  let answered = 0;
  await page.route(`**/api/v1/organisms/${data.organism}/lineages*`, async (route) => {
    first ||= Date.now();
    if (Date.now() - first > 1500) {
      answered++;
      return route.continue();
    }
    refused++;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "retry-after": "2", "x-request-id": "e2e" },
      body: JSON.stringify({
        error: {
          code: "server_busy",
          message: "Busy.",
          argument: null,
          allowed: null,
          details: null,
          request_id: "e2e",
        },
      }),
    });
  });
  await page.goto(`/?organism=${data.organism}`);
  await expect(caption(page)).toContainText(
    `GET /api/v1/organisms/${data.organism}/lineages answered 503 server_busy; it is asked again in 2 s.`,
  );
  // On the one screen.
  const box = await page.locator(".hero2__state").boundingBox();
  expect((box?.y ?? 1e6) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  await drawn(page);
  expect(refused).toBeGreaterThan(0);
  expect(answered).toBe(1);
  await expect(caption(page)).toContainText(`GET /api/v1/organisms/${data.organism}/lineages`);
  await expect(page.locator(".hero2__state")).toBeEmpty();
});

test("the server unreachable, no graph, an organism not held: each said in the caption's line, on the one screen", async ({
  page,
}) => {
  await withoutPreload(page);
  await page.route("**/api/v1/organisms", (route) => route.abort());
  await page.goto("/");
  const state = page.locator(".hero2__state");
  await expect(state).toHaveText(
    "The picture could not be drawn: the server cannot be reached; GET /api/v1/organisms is asked again when the connection returns.",
  );
  const box = await state.boundingBox();
  expect((box?.y ?? 1e6) + (box?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
  await page.unroute("**/api/v1/organisms");
  await page.route("**/api/v1/organisms", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ organisms: [] }) }),
  );
  await page.goto("/");
  await expect(state).toHaveText(
    "This server holds no graph yet: it loads its graphs when it starts. Reload the page in a moment.",
  );
  await page.unroute("**/api/v1/organisms");
  await page.goto("/?organism=nothing");
  await expect(state).toContainText("No graph named “nothing” is held here; the picture shows the");
});

test("the lineages' worker failing to load changes nothing a visitor sees: they are laid out on the page", async ({
  page,
}) => {
  let refused = 0;
  // The worker's script (built: its own asset; on the development server: its module served as a worker).
  const script = (url: URL) => /\/lineageWorker-[^/]*\.js$|lineageWorker\.ts\?worker_file/.test(url.href);
  await page.route(script, (route) => {
    refused++;
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`/?organism=${data.organism}`);
  await drawn(page);
  expect(refused).toBeGreaterThan(0);
  await expect(caption(page)).toContainText(await genesOf(page, data.organism));
  await expect(page.locator(".hero2__state")).toBeEmpty();
});

/** Where WebGL draws in software (as here) every picture is a still on a 2D canvas: to see a context lost and given
 *  back, the page is told it has a GPU (the renderer's name a GPU's), and draws one still frame of WebGL (reduced
 *  motion). */
async function pretendGpu(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype;
    const read = Object.getOwnPropertyDescriptor(proto, "getParameter")?.value as (
      this: WebGL2RenderingContext,
      name: number,
    ) => unknown;
    Object.defineProperty(proto, "getParameter", {
      value(this: WebGL2RenderingContext, name: number) {
        // UNMASKED_RENDERER_WEBGL and RENDERER.
        if (name === 0x9246 || name === 0x1f01) return "A test GPU";
        return read.call(this, name);
      },
    });
  });
}

/** How much the picture inks: pixels of the hero that differ, by more than 24 in a channel, between the page with its
 *  canvas and the page without it (the words over the picture and the picture's own labels are the same in both). */
async function inked(page: Page): Promise<number> {
  const canvas = page.locator(".hero2__canvas");
  const shots: string[] = [];
  for (const visibility of ["visible", "hidden"]) {
    await canvas.evaluate((c: HTMLElement, v) => (c.style.visibility = v), visibility);
    shots.push((await page.locator(".hero2").screenshot({ animations: "disabled" })).toString("base64"));
  }
  await canvas.evaluate((c: HTMLElement) => (c.style.visibility = ""));
  return page.evaluate(
    async ([a, b]) => {
      const load = async (s: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${s}`;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const g = c.getContext("2d");
        g?.drawImage(image, 0, 0);
        return g?.getImageData(0, 0, image.width, image.height).data;
      };
      const A = await load(a);
      const B = await load(b);
      if (!A || !B) return 0;
      let n = 0;
      for (let i = 0; i < A.length; i += 4)
        if (Math.max(...[0, 1, 2].map((c) => Math.abs((A[i + c] ?? 0) - (B[i + c] ?? 0)))) > 24) n++;
      return n;
    },
    shots as [string, string],
  );
}

for (const picture of ["lineages", "rings", "constellation"] as const) {
  test(`${picture}: a lost WebGL context is built again when it comes back; where it does not, the still is drawn`, async ({
    browser,
  }, info) => {
    test.skip(isPhone(info), "the same on every window");
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await pretendGpu(page);
    await page.addInitScript((p) => {
      if (p !== "lineages") localStorage.setItem("idtrack-hero", p);
    }, picture);
    await page.goto(`/?organism=${data.organism}`);
    const field = page.locator(".hero2__field");
    await expect(field).toHaveAttribute("data-mode", "webgl2", { timeout: 90_000 });
    await drawn(page);
    await page.waitForTimeout(1500);
    const before = await inked(page);
    expect(before).toBeGreaterThan(1000);
    // Lost, then given back.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".hero2__canvas");
      const lose = canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context");
      (window as unknown as { lose: unknown }).lose = lose;
      lose?.loseContext();
    });
    await page.waitForTimeout(500);
    expect(await inked(page)).toBeLessThan(before / 3);
    await page.evaluate(() => {
      (window as unknown as { lose: { restoreContext(): void } }).lose.restoreContext();
    });
    await expect.poll(() => inked(page), { timeout: 60_000 }).toBeGreaterThan(before * 0.8);
    await expect(field).toHaveAttribute("data-mode", "webgl2");
    // Lost for good: the still.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".hero2__canvas");
      canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(field).toHaveAttribute("data-mode", "canvas2d", { timeout: 10_000 });
    await expect.poll(() => inked(page), { timeout: 60_000 }).toBeGreaterThan(before * 0.5);
    await context.close();
  });
}

test("the History tab's lineage field: a lost WebGL context is built again when it comes back", async ({
  browser,
}, info) => {
  test.skip(isPhone(info), "the same on every window");
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await pretendGpu(page);
  await page.goto(`/organisms/${data.organism}?tab=history`);
  const field = page.locator(".lineage-field__canvas").first();
  await expect(field).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(4000);
  const shot = async () => (await field.screenshot()).length;
  const before = await shot();
  const lost = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".lineage-field__canvas");
    const gl = canvas?.getContext("webgl2");
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    setTimeout(() => lose?.restoreContext(), 500);
    return true;
  });
  test.skip(!lost, "the field draws without WebGL here");
  await page.waitForTimeout(4000);
  // The field is drawn again: as much in it as before (a blank canvas compresses to far fewer bytes).
  expect(await shot()).toBeGreaterThan(before * 0.8);
  await context.close();
});

/** The failures, in words, of the hero at one window: a text box of the words or the caption over the picture's ink
 *  (the same pixels with the canvas and without it), a label of the picture past the window, the hero taller than the
 *  window (where its words fit), and a caption that describes a picture not drawn. */
async function heroFaults(page: Page): Promise<string[]> {
  const found: string[] = [];
  const canvas = page.locator(".hero2__canvas");
  const shown =
    (await canvas.count()) > 0 && (await canvas.evaluate((c) => getComputedStyle(c).visibility !== "hidden"));
  const claim = await page.locator(".hero2__claim").count();
  if (!shown && claim) found.push("the caption describes a picture not drawn");
  if (!shown) return found;
  const boxes = await page.evaluate(() => {
    const range = document.createRange();
    const out: { x: number; y: number; width: number; height: number; text: string }[] = [];
    for (const root of document.querySelectorAll(".hero2__words, .hero2__caption")) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || n.parentElement?.closest(".visually-hidden")) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects())
          if (r.width > 0 && r.bottom > 0 && r.top < innerHeight)
            out.push({
              x: r.left,
              y: Math.max(0, r.top),
              width: r.width,
              height: r.height,
              text: n.textContent.trim(),
            });
      }
    }
    return out;
  });
  const shots: Buffer[] = [];
  for (const visibility of ["visible", "hidden"]) {
    await canvas.evaluate((c: HTMLElement, v) => (c.style.visibility = v), visibility);
    shots.push(await page.screenshot({ animations: "disabled" }));
  }
  await canvas.evaluate((c: HTMLElement) => (c.style.visibility = ""));
  const differing = await page.evaluate(
    async ([a, b, boxes]) => {
      const load = async (s: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${s}`;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const g = c.getContext("2d");
        g?.drawImage(image, 0, 0);
        return g?.getImageData(0, 0, image.width, image.height);
      };
      const A = await load(a);
      const B = await load(b);
      if (!A || !B) return [];
      return boxes
        .filter((box) => {
          for (let y = Math.floor(box.y); y < Math.min(A.height, box.y + box.height); y++)
            for (let x = Math.floor(box.x); x < Math.min(A.width, box.x + box.width); x++) {
              const k = (y * A.width + x) * 4;
              if (Math.abs((A.data[k] ?? 0) - (B.data[k] ?? 0)) > 6) return true;
            }
          return false;
        })
        .map((box) => box.text);
    },
    [shots[0]?.toString("base64") ?? "", shots[1]?.toString("base64") ?? "", boxes] as const,
  );
  for (const text of differing) found.push(`the picture is drawn under "${text}"`);
  const past = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".hero2__field span")]
      .filter((s) => Number(getComputedStyle(s).opacity) > 0 && getComputedStyle(s).display !== "none")
      .map((s) => ({ r: s.getBoundingClientRect(), t: s.textContent }))
      .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.right > innerWidth + 0.5))
      .map(({ t }) => t),
  );
  for (const t of past) found.push(`"${t}" stands past the window`);
  return found;
}

for (const picture of ["lineages", "rings", "constellation"] as const) {
  test(`${picture}: at every size the picture lies in the room the words leave, or is not drawn and not described`, async ({
    page,
  }, info) => {
    test.skip(isPhone(info), "the windows are set here, on the desktop projects");
    test.setTimeout(600_000);
    await page.addInitScript((p) => {
      if (p !== "lineages") localStorage.setItem("idtrack-hero", p);
    }, picture);
    const windows: [number, number][] = [
      [1440, 900],
      [1366, 768],
      [1024, 600],
      [844, 390],
      [768, 1024],
      [720, 450],
      [683, 384],
      [640, 450],
      [390, 844],
      [320, 568],
      [320, 256],
    ];
    for (const [width, height] of windows) {
      await page.setViewportSize({ width, height });
      await page.goto(`/?organism=${data.organism}`);
      await expect(page.locator(".hero2__figure")).toHaveCount(1, { timeout: 30_000 });
      await expect
        .poll(
          async () =>
            Number((await page.locator(".hero2__field").getAttribute("data-frames")) ?? 0) > 0 ||
            ((await page.locator(".hero2__state").textContent()) === "" &&
              (await page.locator(".hero2__field canvas").count()) === 1 &&
              (await page.locator(".hero2__field canvas").evaluate((c) => getComputedStyle(c).visibility)) ===
                "hidden"),
          { timeout: 90_000 },
        )
        .toBe(true);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(400);
      expect(await heroFaults(page), `${String(width)}x${String(height)}`).toEqual([]);
      // At 1366 px and wider the caption is one line.
      if (width >= 1366) {
        const lines = await page
          .locator(".hero2__caption")
          .evaluate((c) => Math.round(c.getBoundingClientRect().height / 18));
        expect(lines, String(width)).toBe(1);
      }
    }
  });
}

test("the words come first in the reading order, then the picture as a figure with its caption", async ({ page }) => {
  await page.goto(`/?organism=${data.organism}`);
  await drawn(page);
  const order = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const figure = document.querySelector(".hero2__figure");
    return {
      first: h1 && figure ? Boolean(h1.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
      caption: figure?.querySelector("figcaption")?.classList.contains("hero2__caption") === true,
      counts:
        figure?.querySelector(":scope > p.visually-hidden")?.textContent.includes("Each line is one gene id") ?? false,
    };
  });
  expect(order).toEqual({ first: true, caption: true, counts: true });
});
