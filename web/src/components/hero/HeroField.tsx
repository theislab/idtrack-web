// The home's picture, one of three (chosen in the masthead, lib/hero/choice.ts), each drawn from the graph in view:
// - the lineages: the gene ids of whole families of the graph (`GET /organisms/{organism}/lineages`), each a line over
//   the releases at which a version of it is active, as growth rings about the centre line (the oldest ids nearest
//   it), the families of the showcase's journeys drawn as the focal threads; over the release axis and its assembly
//   changes (`GET /organisms/{organism}`);
// - the rings: the releases as rings, the first innermost (`GET /organisms/{organism}/history`): ids active, created,
//   retired and the fans of Ensembl's mapping, each ring turning at the pace of its changes (./rings.ts);
// - the constellation: the showcase's most convoluted journeys (`GET /organisms/{organism}/showcase`), each the path of
//   its answer, turning about the axis of time.
// WebGL2 draws them (./field.ts, ./constellation.ts); without it, a still 2D drawing. Each is a picture: hidden from
// the accessibility tree and never focused or pressed; its caption says what is drawn and where it comes from, and a
// sentence for screen readers gives the counts. The pointer only lights it.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "../../api/client";
import lineageWorkerUrl from "../../lib/hero/lineageWorker.ts?worker&url";
import type { GraphDescription, HistoryResponse } from "../../api/types";
import { useHeroChoice } from "../../lib/hero/choice";
import { idAt, layoutLineages, runsOf, type LineageLayout } from "../../lib/hero/lineageLayout";
import { groupedInteger } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { useShowcase } from "../../lib/showcase";
import { assemblyBands } from "../figure/releases";
import { constellationOf, type Constellation, type Rect } from "../../lib/hero/constellationModel";
import { createConstellation } from "./constellation";
import { createField, fieldAt, placeOf, type FieldColours, type FieldFrame } from "./field";
import { createRings, ringsOf, type RingsModel } from "./rings";

/** The ids a desktop and a phone ask for. */
const WIDE_LIMIT = 4_000;
const NARROW_LIMIT = 1_500;
/** The journeys the constellation draws. */
const JOURNEYS = 18;

function rgb(value: string): [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [0, 0, 0];
  probe.fillStyle = value.trim() || "#000";
  const hex = probe.fillStyle;
  if (hex.startsWith("#") && hex.length === 7)
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const parts = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(hex);
  return parts ? [Number(parts[1]) / 255, Number(parts[2]) / 255, Number(parts[3]) / 255] : [0, 0, 0];
}

function readColours(element: Element) {
  const style = getComputedStyle(element);
  const theme = document.documentElement.getAttribute("data-theme");
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const colours: FieldColours & { handoff: [number, number, number]; external: [number, number, number] } = {
    ink: rgb(style.getPropertyValue("--ink-1")),
    history: rgb(style.getPropertyValue("--hue-history")),
    event: rgb(style.getPropertyValue("--hue-event")),
    handoff: rgb(style.getPropertyValue("--hue-handoff")),
    external: rgb(style.getPropertyValue("--hue-external")),
    dark,
  };
  return colours;
}

/** Where the lineages lie in the hero: low and across the width, leaving the words their room. */
function frameOf(width: number, height: number): FieldFrame {
  const narrow = width < 720;
  if (narrow) return { left: 0, right: width, centre: height * 0.67, half: Math.min(height * 0.15, 150) };
  return {
    left: Math.max(24, width * 0.035),
    right: width - Math.max(24, width * 0.035),
    centre: height * 0.66,
    half: height * 0.235,
  };
}

/** The address of the page's worker, passed through the page's one Trusted Types policy of its own
 *  (`idtrack-worker`, the server's Content-Security-Policy), which lets that address alone through. */
