// The home's picture, one of three (chosen in the masthead, lib/hero/choice.ts), each drawn from the graph in view:
// - the lineages: the gene ids of whole families of the graph (`GET /organisms/{organism}/lineages`), each a line over
//   the releases at which a version of it is active, as growth rings about the centre line (the oldest ids nearest
//   it), the families of the showcase's journeys drawn as the focal threads, on a plane seen in perspective that rises
//   from the first release, far and low under the words, to the last, near and tall at the right; over the release
//   axis and its assembly changes (`GET /organisms/{organism}`);
// - the rings: the releases as rings, the first innermost (`GET /organisms/{organism}/history`): ids active, created,
//   retired and the fans of Ensembl's mapping, each ring turning at the pace of its changes (./rings.ts), placed
//   clear of every word of the hero, with the labels of its first ring, its assemblies' first rings and its last;
// - the constellation: the showcase's most convoluted journeys (`GET /organisms/{organism}/showcase`), each the path of
//   its answer, turning about the axis of time.
// WebGL2 draws them (./field.ts, ./constellation.ts); without it, a still 2D drawing. Each is a picture: hidden from
// the accessibility tree and never focused or pressed; its caption says what is drawn and where it comes from, and a
// sentence for screen readers gives the counts. The pointer only lights it.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "../../api/client";
import type { GraphDescription, HistoryResponse } from "../../api/types";
import { useHeroChoice } from "../../lib/hero/choice";
import { idAt, layoutLineages, runsOf, type LineageLayout } from "../../lib/hero/lineageLayout";
import { workerScript } from "../../lib/hero/lineageLoad";
import { groupedInteger } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { useShowcase } from "../../lib/showcase";
import { assemblyBands } from "../figure/releases";
import { constellationOf, type Constellation, type Rect } from "../../lib/hero/constellationModel";
import { createConstellation } from "./constellation";
import { createField, fieldAt, frameOf, placer, type FieldColours, type FieldFrame } from "./field";
import { createRings, grownAt, ringLabels, ringsOf, ringsPlace, type RingLabel, type RingsModel } from "./rings";

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

/** The box of the hero's words (their text and the calls to action, not their empty blocks) in `element`'s pixels. */
function wordsBox(element: Element): { right: number; bottom: number } | null {
  const words = element.closest(".hero2")?.querySelector(".hero2__words");
  if (!words) return null;
  const origin = element.getBoundingClientRect();
  let right = -Infinity;
  let bottom = -Infinity;
  const range = document.createRange();
  for (const child of words.children) {
    const boxes =
      child.children.length && child.classList.contains("hero2__actions")
        ? [...child.children].map((c) => c.getBoundingClientRect())
        : (range.selectNodeContents(child), [range.getBoundingClientRect()]);
    for (const box of boxes) {
      if (!box.width || !box.height) continue;
      right = Math.max(right, box.right - origin.left);
      bottom = Math.max(bottom, box.bottom - origin.top);
    }
  }
  return Number.isFinite(right) ? { right, bottom } : null;
}

/** The top of the caption under the field, in `element`'s pixels. */
function footOf(element: Element): number {
  const caption = element.closest(".hero2")?.querySelector(".hero2__caption");
  const origin = element.getBoundingClientRect();
  return caption ? caption.getBoundingClientRect().top - origin.top : origin.height;
}

/** The development switch (`?hero-frames` on the development server, never in a production build): the animated
 *  path even where WebGL draws in software, time stepped by `window.__heroTime(seconds)`, the frame's GPU work read
 *  by `window.__heroWork()`. */
