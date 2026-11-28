// The server's load, shown quietly in the masthead (built on `GET /api/v1/status`): a state dot, its shape and colour
// the state; from 1280 px the two readings at rest beside it in the quiet ink (CPU against the workers' capacity, and
// the server's memory), with no box, line or motion; from 641 px the state's word whenever it is not ok. Pointing or
// focus unfolds the readings with a line of this session's samples (up to the last ten minutes) where they are not at
// rest. Nothing moves but the numbers, which change in place. Pressing it opens the panel "Server load" (loaded on
// first open, fetched beforehand once the page is idle). A reading that is not current (the request of /status is
// late, refused or unreadable) is drawn faint and says since when it is old.
import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { whenIdle } from "../lib/idle";
import { lazyPart } from "../lib/lazyPart";
import {
  capacityShare,
  clock,
  gib,
  monitorState,
  percent,
  runs,
  seriesPath,
  seriesScale,
  sparkSpan,
  STATE_WORDS,
  type LoadState,
  type Sample,
} from "../lib/load";
import { loadStore, useLoad } from "../lib/loadStore";
import { useLocation } from "../lib/router";
import { ErrorBoundary } from "./ErrorBoundary";
import "../styles/load.css";

const LoadPanel = lazyPart(() => import("./LoadPanel"));

/** The masthead's lines span the session's samples, at most the last ten minutes. */
const SPARK_MOST_MS = 10 * 60 * 1000;
const SPARK_W = 40;
const SPARK_H = 12;
/** The line and its end dot are drawn this far inside the band, so that a value of 0 or of the top stays inside it. */
const SPARK_INSET = 2;

/** States whose values are the last answer's, not current. */
const STALE = new Set<LoadState>(["late", "refused", "unreadable"]);

function Spark({
  samples,
  value,
  top,
  now,
  span,
}: {
  samples: Sample[];
  value: (s: Sample) => number | null;
  top: number;
  now: number;
  span: number;
}) {
  const series = runs(samples, value);
  const from = now - span;
  const box = { from, to: now, top, width: SPARK_W, height: SPARK_H, inset: SPARK_INSET };
  const path = seriesPath(series, box);
  const { x, y } = seriesScale(box);
  const lastRun = series[series.length - 1];
  const last = lastRun?.[lastRun.length - 1];
  const end = last && last.at >= from ? { x: x(last.at), y: y(last.v) } : null;
  // A line of the samples and a dot at the latest, over a faint band of the axis's range: data, never a blank rule.
  return (
    <svg
      className="load-spark"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="load-spark__band" x="0" y="0" width={SPARK_W} height={SPARK_H} rx="1.5" />
      {path ? <path className="load-spark__line" d={path} /> : null}
      {end ? <circle className="load-spark__end" cx={end.x} cy={end.y} r="1.6" /> : null}
    </svg>
  );
}

/** The browser's clock, ticking every second while `active` (the age of a late reading is counted in place). */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      setNow(Date.now());
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

