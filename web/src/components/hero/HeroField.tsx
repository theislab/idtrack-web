// The home's picture, one of three (chosen in the masthead, lib/hero/choice.ts), each drawn from the graph in view:
// - the lineages: the gene ids of whole families of the graph (`GET /organisms/{organism}/lineages`), each a line over
//   the releases at which a version of it is active, as growth rings about the centre line, on a field seen in
//   perspective that opens from the first release, far and low under the words, to the last, near and tall at the
//   right; over the release axis, its assembly changes (`GET /organisms/{organism}`) and the release at which most
//   gene ids were new after the first (`GET /organisms/{organism}/history`);
// - the rings: the releases as rings, the first innermost (`GET /organisms/{organism}/history`);
// - the cable: the showcase's most convoluted journeys braided about a horizontal axis of time
//   (`GET /organisms/{organism}/showcase`).
// Each visit follows one of the showcase's journeys (the next each time the home is opened in this browser): it is the
// lineages' focal thread and carries their first light, the rings mark the releases of its steps, the cable turns it
// toward the viewer. The three pictures read their data through one request state (lib/useRequest.ts: asked again
// after the wait a refusal names, and when the connection returns), and the caption line says, in words, that a
// picture is on its way or what failed. A picture is drawn only in the room the words and the caption leave; where
// none is left it is not drawn and its caption says nothing of it. Each is hidden from the accessibility tree and never
// focused or pressed; its caption says what is drawn and where it comes from, and a sentence for screen readers gives
// the counts. The pointer only lights it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type AnyRequestError } from "../../api/client";
import { failureWords } from "../../lib/hero/failure";
import type { ConversionResult, GraphDescription, HistoryResponse } from "../../api/types";
import type { HeroChoice } from "../../lib/hero/choice";
import { idAt, type LineageLayout } from "../../lib/hero/lineageLayout";
import { loadLineageLayout } from "../../lib/hero/lineageLoad";
import {
  constellationOf,
  convolutedAnswers,
  pathGenes,
  roomOf,
  stepReleases,
  type Constellation,
  type Rect,
} from "../../lib/hero/constellationModel";
import { visitNumber } from "../../lib/hero/visit";
import { lateStep, liftedOf, ringLifted, type Lifted } from "../../lib/hero/words";
import { CONVOLUTION_WORDS, journeyStepsText } from "../../lib/path/steps";
import { groupedInteger } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { useShowcase } from "../../lib/showcase";
import { useRequest, type RequestState } from "../../lib/useRequest";
import { assemblyBands } from "../figure/releases";
import {
  exposeClock,
  readInks,
  reducedMotion,
  STEPPED,
  watchTheme,
  watchVisible,
  type HeroRoom,
  type Picture,
  type Point,
} from "./canvas";
import { createConstellation, type CablePlace, type ConstellationView } from "./constellation";
import { AXIS_ROOM, AXIS_ROOM_NARROW, createField, fieldAt, frameOf, placer, type FieldFrame } from "./field";
import { createRings, ringLabels, ringsOf, ringsPlace, type RingsLayout, type RingsModel } from "./rings";

/** The ids a desktop and a phone (or a short window, whose field is low) ask for. */
const WIDE_LIMIT = 4_000;
const NARROW_LIMIT = 1_500;
const SMALL = "(max-width: 719px), (max-height: 559px)";
/** The journeys the cable draws. */
const JOURNEYS = 18;
/** How long a picture may be on its way before the caption says so. */
const SAY_WAITING_MS = 1000;
/** A phone's width: the caption says its claim and its key only. */
const NARROW = "(max-width: 719px)";

/** One part of a picture's data: the endpoint it is read from, as the caption names it, and the request's state. */
interface Part<T> {
  endpoint: string;
  state: RequestState<T>;
}

/** The state of a picture read from several parts: drawn when every part is there; failed where one failed (the first
 *  that did, with its endpoint); else on its way. */
type PictureState =
  { state: "loading" } | { state: "failed"; endpoint: string; error: AnyRequestError } | { state: "done" };

function pictureState(parts: readonly Part<unknown>[]): PictureState {
  for (const p of parts)
    if (p.state.state === "failed") return { state: "failed", endpoint: p.endpoint, error: p.state.error };
  return parts.every((p) => p.state.state === "done") ? { state: "done" } : { state: "loading" };
}