const WORKER_URL = new URL(lineageWorkerUrl, window.location.href).href;
let workerPolicy: { createScriptURL: (url: string) => unknown } | null | undefined;
function workerScript(): string | URL {
  const types = (
    window as unknown as {
      trustedTypes?: { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => unknown };
    }
  ).trustedTypes;
  if (!types) return WORKER_URL;
  workerPolicy ??= types.createPolicy("idtrack-worker", {
    createScriptURL: (url: string) => {
      if (url !== WORKER_URL) throw new TypeError("Not the page's worker.");
      return url;
    },
  }) as { createScriptURL: (url: string) => unknown };
  // A TrustedScriptURL, which the Worker constructor takes where a string is refused.
  return workerPolicy.createScriptURL(WORKER_URL) as string;
}

/** The lineages of the graph laid out, off the page's thread where the browser runs the page's worker
 *  (lib/hero/lineageWorker.ts), else here. */
function useLineageLayout(organism: string, limit: number, eras: readonly number[], wanted: boolean) {
  const [layout, setLayout] = useState<LineageLayout | null>(null);
  const key = eras.join(",");
  useEffect(() => {
    if (!wanted) return;
    const ask = key.split(",").filter(Boolean).map(Number);
    const here = () => {
      const controller = new AbortController();
      api.lineages(organism, limit, { signal: controller.signal }).then(
        (answer) => {
          setLayout(layoutLineages(answer.data, ask));
        },
        () => undefined,
      );
      return () => {
        controller.abort();
      };
    };
    let worker: Worker;
    try {
      worker = new Worker(workerScript(), { type: "module" });
    } catch {
      return here();
    }
    const arrived = (event: MessageEvent<{ layout?: LineageLayout; ids?: string }>) => {
      const { layout: laid, ids } = event.data;
      if (laid) setLayout({ ...laid, ids: ids ? ids.split("\n") : [] });
      worker.terminate();
    };
    worker.addEventListener("message", arrived);
    worker.postMessage({
      url: `${API_BASE}/organisms/${encodeURIComponent(organism)}/lineages?limit=${limit}`,
      eras: ask,
    });
    return () => {
      worker.removeEventListener("message", arrived);
      worker.terminate();
    };
  }, [organism, limit, key, wanted]);
  return layout;
}

/** Changes of theme, as a counter (each one redraws the picture in the theme's inks). */
function useThemeChanges(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => {
      setN((v) => v + 1);
    };
    const themes = new MutationObserver(bump);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    scheme?.addEventListener("change", bump);
    return () => {
      themes.disconnect();
      scheme?.removeEventListener("change", bump);
    };
  }, []);
  return n;
}

/** Run a renderer only while the hero is on screen and the page is shown. */
function watchVisible(element: Element, run: (on: boolean) => void): () => void {
  let onScreen = true;
  const apply = () => {
    run(onScreen && document.visibilityState === "visible");
  };
  const seen =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          apply();
        });
  seen?.observe(element);
  document.addEventListener("visibilitychange", apply);
  apply();
  return () => {
    seen?.disconnect();
    document.removeEventListener("visibilitychange", apply);
  };
}