export function LoadMonitor() {
  const snapshot = useLoad();
  // The panel is open on the page where it was asked for: going to another page closes it, so a panel whose code
  // arrives late (it could not be fetched offline) never opens by itself over a page the person moved on to.
  const { path } = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenOn(next ? path : null);
    },
    [path],
  );
  const [opened, setOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { latest, failure, samples, late } = snapshot;
  const state = monitorState(latest, failure?.kind ?? null, late !== null);
  const status = latest?.status ?? null;
  const ticking = useClock(state === "late");
  const lateSeconds = late ? Math.max(0, Math.round((ticking - late.since) / 1000)) : 0;

  useEffect(() => {
    loadStore.setOpen(open);
  }, [open]);
  // The panel's code comes once the page is idle, so that the first press opens it at once.
  useEffect(() => {
    return whenIdle(() => {
      void LoadPanel.preload();
    });
  }, []);

  const close = useCallback(() => {
    setOpenOn(null);
    trigger.current?.focus();
  }, []);

  // While the panel is asked for but not shown (its code is on its way, or could not be fetched and its statement
  // stands under the reading), Escape and a press outside dismiss the statement and the wish to open it; the shown
  // panel, a modal dialog, handles both itself.
  useEffect(() => {
    if (!open) return;
    const shown = () => Boolean(root.current?.querySelector("dialog[open]"));
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !shown()) setOpenOn(null);
    };
    const onPointer = (event: globalThis.PointerEvent) => {
      if (!shown() && root.current && !root.current.contains(event.target as Node)) setOpenOn(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const cpu = status ? capacityShare(status) : null;
  const pss = status?.memory.pss_bytes ?? null;
  const limit = status?.memory.limit_bytes ?? null;
  const now = latest?.receivedAt ?? failure?.at ?? 0;
  const firstAt = samples.find((s) => !s.failed)?.at ?? null;
  const span = sparkSpan(firstAt, now, SPARK_MOST_MS);
  // Each line is drawn against the largest value of its span (CPU: at least a tenth of the cores), so a change is
  // seen; the panel's charts carry the axes.
  const recent = samples.filter((s) => s.at >= now - span && !s.failed);
  const pssTop = Math.max(1, ...recent.map((s) => s.pssBytes ?? 0)) * 1.15;
  const cpuTop = Math.max(0.1, ...recent.map((s) => s.capacityShare ?? 0)) * 1.15;

  const cpuText = cpu === null ? "–" : percent(cpu).text;
  const pssText = pss === null ? "–" : gib(pss).text;
  const stale = STALE.has(state);
  const hasReading = latest !== null && state !== "unreachable";
  const word =
    state === "late" ? `late ${lateSeconds} s` : state === "waiting" ? "reading" : STATE_WORDS[state].toLowerCase();
  // The button's name: the state and both readings at every width (the visible text, whatever of it a width shows,
  // is part of it), and how old a reading that is not current is.
  const readings = `CPU ${cpuText} of the workers' capacity, memory ${pssText}${limit !== null && pss !== null ? ` of ${gib(limit).text}` : ""}`;
  const name =
    state === "unreachable" || state === "waiting" || !latest
      ? `Server load: ${word}.`
      : stale
        ? `Server load: ${state === "late" ? `late, no answer from /status for ${lateSeconds} s` : word}; the last reading, at ${clock(latest.receivedAt)}: ${readings}.`
        : `Server load: ${word}. ${readings}.`;
  const title =
    state === "unreachable" || state === "unreadable" || state === "refused"
      ? `Server load: ${failure?.message ?? word}`
      : state === "late"
        ? `Server load: /status has not answered for ${lateSeconds} s; the values are the last answer, received at ${latest ? clock(latest.receivedAt) : ""}.`
        : "Server load, as measured by the server (GET /api/v1/status). Open for every process and how it is measured.";

  return (
    <div className="load-monitor" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`load-monitor__trigger load-monitor__trigger--${state}${stale ? " load-monitor__trigger--stale" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={opened ? panelId : undefined}
        title={title}
        onClick={() => {
          setOpened(true);
          setOpen(!open);
        }}
      >
        <span className="visually-hidden">{name}</span>
        {/* At rest: the state's word where it is not ok (from 641 px), the readings (from 1280 px), then the dot. */}
        <span className="load-monitor__rest" aria-hidden="true">
          {state !== "ok" ? <span className="load-monitor__word">{word}</span> : null}
          {hasReading ? (
            <span className="load-monitor__readings">
              <span className="load-monitor__label">CPU</span>
              <span className="load-monitor__value load-monitor__value--cpu">{cpuText}</span>
              <span className="load-monitor__label">Memory</span>
              <span className="load-monitor__value load-monitor__value--mem">{pssText}</span>
            </span>
          ) : null}
        </span>
        <span className={`load-dot load-dot--${state}`} aria-hidden="true" />
        {/* On pointing or focus, where the readings are not at rest: over the masthead, so nothing beside it moves. */}
        <span className="load-monitor__shown" aria-hidden="true">
          {state !== "ok" ? <span className="load-monitor__word">{word}</span> : null}
          {hasReading ? (
            <>
              {/* On a phone, where the readings and lines do not fit, one compact block of both numbers. */}
              <span className="load-monitor__compact">
                <span className="load-monitor__label">CPU</span>
                <span className="load-monitor__value">{cpuText}</span>
                <span className="load-monitor__label">Memory</span>
                <span className="load-monitor__value">{pssText}</span>
              </span>
              <span className="load-monitor__reading">
                <span className="load-monitor__label">CPU</span>
                <span className="load-monitor__value load-monitor__value--cpu">{cpuText}</span>
                <Spark samples={samples} value={(s) => s.capacityShare} top={cpuTop} now={now} span={span} />
              </span>
              <span className="load-monitor__reading">
                <span className="load-monitor__label">Memory</span>
                <span className="load-monitor__value load-monitor__value--mem">{pssText}</span>
                <Spark samples={samples} value={(s) => s.pssBytes} top={pssTop} now={now} span={span} />
              </span>
            </>
          ) : null}
        </span>
      </button>
      {opened ? (
        // The panel's own boundary: if its code cannot be fetched, the reading above stays and the statement stands
        // under it, over the page, without moving the masthead; while the panel is not asked for, nothing of it shows.
        <div className="load-monitor__slot" hidden={!open}>
          <ErrorBoundary part="The load panel" size="inline">
            <Suspense fallback={null}>
              <LoadPanel
                id={panelId}
                open={open}
                onClose={close}
                snapshot={snapshot}
                state={state}
                lateSeconds={lateSeconds}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}