const answerOf = <T,>(state: RequestState<T>): T | null => (state.state === "done" ? state.answer.data : null);

/** Whether a picture's failure is the first since its last answer (a refusal that names its wait is asked again once,
 *  after it: the caption says so only of the first). */
function useFirstFailure(state: PictureState): boolean {
  const [seen, setSeen] = useState<{ error: AnyRequestError | null; failures: number }>({ error: null, failures: 0 });
  const error = state.state === "failed" ? state.error : null;
  if (state.state === "done" && seen.failures !== 0) setSeen({ error: null, failures: 0 });
  else if (error && seen.error !== error) setSeen({ error, failures: seen.failures + 1 });
  return seen.failures <= 1;
}

/** True once a picture has been on its way for `SAY_WAITING_MS`. */
function useLate(waiting: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      setLate(true);
    }, SAY_WAITING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [waiting]);
  return waiting && late;
}

/** The boxes of the hero's words in `element`'s pixels: each block as inked (a line of text as long as it runs, the
 *  actions as their buttons, 16 px about them), the content column's edges and the caption's top. */
function measureRoom(element: Element): { room: HeroRoom; blocks: Rect[]; caption: Rect | null } {
  const hero = element.closest(".hero2");
  const origin = element.getBoundingClientRect();
  const within = (r: DOMRect, grow = 0): Rect => ({
    left: r.left - origin.left - grow,
    top: r.top - origin.top - grow,
    right: r.right - origin.left + grow,
    bottom: r.bottom - origin.top + grow,
  });
  const blocks: Rect[] = [];
  const words = hero?.querySelector(".hero2__words");
  const range = document.createRange();
  for (const child of words?.children ?? []) {
    if (child.classList.contains("hero2__actions")) {
      for (const action of child.children) {
        const box = action.getBoundingClientRect();
        if (box.width && box.height) blocks.push(within(box, 16));
      }
      continue;
    }
    range.selectNodeContents(child);
    const box = range.getBoundingClientRect();
    if (box.width && box.height) blocks.push(within(box));
  }
  const union = blocks.length
    ? {
        left: Math.min(...blocks.map((b) => b.left)),
        top: Math.min(...blocks.map((b) => b.top)),
        right: Math.max(...blocks.map((b) => b.right)),
        bottom: Math.max(...blocks.map((b) => b.bottom)),
      }
    : null;
  const captionBox = hero?.querySelector(".hero2__caption")?.getBoundingClientRect();
  const caption = captionBox ? within(captionBox) : null;
  // The content column: the words' box within its padding.
  let left = 16;
  let right = origin.width - 16;
  if (words) {
    const box = words.getBoundingClientRect();
    const style = getComputedStyle(words);
    left = box.left - origin.left + parseFloat(style.paddingLeft);
    right = box.right - origin.left - parseFloat(style.paddingRight);
  }
  return {
    room: {
      width: origin.width,
      height: origin.height,
      words: union,
      captionTop: caption?.top ?? origin.height,
      left,
      right,
    },
    blocks,
    caption,
  };
}

/** The pointer over the whole hero (its words too), in CSS px of `element`, a frame at most; touch is ignored. */
function watchPointer(element: Element, move: (p: Point | null) => void): () => void {
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

/** A value of the field's own (`data-*`), read by the checks: its mode, its frames (undefined: none). */
function mark(element: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) element.removeAttribute(`data-${name}`);
  else element.dataset[name] = value;
}

/** A picture's life on the page: its canvas made and placed in the room left to it, inked, run while seen, lit by the
 *  pointer, handed the development clock, redrawn on a change of theme; `drawn` says whether the room leaves it any. */