const STEPPED = import.meta.env.DEV && new URLSearchParams(window.location.search).has("hero-frames");

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
  // The showcase's body (the request's state is a new object at every render; its body is not, so the constellation
  // is laid out, and its renderer made, once per showcase).
  const shown = showcase.state === "done" ? showcase.answer.data : null;
  const stars = useMemo(
    () =>
      shown
        ? constellationOf(shown, JOURNEYS, {
            first: description.releases[0] ?? 0,
            last: description.releases[description.releases.length - 1] ?? 0,
            changes: eras,
          })
        : null,
    [shown, description, eras],
  );
  const history = useHistory(choice === "rings" ? description.organism : null);
  const rings = useMemo(() => (history ? ringsOf(history, assemblyBands(description)) : null), [history, description]);
  const themes = useThemeChanges();
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FieldFrame | null>(null);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [labels, setLabels] = useState<{ marks: RingLabel[]; moving: boolean }>({ marks: [], moving: false });

  // The lineages and the rings.
  useEffect(() => {
    const element = box.current;
    if (!lineal || !layout || !element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hero2__canvas";
    element.prepend(canvas);
    const reduced = reducedMotion() && !STEPPED;
    const f = createField(canvas, layout, reduced, STEPPED);
    element.dataset["mode"] = f.mode;
    // The renderer is made once its shaders are compiled (WebGL2, or the 2D drawing where they failed).
    const made = () => {
      element.dataset["mode"] = f.mode;
    };
    canvas.addEventListener("idtrack:field", made);
    f.setColours(readColours(element));
    let current = frameOf(1, 1, null, 1);
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      current = frameOf(width, height, wordsBox(element), footOf(element), layout.top);
      f.resize(width, height, current);
      setFrame(current);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    // The words change their box as their fonts arrive, and the caption its height.
    const words = element.closest(".hero2")?.querySelector(".hero2__words");
    if (words) resize?.observe(words);
    if (STEPPED) {
      const hooks = window as unknown as Record<string, unknown>;
      hooks["__heroTime"] = (seconds: number) => {
        f.drawAt(seconds * 1000);
      };
      hooks["__heroWork"] = () => f.work();
    }
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
      canvas.removeEventListener("idtrack:field", made);
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
    const view = createRings(canvas, rings, reducedMotion() && !STEPPED, STEPPED);
    element.dataset["mode"] = view.mode;
    view.setColours(readColours(element));
    const hero = element.closest(".hero2");
    const words = hero?.querySelector(".hero2__words") ?? null;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const place = ringsPlace(width, height, wordsBox(element), footOf(element));
      const marks = ringLabels(rings, place, width < 720);
      view.resize(
        width,
        height,
        place,
        marks.map((l) => l.k),
      );
      element.dataset["place"] = [place.form, place.cx, place.cy, place.inner, place.outer, place.horizon ?? ""]
        .map((v) => (typeof v === "number" ? v.toFixed(1) : v))
        .join(" ");
      setLabels({ marks, moving: view.moving });
      setFrame(null);
    };
    measure();
    // The words' and the caption's boxes change with the fonts and the window: the disc follows them.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    if (words) resize?.observe(words);
    const captionNow = hero?.querySelector(".hero2__caption");
    if (captionNow) resize?.observe(captionNow);
    void document.fonts.ready.then(measure);
    if (STEPPED) {
      const hooks = window as unknown as Record<string, unknown>;
      hooks["__heroTime"] = (seconds: number) => {
        view.drawAt(seconds);
      };
      hooks["__heroWork"] = () => view.work();
    }
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
      setLifted(p && k >= 0 && !reducedMotion() ? ringLifted(rings, k, p) : null);
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
      setLabels({ marks: [], moving: false });
      delete element.dataset["place"];
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
        {choice === "rings" && rings
          ? labels.marks.map((l) => (
              <span
                key={l.k}
                className={`hero2__ring-label hero2__ring-label--${l.align}`}
                style={{
                  left: l.x,
                  top: l.y,
                  // Each label appears as its ring grows in.
                  animationDelay: labels.moving ? `${grownAt(l.k, rings.releases.length).toFixed(2)}s` : undefined,
                  animationName: labels.moving ? undefined : "none",
                }}
              >
                <span className="mono">{l.release}</span>
                {l.name ? <span className="hero2__ring-name">{l.name}</span> : null}
              </span>
            ))
          : null}
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

/** The release axis under the lineages: the first release of each assembly with its name, and the last release, at
 *  the plane's foot; the assembly changes as hairlines up through the field to its outermost line there. Toward the
 *  far end the releases lie close: a name with no room beside its neighbour is left out, then a release. */
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
  const place = placer(frame);
  const kOf = (release: number) => layout.releases.indexOf(release);
  const uOf = (release: number) => (n > 1 ? kOf(release) / (n - 1) : 0.5);
  const xOf = (release: number) => place(uOf(release), 0.5).x;
  // The ticks in order, with an estimate of each text's width (the axis' small type: about 6.5 px a character).
  const ticks = [
    ...bands.map((band, i) => ({
      key: band.assembly,
      release: band.first,
      name: band.name,
      kind: i === 0 ? "first" : "",
    })),
    ...(last !== undefined ? [{ key: "last", release: last, name: "", kind: "last" }] : []),
  ].map((tick) => ({ ...tick, x: xOf(tick.release), showName: tick.name !== "", show: true }));
  const extent = (t: (typeof ticks)[number]) => {
    const w = Math.max(String(t.release).length, t.showName ? t.name.length : 0) * 6.5;
    return t.kind === "first" ? [t.x, t.x + w] : t.kind === "last" ? [t.x - w, t.x] : [t.x - w / 2, t.x + w / 2];
  };
  for (let i = 1; i < ticks.length; i++) {
    const tick = ticks[i];
    const before = ticks.slice(0, i).filter((t) => t.show);
    const previous = before[before.length - 1];
    if (!tick || !previous) continue;
    const overlaps = () => (extent(previous)[1] ?? 0) + 10 > (extent(tick)[0] ?? 0);
    if (overlaps() && previous.showName && tick.kind !== "last") previous.showName = false;
    if (overlaps()) tick.showName = false;
    if (overlaps()) previous.show = previous.kind === "first" && tick.kind !== "last" ? true : false;
    if (overlaps()) tick.show = false;
  }
  return (
    <>
      <div className="hero2__axis" style={{ top: frame.near.bottom + 12 }}>
        {ticks
          .filter((tick) => tick.show)
          .map((tick) => (
            <span
              key={tick.key}
              className={`hero2__tick${tick.kind ? ` hero2__tick--${tick.kind}` : ""}`}
              style={{ left: tick.x }}
            >
              <span className="hero2__tick-release mono">{tick.release}</span>
              {tick.showName ? <span className="hero2__tick-name">{tick.name}</span> : null}
            </span>
          ))}
      </div>
      {bands.slice(1).map((band) => {
        const top = place(uOf(band.first), layout.top[kOf(band.first)] ?? -0.5);
        return (
          <span
            key={band.assembly}
            className="hero2__change"
            style={{ left: top.x, top: top.y, height: frame.near.bottom - top.y }}
          />
        );
      })}
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
          <span className="mono">{groupedInteger(layout.genes)}</span> gene ids of the <em>{name}</em> graph
        </span>
        <span className="hero2__key">
          <span className="hero2__key-dot" aria-hidden="true" /> a new version
        </span>
        <span className="hero2__key">
          <span className="hero2__key-curve" aria-hidden="true" /> an edge to another id
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/lineages</span>
        <span className="visually-hidden">
          . Each line is one gene id over the releases at which a version of it is active, Ensembl {span}; the{" "}
          {groupedInteger(layout.counts.versions)} dots are new versions Ensembl gave them, and the{" "}
          {groupedInteger(layout.counts.edges)} curves are history edges from one id to another,{" "}
          {groupedInteger(layout.counts.fans)} of them where Ensembl&apos;s mapping fans out to two or more ids or in
          from two or more. The ids are {groupedInteger(layout.counts.families)} whole families of ids joined by such
          edges: first those of the showcase&apos;s journeys, then others in a fixed order.
        </span>
      </p>
    );
  if (rings) {
    const unit = groupedInteger(rings.unit);
    const ids = rings.unit === 1 ? "gene id" : "gene ids";
    return (
      <p className="hero2__caption">
        <span>
          The <span className="mono">{rings.releases.length}</span> releases of the <em>{name}</em> graph, each ring
          turning at the pace of its changes
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick hero2__key-tick--out" aria-hidden="true" /> {unit} new {ids}
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick" aria-hidden="true" /> {unit} retired
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--event" aria-hidden="true" /> a fan of Ensembl&apos;s mapping
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/history</span>
        <span className="visually-hidden">
          . Each ring is one release, from {rings.releases[0]} at the centre to {rings.releases.at(-1)} at the rim, its
          line the brighter the more gene ids are active there; outside it a tick for every {unit} {ids} whose first
          release it is, inside it a tick for every {unit} {rings.unit === 1 ? "retirement" : "retirements"} of a gene
          id on the way into it, a count that is not a whole number of ticks ending in a shorter tick as long as the
          rest, every tenth tick longer; between it and the ring inside it, a short orange spoke for each gene version
          whose history edges fan out to two or more versions or in from two or more (
          {groupedInteger(rings.fans.reduce((a, b) => a + b, 0))} in all); the first ring of each later assembly in its
          own colour (
          {rings.changes.map((k) => `${rings.assemblies[k] ?? ""} at ${String(rings.releases[k] ?? "")}`).join(", ")}).
        </span>
      </p>
    );
  }
  if (stars?.journeys.length === 0)
    return (
      <p className="hero2__caption">
        <span>
          The axis of time of the <em>{name}</em> graph, <span className="mono">{span}</span>: its showcase holds no
          answer with a path to draw
        </span>
        <span className="hero2__source mono">GET /api/v1/organisms/{description.organism}/showcase</span>
      </p>
    );
  if (stars) {
    const fans = stars.journeys.reduce((n, j) => n + j.fans, 0);
    const bridges = stars.journeys.reduce((n, j) => n + j.bridges, 0);
    return (
      <p className="hero2__caption">
        <span>
          {stars.journeys.length === 1 ? (
            <>
              The path of the only answer of the <em>{name}</em> showcase that has one,{" "}
              <span className="hero2__wide">about the axis of time, </span>
            </>
          ) : (
            <>
              The paths of the <span className="mono">{stars.journeys.length}</span> most convoluted answers of the{" "}
              <em>{name}</em> showcase<span className="hero2__wide"> about the axis of time</span>,{" "}
            </>
          )}
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

/** The words beside a ring under the pointer: its release, its assembly and what the history counts there. */
function ringLifted(rings: RingsModel, k: number, p: { x: number; y: number }): Lifted {
  const n = (values: number[]) => groupedInteger(values[k] ?? 0);
  const assembly = rings.assemblies[k];
  return {
    x: p.x,
    y: p.y,
    title: `Release ${String(rings.releases[k] ?? "")}${assembly ? ` · ${assembly}` : ""}`,
    line:
      k === 0
        ? `${n(rings.active)} gene ids active · the graph begins here`
        : `${n(rings.active)} gene ids active · ${n(rings.created)} new · ${n(rings.retired)} retired on the way in · ${n(rings.fans)} fans`,
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
