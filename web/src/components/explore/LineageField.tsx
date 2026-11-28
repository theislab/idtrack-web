// An organism's History tab, its first view: the lineage field of the home (`GET /organisms/{organism}/lineages`,
// drawn by the home's renderer, components/hero/field.ts), here to be read: every line one gene id of whole families
// over the releases at which a version of it is active, a dot at each new version, a curve for each history edge to
// another id. The pointer lifts the family under it and names its id; a press (or Enter) opens that id in Convert at
// the release pointed at. The view zooms and pans along the releases (the buttons, a drag, the + and − keys). An SVG
// over the canvas holds the keyboard's focus: the arrow keys move along a line's releases (← →) and between the lines
// of a release (↑ ↓), Home and End to the line's first and last release, and its words are read out under the figure.
// Every value is the api's.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../../api/client";
import type { GraphDescription } from "../../api/types";
import { convertHref, plainConversion } from "../../lib/convertParameters";
import { idAt, layoutLineages, runsOf, type LineageLayout } from "../../lib/hero/lineageLayout";
import { groupedInteger } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { navigate } from "../../lib/router";
import { usePhone } from "../../lib/usePhone";
import { useRequest } from "../../lib/useRequest";
import { createField, fieldAt, placeOf, type Field, type FieldColours, type FieldFrame } from "../hero/field";
import { assemblyBands } from "../figure/releases";
import { ErrorPanel } from "../ErrorPanel";
import { CaptionMore } from "../home/CaptionMore";
import { Button, Link, Mono, Skeleton } from "../ui";

/** The ids a wide screen and a phone ask for (whole families; the same sample as the home's picture). */
const WIDE_LIMIT = 4_000;
const NARROW_LIMIT = 1_500;
/** The room under the field for its release axis (px). */
const AXIS_ROOM = 40;
/** The narrowest view: this share of the axis (about seven releases of a graph of sixty-eight). */
const LEAST_SPAN = 0.1;