function usePicture<P>(
  box: React.RefObject<HTMLDivElement | null>,
  make: ((canvas: HTMLCanvasElement, layer: HTMLDivElement, changed: () => void) => Picture<P>) | null,
  placeIn: (measured: ReturnType<typeof measureRoom>) => P | null,
  lift: (picture: Picture<P>, p: Point) => Lifted | null,
  setLifted: (lifted: Lifted | null) => void,
): { drawn: boolean | null; moving: boolean } {
  const [drawn, setDrawn] = useState<boolean | null>(null);
  const [moving, setMoving] = useState(false);
  const latest = useRef({ placeIn, lift });
  useLayoutEffect(() => {
    latest.current = { placeIn, lift };
  });
  useEffect(() => {
    const element = box.current;
    if (!make || !element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hero2__canvas";
    element.prepend(canvas);
    // The renderer says when its mode changes, also while it is being made (its still at once, without a GPU).
    let made: Picture<P> | null = null;
    const changed = () => {
      if (!made) return;
      mark(element, "mode", made.mode);
      setMoving(made.moving);
    };
    const picture = make(canvas, element, changed);
    made = picture;
    changed();
    picture.setColours(readInks(element));
    const measure = () => {
      const measured = measureRoom(element);
      const place = latest.current.placeIn(measured);
      setDrawn(place !== null);
      picture.element.style.visibility = place === null ? "hidden" : "";
      if (place !== null) picture.resize(measured.room.width, measured.room.height, place);
    };
    measure();
    const hero = element.closest(".hero2");
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    // The words change their boxes as their fonts arrive, and the caption its height.
    for (const watched of [hero?.querySelector(".hero2__words"), hero?.querySelector(".hero2__caption")])
      if (watched) resize?.observe(watched);
    void document.fonts.ready.then(measure);
    const stopClock = exposeClock(
      (seconds) => {
        picture.drawAt(seconds);
      },
      () => picture.work(),
    );
    const stopVisible = watchVisible(element, (on) => {
      picture.setRunning(on);
    });
    // The renderer's own measure of its frames, on the element (read by the performance checks).
    const timer = window.setInterval(() => {
      const t = picture.stats();
      mark(element, "frames", String(t.frames));
      mark(element, "frameMs", t.meanFrameMs.toFixed(2));
      mark(element, "drawMs", t.meanDrawMs.toFixed(2));
    }, 1000);
    const stopPointer = watchPointer(element, (p) => {
      if (p && !reducedMotion()) {
        setLifted(latest.current.lift(picture, p));
        return;
      }
      picture.setPointer(null, -1);
      setLifted(null);
    });
    const stopTheme = watchTheme(() => {
      picture.setColours(readInks(element));
    });
    return () => {
      stopTheme();
      window.clearInterval(timer);
      stopPointer();
      stopVisible();
      stopClock();
      resize?.disconnect();
      picture.destroy();
      picture.element.remove();
      mark(element, "mode", undefined);
      mark(element, "frames", undefined);
      setLifted(null);
    };
  }, [box, make, setLifted]);
  return { drawn, moving };
}

/** The journey this visit follows: the next of the showcase's most convoluted answers each time the home is opened in
 *  this browser (`lib/hero/visit.ts`), among those `usable` keeps. */
function visitJourney(answers: readonly ConversionResult[], usable: (r: ConversionResult) => boolean) {
  if (!answers.length) return null;
  const start = visitNumber() % answers.length;
  for (let i = 0; i < answers.length; i++) {
    const index = (start + i) % answers.length;
    const r = answers[index];
    if (r && usable(r)) return { index, result: r };
  }
  return null;
}

export function HeroField({
  description,
  choice,
  note,
}: {
  description: GraphDescription;
  choice: HeroChoice;
  /** A statement of the address's own (an organism it names that the server does not hold), said first. */
  note: string | null;
}) {
  const organism = description.organism;
  const media = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const narrow = media(NARROW);
  const limit = media(SMALL) ? NARROW_LIMIT : WIDE_LIMIT;
  const bands = useMemo(() => assemblyBands(description), [description]);
  const eras = useMemo(() => bands.slice(1).map((b) => b.first), [bands]);
  const lineal = choice === "lineages";
  const lineages = useRequest(
    lineal ? `hero-lineages|${organism}|${String(limit)}|${eras.join(",")}` : null,
    (signal, fresh) => loadLineageLayout(organism, limit, eras, signal, fresh),
  );
  const history = useRequest(choice === "constellation" ? null : `history|${organism}`, (signal, fresh) =>
    api.history(organism, { signal, fresh }),
  );
  const showcase = useShowcase(organism);
  const parts: Part<unknown>[] = [{ endpoint: `GET /api/v1/organisms/${organism}/showcase`, state: showcase }];
  if (choice !== "constellation")
    parts.unshift({ endpoint: `GET /api/v1/organisms/${organism}/history`, state: history });
  if (lineal) parts.unshift({ endpoint: `GET /api/v1/organisms/${organism}/lineages`, state: lineages });
  const state = pictureState(parts);
  const first = useFirstFailure(state);
  const late = useLate(state.state === "loading");

  const layout = lineal ? answerOf(lineages) : null;
  const historyBody = answerOf(history);
  const showcaseBody = answerOf(showcase);
  const answers = useMemo(() => (showcaseBody ? convolutedAnswers(showcaseBody, JOURNEYS) : []), [showcaseBody]);
  const ready = state.state === "done";
  const journey = useMemo(() => {
    if (!ready) return null;
    if (!layout) return visitJourney(answers, (r) => stepReleases(r).length > 0);
    const index = new Map(layout.ids.map((id, i) => [id, i]));
    return visitJourney(answers, (r) => [...pathGenes(r)].some((g) => index.has(g)));
  }, [ready, layout, answers]);

  const onJourney = useMemo(() => new Set(answers.flatMap((r) => [...pathGenes(r)])), [answers]);
  const box = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [frame, setFrame] = useState<FieldFrame | null>(null);
  const [captionTop, setCaptionTop] = useState(0);

  // The lineages.
  const lineagesMake = useMemo(() => {
    if (!lineal || !layout || !ready) return null;
    const index = new Map(layout.ids.map((id, i) => [id, i]));
    const focus = journey ? [...pathGenes(journey.result)].flatMap((g) => index.get(g) ?? []) : [];
    return (canvas: HTMLCanvasElement, _layer: HTMLDivElement, changed: () => void) =>
      createField(canvas, layout, { reduced: reducedMotion() && !STEPPED, focus, stepped: STEPPED, changed });
  }, [lineal, layout, ready, journey]);
  const lineagesState = usePicture<FieldFrame>(
    box,
    lineagesMake,
    (m) => {
      const f = layout ? frameOf(m.room, layout.top, narrow ? AXIS_ROOM_NARROW : AXIS_ROOM) : null;
      setFrame(f);
      setCaptionTop(m.room.captionTop);
      return f;
    },
    (picture, p) => {
      if (!layout || !frame) return null;
      const at = fieldAt(frame, p.x, p.y);
      const id = at.x >= 0 && at.x <= 1 && Math.abs(at.y) <= 0.5 ? idAt(layout, at.x, at.y) : -1;
      picture.setPointer(p, id);
      return id < 0 ? null : liftedOf(layout, id, p, onJourney);
    },
    setLifted,
  );

  // The rings.
  const rings = useMemo(
    () => (choice === "rings" && historyBody ? ringsOf(historyBody, bands) : null),
    [choice, historyBody, bands],
  );
  const ringsMake = useMemo(() => {
    if (!rings || !ready) return null;
    const releases = journey ? stepReleases(journey.result) : [];
    return (canvas: HTMLCanvasElement, layer: HTMLDivElement, changed: () => void) =>
      createRings(canvas, layer, rings, {
        reduced: reducedMotion() && !STEPPED,
        journey: releases,
        stepped: STEPPED,
        changed,
      });
  }, [rings, ready, journey]);
  const ringsState = usePicture<RingsLayout>(
    box,
    ringsMake,
    (m) => {
      if (!rings) return null;
      const place = ringsPlace(m.room);
      if (!place) return null;
      return { place, labels: ringLabels(rings, place, m.room.width < 720) };
    },
    (picture, p) => {
      if (!rings) return null;
      const k = picture.setPointer(p, -1);
      return k >= 0 ? ringLifted(rings, k, p) : null;
    },
    setLifted,
  );

  // The cable.
  const stars = useMemo(
    () =>
      choice === "constellation" && showcaseBody
        ? constellationOf(showcaseBody, JOURNEYS, {
            first: description.releases[0] ?? 0,
            last: description.releases[description.releases.length - 1] ?? 0,
            changes: eras,
          })
        : null,
    [choice, showcaseBody, description, eras],
  );
  const cable = useRef<ConstellationView | null>(null);
  const blocks = useRef<Rect[]>([]);
  const cableMake = useMemo(() => {
    if (!stars || !ready || !stars.journeys.length) return null;
    const names = new Map(bands.map((b) => [b.first, b.name]));
    return (canvas: HTMLCanvasElement, layer: HTMLDivElement, changed: () => void) => {
      const view = createConstellation(canvas, layer, stars, {
        reduced: reducedMotion() && !STEPPED,
        facing: journey?.index ?? 0,
        names,
        stepped: STEPPED,
        changed,
      });
      cable.current = view;
      return view;
    };
  }, [stars, ready, journey, bands]);
  const cableState = usePicture<CablePlace>(
    box,
    cableMake,
    // Drawn where the cable has a room (the renderer composes it there); where it has none, not drawn.
    (m) => {
      blocks.current = m.blocks;
      return roomOf(m.room.width, m.room.height, m.blocks, m.caption) ? { words: m.blocks, caption: m.caption } : null;
    },
    (picture, p) => {
      if (!stars) return null;
      const j = picture.setPointer(p, -1);
      const found = j >= 0 ? stars.journeys[j] : undefined;
      const band = cable.current?.band();
      if (!found || !band) return null;
      // Centred on the pointer above the cable (below it where the hero has no room above), and clear of every block
      // of the words at that height: the card is about 320 px wide and 64 px tall.
      const above = band.top > 72;
      const top = above ? band.top - 8 - 64 : band.bottom + 8;
      const words = blocks.current.filter((w) => w.bottom > top && w.top < top + 64);
      const left = Math.max(band.left + 160, ...words.map((w) => w.right + 16 + 160));
      return {
        x: Math.max(left, Math.min(p.x, band.right - 160)),
        y: above ? band.top - 8 : band.bottom + 8,
        title: found.identifier,
        line: `→ ${found.answer || "no answer"} · ${found.stepsText}`,
        side: above ? "above" : "below",
      };
    },
    setLifted,
  );

  const drawn = (lineal ? lineagesState : choice === "rings" ? ringsState : cableState).drawn;
  const moving = (lineal ? lineagesState : choice === "rings" ? ringsState : cableState).moving;
  let status: ReactNode = note;
  if (state.state === "failed")
    status = `${note ? `${note} ` : ""}The picture could not be drawn: ${failureWords(state.endpoint, state.error, first)}`;
  else if (state.state === "loading" && late)
    status = `${note ? `${note} ` : ""}${waitingWords(choice, organismName(organism))}`;
  else if (stars?.journeys.length === 0)
    status = `${note ? `${note} ` : ""}The showcase of the ${organismName(organism)} graph holds no answer with a path to draw.`;

  return (
    <figure className="hero2__figure">
      <div className="hero2__field" ref={box} aria-hidden="true" data-picture={choice}>
        {lineal && layout && frame && drawn ? (
          <Axis
            description={description}
            layout={layout}
            frame={frame}
            history={historyBody}
            captionTop={captionTop}
            narrow={narrow}
          />
        ) : null}
        {lifted ? (
          <div
            className={`hero2__lift${lifted.side ? ` hero2__lift--${lifted.side}` : lifted.x > window.innerWidth * 0.66 ? " hero2__lift--left" : ""}`}
            style={{ left: lifted.x, top: lifted.y }}
          >
            <span className="hero2__lift-id mono">{lifted.title}</span>
            <span className="hero2__lift-line">{lifted.line}</span>
          </div>
        ) : null}
      </div>
      <figcaption className="hero2__caption">
        <span className="hero2__state" role="status">
          {status}
        </span>
        {ready && drawn ? (
          <Caption
            description={description}
            choice={choice}
            layout={layout}
            rings={rings}
            stars={stars}
            moving={moving}
          />
        ) : null}
      </figcaption>
      {ready && drawn ? (
        <p className="visually-hidden">
          <Counts
            description={description}
            choice={choice}
            layout={layout}
            rings={rings}
            stars={stars}
            journey={journey?.result ?? null}
          />
        </p>
      ) : null}
    </figure>
  );
}

/** What the caption says while a picture is on its way. */
function waitingWords(choice: HeroChoice, name: string): string {
  if (choice === "lineages") return `Drawing the lineages of the ${name} graph…`;
  if (choice === "rings") return `Drawing the releases of the ${name} graph as rings…`;
  return `Drawing the most convoluted journeys of the ${name} graph…`;
}

/** The release axis under the lineages: the first release of each assembly with its name, the release at which most
 *  gene ids were new after the first (from `/history`, with their number), and the last release, at the field's foot;
 *  the assembly changes as hairlines up through the field to its outermost line there. Toward the far end the releases
 *  lie close: a name with no room beside its neighbour moves to a second row, or is left out, then a release; every
 *  name is left out where its row would come within 8 px of the caption. */
function Axis({
  description,
  layout,
  frame,
  history,
  captionTop,
  narrow,
}: {
  description: GraphDescription;
  layout: LineageLayout;
  frame: FieldFrame;
  history: HistoryResponse | null;
  captionTop: number;
  narrow: boolean;
}) {
  const bands = assemblyBands(description);
  const last = description.releases[description.releases.length - 1];
  const n = layout.releases.length;
  const place = placer(frame);
  const kOf = (release: number) => layout.releases.indexOf(release);
  const uOf = (release: number) => (n > 1 ? kOf(release) / (n - 1) : 0.5);
  const xOf = (release: number) => place(uOf(release), 0.5).x;
  const late = lateStep(
    history,
    bands.map((b) => b.first),
  );
  const top = frame.near.bottom + 10;
  // Rows: the releases, then the names, then a second row of names; each 14 px.
  const rows = narrow ? 1 : top + 3 * 14 + 8 <= captionTop ? 3 : top + 2 * 14 + 8 <= captionTop ? 2 : 1;
  interface Tick {
    key: string;
    release: number;
    name: string;
    kind: string;
    x: number;
    show: boolean;
    row: number;
  }
  const ticks: Tick[] = [
    ...bands.map((band, i) => ({
      key: String(band.assembly),
      release: band.first,
      name: band.name,
      kind: i === 0 ? "first" : "",
    })),
    ...(late
      ? [{ key: "late", release: late.release, name: `${groupedInteger(late.created)} new`, kind: "late" }]
      : []),
    ...(last !== undefined ? [{ key: "last", release: last, name: "", kind: "last" }] : []),
  ]
    .sort((a, b) => a.release - b.release || (a.kind === "last" ? 1 : -1))
    .filter((t, i, all) => all.findIndex((o) => o.release === t.release) === i)
    .map((t) => ({ ...t, x: xOf(t.release), show: true, row: rows > 1 && t.name ? 1 : 0 }));
  const width = (text: string) => text.length * 6.5;
  const extent = (t: Tick, text: string): [number, number] => {
    const w = width(text);
    return t.kind === "first" ? [t.x, t.x + w] : t.kind === "last" ? [t.x - w, t.x] : [t.x - w / 2, t.x + w / 2];
  };
  const clash = (a: [number, number], b: [number, number]) => a[0] < b[1] + 10 && b[0] < a[1] + 10;
  // The releases: the first and the last always; another where it has room.
  const shown: Tick[] = [];
  for (const t of ticks) {
    const keep =
      t.kind === "first" ||
      t.kind === "last" ||
      shown.every((s) => !clash(extent(s, String(s.release)), extent(t, String(t.release))));
    if (!keep) {
      t.show = false;
      continue;
    }
    // A release that crowds the last gives way to it.
    shown.push(t);
  }
  const lastTick = shown[shown.length - 1];
  for (const t of shown.slice(0, -1))
    if (
      lastTick &&
      t.kind !== "first" &&
      clash(extent(t, String(t.release)), extent(lastTick, String(lastTick.release)))
    )
      t.show = false;
  // The names: on the first row of names where they have room, else on the second, else left out.
  const placed: { row: number; span: [number, number] }[] = [];
  for (const t of shown) {
    if (!t.show || !t.name || rows < 2) {
      t.row = 0;
      continue;
    }
    const span = extent(t, t.name);
    const free = (row: number) => placed.every((p) => p.row !== row || !clash(p.span, span));
    t.row = free(1) ? 1 : rows > 2 && free(2) ? 2 : 0;
    if (t.row) placed.push({ row: t.row, span });
  }
  return (
    <>
      <div className="hero2__axis" style={{ top }}>
        {shown
          .filter((t) => t.show)
          .map((t) => (
            <span key={t.key} className={`hero2__tick${t.kind ? ` hero2__tick--${t.kind}` : ""}`} style={{ left: t.x }}>
              <span className="hero2__tick-release mono">{t.release}</span>
              {t.row ? (
                <span className="hero2__tick-name" style={{ top: t.row * 14 }}>
                  {t.name}
                </span>
              ) : null}
            </span>
          ))}
      </div>
      {[...bands.slice(1).map((b) => b.first), ...(late ? [late.release] : [])].map((release) => {
        const k = kOf(release);
        if (k < 0) return null;
        const at = place(uOf(release), layout.top[k] ?? -0.5);
        return (
          <span
            key={release}
            className={`hero2__change${late?.release === release ? " hero2__change--late" : ""}`}
            style={{ left: at.x, top: at.y, height: frame.near.bottom - at.y }}
          />
        );
      })}
    </>
  );
}

/** What the picture draws and where it comes from, in one quiet line: its claim, its key, its endpoint (on a phone the
 *  claim and the key; the endpoint and the counts are said in the sentence for screen readers). */
function Caption({
  description,
  choice,
  layout,
  rings,
  stars,
  moving,
}: {
  description: GraphDescription;
  choice: HeroChoice;
  layout: LineageLayout | null;
  rings: RingsModel | null;
  stars: Constellation | null;
  moving: boolean;
}) {
  const name = organismName(description.organism);
  const source = (path: string) => (
    <span className="hero2__source mono">
      GET /api/v1/organisms/{description.organism}/{path}
    </span>
  );
  if (choice === "lineages" && layout)
    return (
      <>
        <span className="hero2__claim">
          <span className="mono">{groupedInteger(layout.shown)}</span> of the{" "}
          <span className="mono">{groupedInteger(layout.genes)}</span> gene ids of
          <span className="hero2__wide"> the</span> <em>{name}</em>
          <span className="hero2__wide"> graph</span>
        </span>
        <span className="hero2__key">
          <span className="hero2__key-dot" aria-hidden="true" /> a new version
        </span>
        <span className="hero2__key">
          <span className="hero2__key-curve hero2__key-curve--event" aria-hidden="true" /> a fan of Ensembl&apos;s
          mapping
        </span>
        <span className="hero2__key">
          <span className="hero2__key-curve" aria-hidden="true" /> one id continued by another
        </span>
        {source("lineages")}
      </>
    );
  if (choice === "rings" && rings) {
    const unit = groupedInteger(rings.unit);
    return (
      <>
        <span className="hero2__claim">
          The <span className="mono">{rings.releases.length}</span> releases of the <em>{name}</em> graph
          {moving ? ", each turning at the pace of its changes" : ""}
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick hero2__key-tick--out" aria-hidden="true" /> {unit} new
        </span>
        <span className="hero2__key">
          <span className="hero2__key-tick" aria-hidden="true" /> {unit} retired
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--event" aria-hidden="true" /> a fan
        </span>
        <span className="hero2__key">
          <span className="hero2__key-dot" aria-hidden="true" /> a step of a journey
        </span>
        {source("history")}
      </>
    );
  }
  if (choice === "constellation" && stars)
    return (
      <>
        <span className="hero2__claim">
          The <span className="mono">{stars.journeys.length}</span> most convoluted answers of the <em>{name}</em>{" "}
          showcase
        </span>
        <span className="hero2__key">
          <span className="hero2__key-star" aria-hidden="true" /> an id
        </span>
        <span className="hero2__key">
          <span className="hero2__key-knot" aria-hidden="true" /> a split or merge
        </span>
        <span className="hero2__key">
          <span className="hero2__key-line hero2__key-line--external" aria-hidden="true" /> another database
        </span>
        {source("showcase")}
      </>
    );
  return null;
}

/** The sentence for screen readers: what is drawn, counted, and the journey this visit follows. */
function Counts({
  description,
  choice,
  layout,
  rings,
  stars,
  journey,
}: {
  description: GraphDescription;
  choice: HeroChoice;
  layout: LineageLayout | null;
  rings: RingsModel | null;
  stars: Constellation | null;
  journey: ConversionResult | null;
}) {
  const first = description.releases[0];
  const last = description.releases[description.releases.length - 1];
  const span = first !== undefined && last !== undefined ? `${String(first)}–${String(last)}` : "";
  const endpoint = (path: string) => `GET /api/v1/organisms/${description.organism}/${path}`;
  const followed = journey
    ? ` The journey this visit follows is the answer to ${journey.query_id}, ${journeyStepsText(journey)}`
    : "";
  if (choice === "lineages" && layout)
    return (
      <>
        Each line is one gene id over the releases at which a version of it is active, Ensembl {span}; the{" "}
        {groupedInteger(layout.counts.versions)} grains are new versions Ensembl gave them, and the{" "}
        {groupedInteger(layout.counts.edges)} curves are history edges from one id to another,{" "}
        {groupedInteger(layout.counts.fans)} of them where Ensembl&apos;s mapping fans out to two or more ids or in from
        two or more (orange), the others one id continued by another (blue). The ids are{" "}
        {groupedInteger(layout.counts.families)} whole families of ids joined by such edges (
        {groupedInteger(layout.counts.singles)} of them a single id): first those of the showcase&apos;s journeys, then
        others in a fixed order.
        {followed ? `${followed}: its lines are drawn strongest and carry the first light.` : ""} From{" "}
        {endpoint("lineages")}.
      </>
    );
  if (choice === "rings" && rings) {
    const unit = groupedInteger(rings.unit);
    const ids = rings.unit === 1 ? "gene id" : "gene ids";
    return (
      <>
        Each ring is one release, from {rings.releases[0]} at the centre to {rings.releases.at(-1)} at the rim, its line
        the brighter the more gene ids are active there; outside it a tick for every {unit} {ids} whose first release it
        is, inside it a tick for every {unit} {rings.unit === 1 ? "retirement" : "retirements"} of a gene id on the way
        into it, every ring&apos;s ticks at one pitch (the busiest ring&apos;s make one turn), a count that is not a
        whole number of ticks ending in a shorter tick as long as the rest, every tenth tick longer; between it and the
        ring inside it, a short orange spoke for each gene version whose history edges fan out to two or more versions
        or in from two or more ({groupedInteger(rings.fans.reduce((a, b) => a + b, 0))} in all); the first ring of each
        later assembly in its own colour (
        {rings.changes.map((k) => `${rings.assemblies[k] ?? ""} at ${String(rings.releases[k] ?? "")}`).join(", ")}).
        {followed ? `${followed}: a blue grain marks each release at which it takes a step.` : ""} From{" "}
        {endpoint("history")}.
      </>
    );
  }
  if (choice === "constellation" && stars) {
    const fans = stars.journeys.reduce((n, j) => n + j.fans, 0);
    const bridges = stars.journeys.reduce((n, j) => n + j.bridges, 0);
    return (
      <>
        Releases run along a horizontal axis of time, {span}, with a tick at every tenth release and a ring at each
        change of assembly
        {stars.changes.length ? ` (releases ${stars.changes.join(", ")})` : ""}. Each journey winds about it as a coil
        whose radius grows with the ids its path holds at a release and which turns by the steps it takes there. Each id
        is a star where it begins, with a ring about the id asked for and about each answer, and a thread over the
        releases at which it is active; each step of the paths of its candidates is a curve from one id to the next:{" "}
        {groupedInteger(fans)} curves where Ensembl&apos;s mapping splits or merges (a knot), {groupedInteger(bridges)}{" "}
        curves into or through another database, the others steps of Ensembl&apos;s id history. The journeys,{" "}
        {CONVOLUTION_WORDS}:{" "}
        {stars.journeys.map((j) => `${j.identifier} to ${j.answer || "no answer"}, ${j.stepsText}`).join("; ")}.
        {followed ? `${followed}: it faces the viewer first.` : ""} From {endpoint("showcase")}.
      </>
    );
  }
  return null;
}