/** The pointer over the whole hero (its words too), in CSS px of `element`, a frame at most; touch is ignored. */
function watchPointer(element: Element, move: (p: { x: number; y: number } | null) => void): () => void {
  const hero = element.closest(".hero2") ?? element;
  let pending = 0;
  let last: PointerEvent | null = null;
  const point = () => {
    pending = 0;
    if (!last) return;
    const rect = element.getBoundingClientRect();
    move({ x: last.clientX - rect.left, y: last.clientY - rect.top });
  };
  const onMove = (event: Event) => {
    if (!(event instanceof PointerEvent) || event.pointerType === "touch") return;
    last = event;
    if (!pending) pending = requestAnimationFrame(point);
  };
  const onLeave = () => {
    last = null;
    move(null);
  };
  hero.addEventListener("pointermove", onMove, { passive: true });
  hero.addEventListener("pointerleave", onLeave);
  return () => {
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
    if (pending) cancelAnimationFrame(pending);
  };
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Lifted {
  x: number;
  y: number;
  title: string;
  line: string;
}

export function HeroField({ description }: { description: GraphDescription }) {
  const choice = useHeroChoice();
  const narrow = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 719px)").matches;
  const lineal = choice === "lineages";
  const eras = useMemo(
    () =>
      assemblyBands(description)
        .slice(1)
        .map((b) => b.first),
    [description],
  );
  const layout = useLineageLayout(description.organism, narrow ? NARROW_LIMIT : WIDE_LIMIT, eras, lineal);
  const showcase = useShowcase(choice === "constellation" ? description.organism : null);
  const stars = useMemo(
    () =>
      showcase.state === "done"
        ? constellationOf(showcase.answer.data, JOURNEYS, {
            first: description.releases[0] ?? 0,
            last: description.releases[description.releases.length - 1] ?? 0,
            changes: eras,
          })
        : null,
    [showcase, description, eras],
  );
  const history = useHistory(choice === "rings" ? description.organism : null);
  const rings = useMemo(
    () =>
      history
        ? ringsOf(
            history,
            assemblyBands(description)
              .slice(1)
              .map((b) => b.first),
          )
        : null,
    [history, description],
  );
  const themes = useThemeChanges();
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FieldFrame | null>(null);
  const [lifted, setLifted] = useState<Lifted | null>(null);

  // The lineages and the rings.
  useEffect(() => {
    const element = box.current;
    if (!lineal || !layout || !element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hero2__canvas";
    element.prepend(canvas);
    const reduced = reducedMotion();
    const f = createField(canvas, layout, reduced);
    element.dataset["mode"] = f.mode;
    f.setColours(readColours(element));
    let current = frameOf(1, 1);
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      current = frameOf(width, height);
      f.resize(width, height, current);
      setFrame(current);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    const stopVisible = watchVisible(element, (on) => {
      f.setRunning(on);
    });
    // The renderer's own measure of its frames, on the element (read by the performance checks).
    const timer = window.setInterval(() => {
      const t = f.stats();
      element.dataset["frames"] = String(t.frames);
      element.dataset["frameMs"] = t.meanFrameMs.toFixed(2);
      element.dataset["drawMs"] = t.meanDrawMs.toFixed(2);
    }, 1000);
    const stopPointer = watchPointer(element, (p) => {
      if (!p || reduced) {
        f.setPointer(p, -1);
        setLifted(null);
        return;
      }
      const at = fieldAt(current, p.x, p.y);
      const id = at.x >= 0 && at.x <= 1 && Math.abs(at.y) <= 0.5 ? idAt(layout, at.x, at.y) : -1;
      f.setPointer(p, id);
      setLifted(id < 0 ? null : liftedOf(layout, id, p));
    });
    const recolour = () => {
      f.setColours(readColours(element));
    };
    window.addEventListener("idtrack:recolour", recolour);
    return () => {
      window.removeEventListener("idtrack:recolour", recolour);
      window.clearInterval(timer);
      stopPointer();
      stopVisible();
      resize?.disconnect();
      f.destroy();
      f.element.remove();
      setLifted(null);
    };
  }, [layout, lineal]);

  // The rings.
  useEffect(() => {
    const element = box.current;
    if (choice !== "rings" || !rings || !element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hero2__canvas";
    element.prepend(canvas);
    const view = createRings(canvas, rings, reducedMotion());
    element.dataset["mode"] = view.mode;
    view.setColours(readColours(element));
    let place = { cx: 0, cy: 0, inner: 1, outer: 2 };
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const narrowNow = width < 720;
      const outer = narrowNow ? Math.min(width * 0.46, height * 0.26) : Math.min(height * 0.38, width * 0.29);
      place = {
        cx: narrowNow ? width / 2 : width * 0.68,
        cy: narrowNow ? height * 0.71 : height * 0.49,
        inner: outer * 0.14,
        outer,
      };
      view.resize(width, height, place);
      setFrame(null);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    const stopVisible = watchVisible(element, (on) => {
      view.setRunning(on);
    });
    const timer = window.setInterval(() => {
      const t = view.stats();
      element.dataset["frames"] = String(t.frames);
      element.dataset["frameMs"] = t.meanFrameMs.toFixed(2);
      element.dataset["drawMs"] = t.meanDrawMs.toFixed(2);
    }, 1000);
    const stopPointer = watchPointer(element, (p) => {
      const k = view.setPointer(p);
      setLifted(p && k >= 0 ? ringLifted(rings, k, p) : null);
    });
    const recolour = () => {
      view.setColours(readColours(element));
    };
    window.addEventListener("idtrack:recolour", recolour);
    return () => {
      window.removeEventListener("idtrack:recolour", recolour);
      window.clearInterval(timer);
      stopPointer();
      stopVisible();
      resize?.disconnect();
      view.destroy();
      canvas.remove();
      setLifted(null);
    };
  }, [rings, choice]);

  // The constellation.
  useEffect(() => {
    const element = box.current;
    if (choice !== "constellation" || !stars || !element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hero2__canvas";
    element.prepend(canvas);
    const view = createConstellation(canvas, element, stars, reducedMotion());
    element.dataset["mode"] = view.mode;
    view.setColours(readColours(element));
    // The picture is composed in the room the words and the caption leave (nothing behind a letter).
    const hero = element.closest(".hero2");
    const words = [...(hero?.querySelectorAll(".hero2__words > *") ?? [])];
    const caption = hero?.querySelector(".hero2__caption") ?? null;
    const measure = () => {
      const field = element.getBoundingClientRect();
      const within = (r: DOMRect): Rect => ({
        left: r.left - field.left,
        top: r.top - field.top,
        right: r.right - field.left,
        bottom: r.bottom - field.top,
      });
      // The words as inked (a line of text as long as it runs, not its block's full width).
      const inked = (w: Element) => {
        const range = document.createRange();
        range.selectNodeContents(w);
        return within(range.getBoundingClientRect());
      };
      const boxes = words.map(inked).filter((r) => r.right > r.left);
      const union = boxes.length
        ? {
            left: Math.min(...boxes.map((r) => r.left)),
            top: Math.min(...boxes.map((r) => r.top)),
            right: Math.max(...boxes.map((r) => r.right)),
            bottom: Math.max(...boxes.map((r) => r.bottom)),
          }
        : null;
      view.resize(field.width, field.height, union, caption ? within(caption.getBoundingClientRect()) : null);
      setFrame(null);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    for (const w of [...words, caption]) if (w) resize?.observe(w);
    const stopVisible = watchVisible(element, (on) => {
      view.setRunning(on);
    });
    const timer = window.setInterval(() => {
      const t = view.stats();
      element.dataset["frames"] = String(t.frames);
      element.dataset["frameMs"] = t.meanFrameMs.toFixed(2);
      element.dataset["drawMs"] = t.meanDrawMs.toFixed(2);
    }, 1000);
    const stopPointer = watchPointer(element, (p) => {
      const j = view.setPointer(p);
      const journey = j >= 0 ? stars.journeys[j] : undefined;
      setLifted(
        p && journey
          ? {
              x: p.x,
              y: p.y,
              title: journey.identifier,
              line: `→ ${journey.answer} · ${journey.steps} steps through ${journey.nodes} ids`,
            }
          : null,
      );
    });
    const recolour = () => {
      view.setColours(readColours(element));
    };
    window.addEventListener("idtrack:recolour", recolour);
    return () => {
      window.removeEventListener("idtrack:recolour", recolour);
      window.clearInterval(timer);
      stopPointer();
      stopVisible();
      resize?.disconnect();
      view.destroy();
      view.element.remove();
      setLifted(null);
    };
  }, [stars, choice]);

  // A change of theme redraws the picture in its inks.
  useEffect(() => {
    if (themes) window.dispatchEvent(new Event("idtrack:recolour"));
  }, [themes]);

  return (
    <>
      <div className="hero2__field" ref={box} aria-hidden="true" data-picture={choice}>
        {choice === "lineages" && frame && layout ? (
          <Axis description={description} layout={layout} frame={frame} />
        ) : null}
        {lifted ? (
          <div
            className={`hero2__lift${lifted.x > window.innerWidth * 0.66 ? " hero2__lift--left" : ""}`}
            style={{ left: lifted.x, top: lifted.y }}
          >
            <span className="hero2__lift-id mono">{lifted.title}</span>
            <span className="hero2__lift-line">{lifted.line}</span>
          </div>
        ) : null}
      </div>
      <Caption
        description={description}
        layout={lineal ? layout : null}
        rings={choice === "rings" ? rings : null}
        stars={choice === "constellation" ? stars : null}
      />
    </>
  );
}

function liftedOf(layout: LineageLayout, id: number, p: { x: number; y: number }): Lifted {
  const runs = runsOf(layout, id);
  const family = (layout.familyOf[2 * id + 1] ?? 0) - (layout.familyOf[2 * id] ?? 0) + 1;
  const versions = layout.versionCounts[id] ?? 0;
  const releases = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return {
    x: p.x,
    y: p.y,
    title: layout.ids[id] ?? "",
    line: `active ${releases}${versions ? ` · ${versions} new version${versions === 1 ? "" : "s"}` : ""}${family > 1 ? ` · a family of ${family} ids` : ""}${id < layout.focusIds ? " · on a showcase journey" : ""}`,
  };
}

/** The release axis under the lineages: the first release of each assembly with its name, and the last release; the
 *  assembly changes as faint rules through the field. */
function Axis({
  description,
  layout,
  frame,
}: {
  description: GraphDescription;
  layout: LineageLayout;
  frame: FieldFrame;
}) {
  const bands = assemblyBands(description);
  const last = description.releases[description.releases.length - 1];
  const n = layout.releases.length;
  const xOf = (release: number) => placeOf(frame, n > 1 ? layout.releases.indexOf(release) / (n - 1) : 0.5, 0).x;
  return (
    <>
      <div className="hero2__axis" style={{ top: frame.centre + frame.half + 18 }}>
        {bands.map((band, i) => (
          <span
            key={band.assembly}
            className={`hero2__tick${i === 0 ? " hero2__tick--first" : ""}`}
            style={{ left: xOf(band.first) }}
          >
            <span className="hero2__tick-release mono">{band.first}</span>
            <span className="hero2__tick-name">{band.name}</span>
          </span>
        ))}
        {last !== undefined ? (
          <span className="hero2__tick hero2__tick--last" style={{ left: xOf(last) }}>
            <span className="hero2__tick-release mono">{last}</span>
          </span>
        ) : null}
      </div>
      {bands.slice(1).map((band) => (
        <span
          key={band.assembly}
          className="hero2__change"
          style={{ left: xOf(band.first), top: frame.centre - frame.half, height: 2 * frame.half }}
        />
      ))}
    </>
  );
}

/** What the picture draws and where it comes from, in one quiet line; the counts for a screen reader. */
function Caption({
  description,
  layout,
  rings,
  stars,
}: {
  description: GraphDescription;
  layout: LineageLayout | null;
  rings: RingsModel | null;
  stars: Constellation | null;
}) {
  const name = organismName(description.organism);
  const first = description.releases[0];
  const last = description.releases[description.releases.length - 1];
  const span = first !== undefined && last !== undefined ? `${first}–${last}` : "";
  if (layout)
    return (
      <p className="hero2__caption">
        <span>
          <span className="mono">{groupedInteger(layout.shown)}</span> of the{" "}
          <span className="mono">{groupedInteger(layout.genes)}</span> gene ids of the <em>{name}</em> graph, Ensembl{" "}
          <span className="mono">{span}</span>
        </span>
        <span className="hero2__key">
          <span className="hero2__key-dot" aria-hidden="true" /> a new version
        </span>
        <span className="hero2__key">
          <span className="hero2__key-curve" aria-hidden="true" /> an edge to another id
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/lineages</span>
        <span className="visually-hidden">
          . Each line is one gene id over the releases at which a version of it is active; the{" "}
          {groupedInteger(layout.counts.versions)} dots are new versions Ensembl gave them, and the{" "}
          {groupedInteger(layout.counts.edges)} curves are history edges from one id to another,{" "}
          {groupedInteger(layout.counts.fans)} of them where Ensembl&apos;s mapping fans out to two or more ids or in
          from two or more. The ids are {groupedInteger(layout.counts.families)} whole families of ids joined by such
          edges: first those of the showcase&apos;s journeys, then others in a fixed order.
        </span>
      </p>
    );
  if (rings)
    return (
      <p className="hero2__caption">
        <span>
          The <span className="mono">{rings.releases.length}</span> releases of the <em>{name}</em> graph as rings,{" "}
          <span className="mono">{span}</span> from the centre out; each turns at the pace of its changes
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick hero2__key-tick--out" aria-hidden="true" /> {groupedInteger(rings.unit)} ids
          created
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick" aria-hidden="true" /> {groupedInteger(rings.unit)} retired
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--event" aria-hidden="true" /> a fan of Ensembl&apos;s mapping
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/history</span>
        <span className="visually-hidden">
          . Each ring is one release, its weight the gene ids active there; outside it a tick for each{" "}
          {groupedInteger(rings.unit)} ids created at that release, inside it a tick for each{" "}
          {groupedInteger(rings.unit)} retired on the way into it; a short orange spoke between two rings for each gene
          version whose history edges fan out to two or more versions or in from two or more (
          {groupedInteger(rings.fans.reduce((a, b) => a + b, 0))} in all); the first ring of each later assembly in its
          own colour.
        </span>
      </p>
    );
  if (stars) {
    const fans = stars.journeys.reduce((n, j) => n + j.fans, 0);
    const bridges = stars.journeys.reduce((n, j) => n + j.bridges, 0);
    return (
      <p className="hero2__caption">
        <span>
          The paths of the <span className="mono">{stars.journeys.length}</span> most convoluted answers of the{" "}
          <em>{name}</em> showcase about the axis of time,{" "}
          <span className="mono">{`${stars.first}–${stars.last}`}</span>
        </span>
        <span className="hero2__key">
          <span className="hero2__key-star" aria-hidden="true" /> an id
        </span>
        <span className="hero2__key">
          <span className="hero2__key-answer" aria-hidden="true" /> an answer
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--event" aria-hidden="true" /> a split or merge
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--external" aria-hidden="true" /> another database
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/showcase</span>
        <span className="visually-hidden">
          . Releases run along the axis; each journey stands on its own strand about it. Each id is a star where it
          begins, larger where more steps of the path meet it and brighter along the path toward the answer, with a ring
          about the id asked for and about each answer, and a thread over the releases at which it is active; each step
          is a curve from one id to the next: {groupedInteger(fans)} steps where Ensembl&apos;s mapping splits or
          merges, {groupedInteger(bridges)} steps into or through another database, the others steps of Ensembl&apos;s
          id history (between assemblies in their own colour). A ring about the axis marks each change of assembly
          {stars.changes.length ? ` (releases ${stars.changes.join(", ")})` : ""}. The journeys:{" "}
          {stars.journeys.map((j) => `${j.identifier} to ${j.answer || "no answer"}, ${j.steps} steps`).join("; ")}.
        </span>
      </p>
    );
  }
  return (
    <p className="hero2__caption hero2__caption--waiting" aria-hidden="true">
      &nbsp;
    </p>
  );
}

/** The words beside a ring under the pointer: its release and what the history counts there. */
function ringLifted(rings: RingsModel, k: number, p: { x: number; y: number }): Lifted {
  return {
    x: p.x,
    y: p.y,
    title: `Release ${rings.releases[k] ?? ""}`,
    line: `${groupedInteger(rings.active[k] ?? 0)} gene ids active · ${groupedInteger(rings.created[k] ?? 0)} created · ${groupedInteger(rings.retired[k] ?? 0)} retired · ${groupedInteger(rings.fans[k] ?? 0)} fans`,
  };
}

/** The graph's history counts (for the rings), asked once a ring picture is wanted. */
function useHistory(organism: string | null) {
  const [body, setBody] = useState<HistoryResponse | null>(null);
  useEffect(() => {
    if (!organism) return;
    const controller = new AbortController();
    api.history(organism, { signal: controller.signal }).then(
      (answer) => {
        setBody(answer.data);
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [organism]);
  return body;
}