/** The theme's inks, read from the element's computed style. */
function inks(element: Element): FieldColours {
  const style = getComputedStyle(element);
  const probe = document.createElement("canvas").getContext("2d");
  const rgb = (name: string): [number, number, number] => {
    if (!probe) return [0, 0, 0];
    probe.fillStyle = style.getPropertyValue(name).trim() || "#000";
    const hex = probe.fillStyle;
    if (hex.startsWith("#") && hex.length === 7)
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const parts = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(hex);
    return parts ? [Number(parts[1]) / 255, Number(parts[2]) / 255, Number(parts[3]) / 255] : [0, 0, 0];
  };
  const theme = document.documentElement.getAttribute("data-theme");
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  return { ink: rgb("--ink-1"), history: rgb("--hue-history"), event: rgb("--hue-event"), dark };
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The field's frame for a box and a view of the axis (`[from, to]`, fractions): the view fills the box's width. */
export function viewFrame(width: number, height: number, view: readonly [number, number]): FieldFrame {
  const pad = width < 720 ? 8 : 16;
  const inner = Math.max(1, width - 2 * pad);
  const span = Math.max(1e-6, view[1] - view[0]);
  const left = pad - (view[0] / span) * inner;
  const usable = Math.max(1, height - AXIS_ROOM);
  return { left, right: left + inner / span, centre: usable / 2, half: usable * 0.47 };
}

/** A view moved by `delta` (fractions of the axis) and scaled by `factor` about `at`, kept within the axis. */
export function moveView(
  view: readonly [number, number],
  { delta = 0, factor = 1, at = (view[0] + view[1]) / 2 }: { delta?: number; factor?: number; at?: number | undefined },
): [number, number] {
  const span = Math.min(1, Math.max(LEAST_SPAN, (view[1] - view[0]) * factor));
  let from = at - (at - view[0]) * (span / (view[1] - view[0])) + delta;
  from = Math.min(1 - span, Math.max(0, from));
  return [from, from + span];
}

/** An id's words: its runs of active releases, its new versions, its family. */
export function lineWords(layout: LineageLayout, id: number): string {
  const runs = runsOf(layout, id);
  const family = (layout.familyOf[2 * id + 1] ?? 0) - (layout.familyOf[2 * id] ?? 0) + 1;
  const versions = layout.versionCounts[id] ?? 0;
  const releases = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return `active at ${releases}${versions ? ` · ${versions} new version${versions === 1 ? "" : "s"}` : ""}${
    family > 1 ? ` · a family of ${family} ids` : ""
  }${id < layout.focusIds ? " · on a journey of the showcase" : ""}`;
}

/** The release an id is opened at: the release `k` points at where the id is active there, else its last. */
export function releaseFor(layout: LineageLayout, id: number, k: number): number {
  const n = layout.releases.length;
  if (!Number.isNaN(layout.y[id * n + k] ?? NaN)) return layout.releases[k] ?? 0;
  const runs = runsOf(layout, id);
  return runs[runs.length - 1]?.[1] ?? layout.releases[n - 1] ?? 0;
}

interface Picked {
  id: number;
  /** The release index pointed at. */
  k: number;
}

export function LineageField({ description }: { description: GraphDescription }) {
  const phone = usePhone();
  const limit = phone ? NARROW_LIMIT : WIDE_LIMIT;
  const organism = description.organism;
  const answer = useRequest(`lineages|${organism}|${limit}`, (signal) => api.lineages(organism, limit, { signal }));
  const bands = useMemo(() => assemblyBands(description), [description]);
  const layout = useMemo(
    () =>
      answer.state === "done"
        ? layoutLineages(
            answer.answer.data,
            bands.slice(1).map((b) => b.first),
          )
        : null,
    [answer, bands],
  );
  if (answer.state === "failed")
    return <ErrorPanel error={answer.error} onRetry={answer.retry} context="The lineages of this graph" level={3} />;
  if (!layout) return <Skeleton height={phone ? 360 : 480} />;
  return <FieldView description={description} layout={layout} bands={bands} />;
}

function FieldView({
  description,
  layout,
  bands,
}: {
  description: GraphDescription;
  layout: LineageLayout;
  bands: ReturnType<typeof assemblyBands>;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<Field | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<[number, number]>([0, 1]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const drag = useRef<{ x: number; view: [number, number]; moved: boolean } | null>(null);
  const n = layout.releases.length;
  const frame = size ? viewFrame(size.width, size.height, view) : null;
  const organism = description.organism;

  // The renderer, made once per layout; its canvas is the box's first child.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    canvas.className = "lineage-field__canvas";
    canvas.setAttribute("aria-hidden", "true");
    element.prepend(canvas);
    const f = createField(canvas, layout, reducedMotion());
    // The renderer may draw on a canvas of its own in this one's place (without a GPU).
    f.element.setAttribute("aria-hidden", "true");
    field.current = f;
    setMode(f.mode);
    f.setColours(inks(element));
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(element);
    // It draws only while on screen and while the page is shown.
    let onScreen = true;
    const apply = () => {
      f.setRunning(onScreen && document.visibilityState === "visible");
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
    // A change of theme redraws it in the theme's inks.
    const recolour = () => {
      f.setColours(inks(element));
    };
    const themes = new MutationObserver(recolour);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    scheme?.addEventListener("change", recolour);
    window.addEventListener("idtrack:recolour", recolour);
    return () => {
      window.removeEventListener("idtrack:recolour", recolour);
      scheme?.removeEventListener("change", recolour);
      themes.disconnect();
      document.removeEventListener("visibilitychange", apply);
      seen?.disconnect();
      resize?.disconnect();
      f.destroy();
      f.element.remove();
      field.current = null;
    };
  }, [layout]);

  // The frame follows the box and the view.
  useEffect(() => {
    if (size && frame) field.current?.resize(size.width, size.height, frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame is a function of the size and the view
  }, [size, view]);

  // The family lifted is the one picked (by the pointer or the keyboard).
  useEffect(() => {
    if (!frame || !picked) {
      field.current?.setPointer(null, -1);
      return;
    }
    const y = layout.y[picked.id * n + picked.k];
    const point = placeOf(frame, n > 1 ? picked.k / (n - 1) : 0.5, Number.isNaN(y) || y === undefined ? 0 : y);
    field.current?.setPointer(point, picked.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame is a function of the size and the view
  }, [picked, size, view, layout, n]);

  const pick = (x: number, y: number): Picked | null => {
    if (!frame) return null;
    const at = fieldAt(frame, x, y);
    if (at.x < 0 || at.x > 1 || Math.abs(at.y) > 0.5) return null;
    const found = idAt(layout, at.x, at.y);
    return found < 0 ? null : { id: found, k: Math.round(at.x * (n - 1)) };
  };
  const local = (event: PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  };
  const open = (p: Picked) => {
    const identifier = layout.ids[p.id];
    if (!identifier) return;
    navigate(convertHref(organism, { ...plainConversion(identifier), fromRelease: releaseFor(layout, p.id, p.k) }));
  };
  const zoom = (factor: number, at?: number) => {
    setView((v) => moveView(v, { factor, at }));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, view, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && size) {
      const dx = event.clientX - d.x;
      if (Math.abs(dx) > 4) d.moved = true;
      if (d.moved) {
        const span = d.view[1] - d.view[0];
        setView(moveView(d.view, { delta: (-dx / Math.max(1, size.width - 32)) * span }));
        return;
      }
    }
    if (event.pointerType === "touch") return;
    const p = local(event);
    setPicked(pick(p.x, p.y));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = local(event);
    const hit = pick(p.x, p.y);
    if (!hit) return;
    // A touch picks first and opens on a second press of the same line; a mouse opens at once.
    if (event.pointerType === "touch" && picked?.id !== hit.id) setPicked(hit);
    else open(hit);
  };

  // The keyboard: the arrow keys move between lines and along releases, + and − zoom, Enter opens.
  const column = (k: number) => layout.columns[k] ?? new Int32Array();
  const firstPick = (): Picked | null => {
    const k = Math.round(((view[0] + view[1]) / 2) * (n - 1));
    const c = column(k);
    const middle = c[Math.floor(c.length / 2)];
    return middle === undefined ? null : { id: middle, k };
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = picked ?? firstPick();
    if (!current) return;
    const active = (id: number, k: number) => !Number.isNaN(layout.y[id * n + k] ?? NaN);
    const runs = runsOf(layout, current.id);
    let next: Picked | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        const step = event.key === "ArrowRight" ? 1 : -1;
        for (let k = current.k + step; k >= 0 && k < n; k += step)
          if (active(current.id, k)) {
            next = { id: current.id, k };
            break;
          }
        break;
      }
      case "ArrowUp":
      case "ArrowDown": {
        const c = column(current.k);
        const at = c.indexOf(current.id);
        const j = at < 0 ? Math.floor(c.length / 2) : at + (event.key === "ArrowDown" ? 1 : -1);
        const other = c[Math.max(0, Math.min(c.length - 1, j))];
        if (other !== undefined) next = { id: other, k: current.k };
        break;
      }
      case "Home":
      case "End": {
        const release = event.key === "Home" ? runs[0]?.[0] : runs[runs.length - 1]?.[1];
        const k = release === undefined ? -1 : layout.releases.indexOf(release);
        if (k >= 0) next = { id: current.id, k };
        break;
      }
      case "+":
      case "=":
        zoom(0.5, n > 1 ? current.k / (n - 1) : 0.5);
        event.preventDefault();
        return;
      case "-":
      case "_":
        zoom(2, n > 1 ? current.k / (n - 1) : 0.5);
        event.preventDefault();
        return;
      case "Enter":
      case " ":
        open(current);
        event.preventDefault();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!next) return;
    setPicked(next);
    // The view follows the line out of it.
    const x = n > 1 ? next.k / (n - 1) : 0.5;
    if (x < view[0] || x > view[1]) setView((v) => moveView(v, { delta: x < v[0] ? x - v[0] : x - v[1] }));
  };

  const pickedId = picked ? (layout.ids[picked.id] ?? "") : "";
  const pickedRelease = picked ? (layout.releases[picked.k] ?? 0) : 0;
  // The picked line, drawn over the canvas for the keyboard's focus (its path over the releases it is active at).
  const overlay =
    picked && frame
      ? (() => {
          const parts: string[] = [];
          let open = false;
          for (let k = 0; k < n; k++) {
            const y = layout.y[picked.id * n + k];
            if (y === undefined || Number.isNaN(y)) {
              open = false;
              continue;
            }
            const p = placeOf(frame, n > 1 ? k / (n - 1) : 0.5, y);
            parts.push(`${open ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
            open = true;
          }
          const y = layout.y[picked.id * n + picked.k] ?? 0;
          return { d: parts.join(""), at: placeOf(frame, n > 1 ? picked.k / (n - 1) : 0.5, Number.isNaN(y) ? 0 : y) };
        })()
      : null;
  const xOf = (release: number) =>
    frame ? placeOf(frame, n > 1 ? layout.releases.indexOf(release) / (n - 1) : 0.5, 0).x : 0;
  const shownFrom = layout.releases[Math.round(view[0] * (n - 1))] ?? 0;
  const shownTo = layout.releases[Math.round(view[1] * (n - 1))] ?? 0;
  const whole = view[0] <= 0 && view[1] >= 1;
  const last = description.releases[description.releases.length - 1];
  return (
    <figure className="lineage-field" aria-labelledby={`${id}-caption`}>
      <div className="lineage-field__tools">
        <p className="lineage-field__view">
          Releases <Mono>{shownFrom}</Mono>–<Mono>{shownTo}</Mono>
          {whole ? null : <span className="muted"> of {`${layout.releases[0] ?? ""}–${last ?? ""}`}</span>}
        </p>
        <div className="lineage-field__zoom" role="group" aria-label="Zoom along the releases">
          <Button
            variant="quiet"
            onClick={() => {
              zoom(0.5);
            }}
            disabled={view[1] - view[0] <= LEAST_SPAN + 1e-9}
            aria-label="Zoom in"
          >
            +
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              zoom(2);
            }}
            disabled={whole}
            aria-label="Zoom out"
          >
            −
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setView([0, 1]);
            }}
            disabled={whole}
          >
            All releases
          </Button>
        </div>
      </div>
      <div
        className={`lineage-field__box${drag.current?.moved ? " is-dragging" : ""}`}
        ref={box}
        data-mode={mode ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch" && !focused) setPicked(null);
        }}
      >
        {frame ? (
          <div className="lineage-field__axis" aria-hidden="true">
            {bands.map((band, i) => {
              const x = xOf(band.first);
              if (x < -40 || (size && x > size.width)) return null;
              return (
                <span
                  key={band.assembly}
                  className={`lineage-field__tick${i === 0 ? " lineage-field__tick--first" : ""}`}
                  style={{ left: x }}
                >
                  <span className="mono">{band.first}</span> {band.name}
                </span>
              );
            })}
            {last !== undefined && size && xOf(last) <= size.width + 1 ? (
              <span className="lineage-field__tick lineage-field__tick--last" style={{ left: xOf(last) }}>
                <span className="mono">{last}</span>
              </span>
            ) : null}
          </div>
        ) : null}
        {frame
          ? bands
              .slice(1)
              .map((band) => (
                <span
                  key={band.assembly}
                  className="lineage-field__change"
                  aria-hidden="true"
                  style={{ left: xOf(band.first), top: frame.centre - frame.half, height: 2 * frame.half }}
                />
              ))
          : null}
        <svg
          className="lineage-field__focus"
          role="application"
          aria-roledescription="lineage field"
          aria-label={`The lineages of ${groupedInteger(layout.shown)} gene ids of the ${organismName(organism)} graph. Arrow keys move along a line and between lines; plus and minus zoom; Enter opens the id in Convert.`}
          aria-describedby={`${id}-readout`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (!picked) setPicked(firstPick());
          }}
          onBlur={() => {
            setFocused(false);
          }}
        >
          {overlay ? (
            <>
              <path d={overlay.d} className="lineage-field__line" />
              <circle cx={overlay.at.x} cy={overlay.at.y} r={5} className="lineage-field__at" />
            </>
          ) : null}
        </svg>
      </div>
      <p className="lineage-field__readout" id={`${id}-readout`} aria-live="polite">
        {picked ? (
          <>
            <Mono strong>{pickedId}</Mono> <span className="lineage-field__words">{lineWords(layout, picked.id)}</span>{" "}
            <Link
              to={convertHref(organism, {
                ...plainConversion(pickedId),
                fromRelease: releaseFor(layout, picked.id, picked.k),
              })}
              className="lineage-field__open"
            >
              Convert it from release {releaseFor(layout, picked.id, picked.k)}
            </Link>
            <span className="visually-hidden">; at release {pickedRelease}</span>
          </>
        ) : (
          <span className="muted">
            Point at a line, or focus the field and use the arrow keys; a press opens its id in Convert. Drag or use the
            buttons to move along the releases.
          </span>
        )}
      </p>
      <figcaption id={`${id}-caption`} className="fig-caption">
        <CaptionMore
          lead={
            <>
              <Mono>{groupedInteger(layout.shown)}</Mono> of the <Mono>{groupedInteger(layout.genes)}</Mono> gene ids of
              the <em>{organismName(organism)}</em> graph, each a line over the releases at which a version of it is
              active.
            </>
          }
        >
          Whole families of ids joined by Ensembl&apos;s edges, those of the showcase&apos;s journeys first, then others
          in a fixed order: a dot at each of the <Mono>{groupedInteger(layout.counts.versions)}</Mono> new versions, a
          curve for each of the <Mono>{groupedInteger(layout.counts.edges)}</Mono> history edges to another id (
          <Mono>{groupedInteger(layout.counts.fans)}</Mono> where Ensembl&apos;s mapping fans out or in). These are
          Ensembl&apos;s edges, not IDTrack&apos;s reading of a path. Source:{" "}
          <Mono>GET /api/v1/organisms/{organism}/lineages</Mono>.
        </CaptionMore>
      </figcaption>
    </figure>
  );
}
