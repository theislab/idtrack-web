// The panel "Server load" (loaded on the monitor's first open): the server's CPU and memory against what it may use,
// every process, the requests and their latency, how each number is measured, and charts of this session's samples.
// A modal dialog: focus moves into it, Tab stays in it, Escape or a click outside closes it and focus returns to the
// monitor. A popover under the masthead on a wide screen, a sheet from the bottom on a phone.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { StatusResponse } from "../api/types";
import {
  clock,
  logTicks,
  coresSource,
  cores,
  duration,
  gib,
  memoryShare,
  memorySource,
  milliseconds,
  niceTop,
  placeOnLine,
  OPEN_INTERVAL_MS,
  CLOSED_INTERVAL_MS,
  percent,
  runs,
  sampleAges,
  seconds,
  seriesPath,
  STATE_RULE,
  STATE_SENTENCES,
  STATE_WORDS,
  type LoadState,
  type Reading,
  type Sample,
} from "../lib/load";
import type { LoadSnapshot } from "../lib/loadStore";
import { groupedInteger } from "../lib/numbers";
import { Exact } from "./Exact";
import { useWidth } from "./figure/useWidth";
import { Absent, Disclosure, Mono, TableFrame } from "./ui";

const CHART_H = 104;
const PAD = { left: 44, right: 8, top: 10, bottom: 20 };

interface ChartProps {
  label: string;
  samples: Sample[];
  value: (s: Sample) => number | null;
  /** The value axis's top (a round number). */
  top: number;
  /** A value as text for an axis tick. */
  tick: (v: number) => string;
  /** A sample's value in words, for the cursor's readout. */
  read: (s: Sample) => string;
  /** A level drawn as a dashed line where it lies on the axis (the cores available, the memory limit). */
  reference: { value: number; label: string } | null;
}

/** A line of this session's samples, with a cursor that the pointer or the arrow keys move along them. */
function LoadChart({ label, samples, value, top, tick, read, reference }: ChartProps) {
  const { ref: frame, width } = useWidth<HTMLDivElement>(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const known = samples.filter((s) => !s.failed && value(s) !== null);
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = CHART_H - PAD.top - PAD.bottom;
  const first = samples[0]?.at ?? 0;
  const last = samples[samples.length - 1]?.at ?? 0;
  // A session shorter than a minute is drawn over a minute, so its first samples do not fill the width.
  const from = Math.min(first, last - 60_000);
  const series = runs(samples, value);
  const box = { from, to: last, top, width: w, height: h };
  const line = seriesPath(series, box);
  const area = series
    .map((run) => {
      const d = seriesPath([run], box);
      const x = (at: number) => (((at - from) / Math.max(1, last - from)) * w).toFixed(2);
      const a = run[0];
      const b = run[run.length - 1];
      return d && a && b ? `${d}L${x(b.at)},${h}L${x(a.at)},${h}Z` : "";
    })
    .join("");
  const xOf = (at: number) => ((at - from) / Math.max(1, last - from)) * w;
  const yOf = (v: number) => h - Math.min(1, Math.max(0, v / top)) * h;
  const point = cursor !== null ? known[cursor] : undefined;
  const latest = known[known.length - 1];
  const move = (index: number) => {
    setCursor(Math.max(0, Math.min(known.length - 1, index)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!known.length) return;
    const at = cursor ?? known.length - 1;
    // The ARIA slider's keys: a step with the arrows (left/down earlier, right/up later), ten with Page Up/Down.
    const keys: Record<string, number> = {
      ArrowLeft: at - 1,
      ArrowDown: at - 1,
      ArrowRight: at + 1,
      ArrowUp: at + 1,
      PageDown: at - 10,
      PageUp: at + 10,
      Home: 0,
      End: known.length - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    move(next);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!known.length || !w) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = from + ((event.clientX - box.left - PAD.left) / w) * (last - from);
    let best = 0;
    for (let i = 1; i < known.length; i++) {
      if (Math.abs((known[i]?.at ?? 0) - at) < Math.abs((known[best]?.at ?? 0) - at)) best = i;
    }
    setCursor(best);
  };
  const ticks = [0, top / 2, top];
  const refY = reference && reference.value <= top ? yOf(reference.value) : null;
  return (
    <div className="load-chart">
      <div
        className="load-chart__frame"
        ref={frame}
        role="slider"
        aria-label={`${label}: the samples of this session (arrow keys)`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, known.length - 1)}
        aria-valuenow={cursor ?? Math.max(0, known.length - 1)}
        aria-valuetext={(() => {
          const s = point ?? latest;
          return s ? `${clock(s.at)}: ${read(s)}` : "no sample yet";
        })()}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          setCursor(null);
        }}
        onBlur={() => {
          setCursor(null);
        }}
      >
        {width > 0 ? (
          <svg width={width} height={CHART_H} aria-hidden="true" focusable="false" className="load-chart__svg">
            <g transform={`translate(${PAD.left},${PAD.top})`}>
              {ticks.map((t) => (
                <g key={t} transform={`translate(0,${yOf(t).toFixed(2)})`}>
                  <line className="load-chart__grid" x1="0" x2={w} />
                  <text className="load-chart__tick" x="-8" dy="0.32em" textAnchor="end">
                    {tick(t)}
                  </text>
                </g>
              ))}
              {refY !== null && reference ? (
                <g>
                  <line className="load-chart__reference" x1="0" x2={w} y1={refY} y2={refY} />
                  <text className="load-chart__tick" x={w} y={refY - 4} textAnchor="end">
                    {reference.label}
                  </text>
                </g>
              ) : null}
              {area ? <path className="load-chart__area" d={area} /> : null}
              {line ? <path className="load-chart__line" d={line} /> : null}
              {latest && cursor === null ? (
                <circle className="load-chart__dot" cx={xOf(latest.at)} cy={yOf(value(latest) ?? 0)} r="2.5" />
              ) : null}
              {point ? (
                <g>
                  <line className="load-chart__cursor" x1={xOf(point.at)} x2={xOf(point.at)} y1="0" y2={h} />
                  <circle className="load-chart__dot" cx={xOf(point.at)} cy={yOf(value(point) ?? 0)} r="3" />
                </g>
              ) : null}
              <text className="load-chart__tick" x="0" y={h + 15}>
                {samples.length ? clock(from) : ""}
              </text>
              <text className="load-chart__tick" x={w} y={h + 15} textAnchor="end">
                {samples.length ? clock(last) : ""}
              </text>
            </g>
          </svg>
        ) : (
          <div style={{ height: CHART_H }} />
        )}
      </div>
      {/* Not a live region: the slider's value text tells the cursor's sample when it moves; a poll says nothing. */}
      <p className="load-chart__readout">
        {point ? (
          <>
            <Mono>{clock(point.at)}</Mono> {read(point)}
          </>
        ) : latest ? (
          <>
            Latest, <Mono>{clock(latest.at)}</Mono>: {read(latest)}
          </>
        ) : (
          "No sample yet."
        )}
      </p>
    </div>
  );
}

function Value({ reading, strong }: { reading: Reading; strong?: boolean }) {
  return <Exact reading={reading} className={strong ? "exact--strong" : ""} />;
}

function Missing({ field }: { field: string }) {
  return (
    <span className="load-missing" title={`Not measured on this server (${field} is listed in unavailable).`}>
      not measured
    </span>
  );
}

function Stat({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="load-stat">
      <dt className="load-stat__label">{label}</dt>
      <dd className="load-stat__value">{children}</dd>
      {note ? <dd className="load-stat__note">{note}</dd> : null}
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <Mono>{groupedInteger(value)}</Mono>;
}

function bytesOrMissing(value: number | null, field: string) {
  return value === null ? <Missing field={field} /> : <Value reading={gib(value)} />;
}

/** A number in running text kept on one line (its groups joined by no-break spaces). */
const unbroken = (text: string) => text.replace(/ /g, "\u00a0");

/** Why the master's request cells hold no number. */
const MASTER_SERVES_NONE = "The master answers no request: it loaded the graphs and forked the workers.";

function Processes({ status }: { status: StatusResponse }) {
  const total = status.workers.reduce((sum, w) => sum + w.requests, 0);
  const rows = [
    ...(status.master ? [{ role: "master", process: status.master, worker: null }] : []),
    ...status.workers.map((w) => ({ role: `worker ${w.worker}`, process: w, worker: w })),
  ];
  return (
    <TableFrame label="Processes" className="load-processes">
      <table className="table table--compact table--cards load-table">
        <thead>
          <tr>
            <th scope="col">Process</th>
            <th scope="col" className="num">
              CPU
            </th>
            <th scope="col" className="num">
              PSS
            </th>
            <th scope="col" className="num">
              RSS
            </th>
            <th scope="col">Requests</th>
            <th scope="col" className="num">
              In flight
            </th>
            <th scope="col" className="num">
              Searching
            </th>
            <th scope="col" className="num">
              Waiting
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ role, process, worker }) => {
            const share = worker && total > 0 ? worker.requests / total : null;
            return (
              <tr key={role}>
                <th scope="row" className="load-table__process">
                  {role}
                </th>
                <td data-label="CPU" className="num">
                  {process.cpu_share === null ? (
                    <span className="load-missing">not yet</span>
                  ) : (
                    <Value reading={cores(process.cpu_share)} />
                  )}
                </td>
                <td data-label="PSS" className="num">
                  {bytesOrMissing(process.pss_bytes, "pss_bytes")}
                </td>
                <td data-label="RSS" className="num">
                  {bytesOrMissing(process.rss_bytes, "rss_bytes")}
                </td>
                <td data-label="Requests" className="load-table__requests">
                  {worker ? (
                    <span className="load-balance">
                      <Mono>{groupedInteger(worker.requests)}</Mono>
                      <span className="load-balance__bar" aria-hidden="true">
                        <span style={{ width: `${((share ?? 0) * 100).toFixed(1)}%` }} />
                      </span>
                      <span className="load-balance__share">
                        {share === null ? "" : `${(share * 100).toFixed(0)} %`}
                      </span>
                    </span>
                  ) : (
                    <Absent meaning={MASTER_SERVES_NONE} />
                  )}
                </td>
                <td data-label="In flight" className="num">
                  {worker ? <Count value={worker.in_flight} /> : <Absent meaning={MASTER_SERVES_NONE} />}
                </td>
                <td data-label="Searching" className="num">
                  {worker ? <Count value={worker.searches_running} /> : <Absent meaning={MASTER_SERVES_NONE} />}
                </td>
                <td data-label="Waiting" className="num">
                  {worker ? <Count value={worker.searches_waiting} /> : <Absent meaning={MASTER_SERVES_NONE} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}

/** The latency's percentiles on one logarithmic strip (milliseconds); equal values share one mark. Every tick of 1, 2
 *  and 5 times a power of ten is drawn; a tick is labelled where its label touches no other (the powers of ten
 *  first), and the marks' names stand on up to three rows so that none touches another. */
function LatencyStrip({ status }: { status: StatusResponse }) {
  const { ref, width } = useWidth<HTMLDivElement>(0);
  const l = status.requests.latency;
  const all: [string, number | null][] = [
    ["p50", l.p50_ms],
    ["p95", l.p95_ms],
    ["p99", l.p99_ms],
    ["max", l.max_ms],
  ];
  const values = all.filter((m): m is [string, number] => typeof m[1] === "number");
  const marks: { names: string[]; v: number }[] = [];
  for (const [name, v] of values) {
    const same = marks.find((m) => m.v === v);
    if (same) same.names.push(name);
    else marks.push({ names: [name], v });
  }
  if (!marks.length) return null;
  const lo = Math.max(0.1, Math.min(...marks.map((m) => m.v)) / 1.6);
  const hi = Math.max(...marks.map((m) => m.v)) * 1.6;
  const x = (v: number) => ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * width;
  const ticks = logTicks(lo, hi);
  const tickText = (d: number) => (d >= 1000 ? `${d / 1000}\u00a0s` : `${d}\u00a0ms`);
  // The powers of ten are labelled first, then 2 and 5 times them where there is room.
  const decade = (d: number) => Math.abs(Math.log10(d) - Math.round(Math.log10(d))) < 1e-9;
  const order = [...ticks].sort((a, b) => Number(decade(b)) - Number(decade(a)));
  const placedTicks = new Map(
    placeOnLine(
      order.map((d) => ({ x: x(d), text: tickText(d) })),
      width,
    ).map((p, i) => [order[i], p] as const),
  );
  const names = placeOnLine(
    marks.map((m) => ({ x: x(m.v), text: m.names.join(" = ") })),
    width,
    3,
  );
  return (
    <div className="latency-strip" aria-hidden="true" ref={ref}>
      {width > 0 ? (
        <div className="latency-strip__axis">
          {ticks.map((d) => {
            const label = placedTicks.get(d);
            return (
              <span
                key={d}
                className={`latency-strip__tick${decade(d) ? " latency-strip__tick--decade" : ""}`}
                style={{ left: `${x(d).toFixed(1)}px` }}
              >
                {label ? (
                  <span className="latency-strip__decade" style={{ left: `${(label.x - x(d)).toFixed(1)}px` }}>
                    {label.text}
                  </span>
                ) : null}
              </span>
            );
          })}
          {marks.map((m, i) => {
            const name = names[i];
            return (
              <span key={m.names.join()} className="latency-strip__mark" style={{ left: `${x(m.v).toFixed(1)}px` }}>
                {name ? (
                  <span
                    className={`latency-strip__name latency-strip__name--row${name.row}`}
                    style={{ left: `${(name.x - x(m.v)).toFixed(1)}px` }}
                  >
                    {name.text}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function LoadPanel({
  id,
  open,
  onClose,
  snapshot,
  state,
  lateSeconds,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  snapshot: LoadSnapshot;
  state: LoadState;
  /** How long the request of /status on its way has waited, while the reading is late. */
  lateSeconds: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // Focus starts on the dialog's title (a reader hears what opened), not on the link above it.
      title.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A click on the backdrop lands on the dialog itself (its content fills the box): it closes the panel.
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onClose();
    };
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("click", onClick);
    };
  }, [onClose]);

  const { latest, failure, samples, late } = snapshot;
  const status = latest?.status ?? null;
  const unavailable = new Set(status?.unavailable ?? []);
  const ages = status ? sampleAges(status) : null;
  const memShare = status ? memoryShare(status) : null;
  const cpuTop = niceTop(Math.max(0.05, ...samples.map((s) => s.coresUsed ?? 0)) * 1.2);
  const pssMax = Math.max(0, ...samples.map((s) => s.pssBytes ?? 0));
  const memTop = niceTop(Math.max(1, (pssMax / 2 ** 30) * 1.25)) * 2 ** 30;

  return (
    <dialog
      ref={dialog}
      id={id}
      className="load-panel"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="load-panel__body">
        <div className="load-panel__head">
          <div>
            <p className="eyebrow">
              <a href="/api/v1/status" className="eyebrow__code">
                GET /api/v1/status
              </a>
            </p>
            <h2 id={titleId} className="load-panel__title" ref={title} tabIndex={-1}>
              Server load
            </h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="load-panel__close"
            onClick={onClose}
            aria-label="Close the server load"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={`load-panel__state load-panel__state--${state}`}>
          <span className={`load-dot load-dot--${state}`} aria-hidden="true" />
          <div>
            <p>
              <strong>{STATE_WORDS[state]}.</strong> {STATE_SENTENCES[state]}
            </p>
            <p className="load-panel__rule">{STATE_RULE}</p>
          </div>
        </div>

        {failure ? (
          <div className="notice notice--danger load-panel__failure" role="status">
            <p className="notice__title">
              {failure.kind === "refused"
                ? "/status refused the request at"
                : failure.kind === "unreadable"
                  ? "/status answered with something this page cannot read at"
                  : "No answer from /status at"}{" "}
              {clock(failure.at)}
            </p>
            <p>{failure.message}</p>
            <p>
              {latest
                ? `The values below are the last answer, received at ${clock(latest.receivedAt)}; they are not current.`
                : "Nothing is shown in place of a measurement: no answer has come yet."}{" "}
              {failure.retryAt !== null
                ? `The page asks again after the wait the server named (Retry-After), at ${clock(failure.retryAt)}.`
                : "The page asks again in a few seconds."}
            </p>
          </div>
        ) : late && latest ? (
          <div className="notice load-panel__failure load-panel__late" role="status">
            <p className="notice__title">No answer from /status for {lateSeconds} s</p>
            <p>
              Asked at {clock(late.since)}; the request is still on its way, and a busy server answers it late too. The
              values below are the last answer, received at {clock(latest.receivedAt)}; they are not current. The charts
              have a gap until an answer comes.
            </p>
          </div>
        ) : null}

        {status ? (
          <div
            className={`load-panel__data${state === "late" || state === "refused" || state === "unreadable" ? " load-panel__data--stale" : ""}`}
          >
            <section className="load-section" aria-labelledby={`${titleId}-cpu`}>
              <h3 id={`${titleId}-cpu`} className="load-section__title">
                <span className="panel-letter">a</span> CPU
              </h3>
              <dl className="load-stats">
                <Stat
                  label="Cores used"
                  note={`of ${groupedInteger(status.cpu.cores_available)} available: ${coresSource(status)}`}
                >
                  {status.cpu.cores_used === null ? (
                    <Missing field="cpu.cores_used" />
                  ) : (
                    <Value reading={cores(status.cpu.cores_used)} strong />
                  )}
                </Stat>
                <Stat label="Share of the cores available">
                  {status.cpu.share_of_available === null ? (
                    <Missing field="cpu.share_of_available" />
                  ) : (
                    <Value reading={percent(status.cpu.share_of_available)} strong />
                  )}
                </Stat>
              </dl>
              <LoadChart
                label="Cores used over this session"
                samples={samples}
                value={(s) => s.coresUsed}
                top={cpuTop}
                tick={(v) => `${Number(v.toFixed(3))}`}
                read={(s) =>
                  s.coresUsed === null
                    ? "not measured"
                    : `${cores(s.coresUsed).text} cores${s.cpuShare === null ? "" : `, ${percent(s.cpuShare).text} of those available`}`
                }
                reference={{
                  value: status.cpu.cores_available,
                  label: `${groupedInteger(status.cpu.cores_available)} available`,
                }}
              />
              <p className="load-caption">
                Cores kept busy by the server&apos;s processes (master and workers summed; 1 is one core), each point an
                answer of /status taken by this page: every {OPEN_INTERVAL_MS / 1000}&nbsp;s while this panel is open,
                every {CLOSED_INTERVAL_MS / 1000}&nbsp;s while it is closed, none while the tab is hidden (a gap). The
                axis ends at {Number(cpuTop.toFixed(3))} cores
                {cpuTop < status.cpu.cores_available
                  ? `; the ${groupedInteger(status.cpu.cores_available)} available lie above it.`
                  : "."}
              </p>
            </section>

            <section className="load-section" aria-labelledby={`${titleId}-memory`}>
              <h3 id={`${titleId}-memory`} className="load-section__title">
                <span className="panel-letter">b</span> Memory
              </h3>
              <dl className="load-stats">
                <Stat
                  label="Footprint (PSS, summed)"
                  note={
                    status.memory.limit_bytes === null ? (
                      "no limit could be read"
                    ) : (
                      <>
                        of a limit of <Value reading={gib(status.memory.limit_bytes)} />
                        {memShare === null ? null : (
                          <>
                            {" "}
                            (<Value reading={percent(memShare)} />)
                          </>
                        )}
                        : {memorySource(status)}
                      </>
                    )
                  }
                >
                  {status.memory.pss_bytes === null ? (
                    <Missing field="memory.pss_bytes" />
                  ) : (
                    <Value reading={gib(status.memory.pss_bytes)} strong />
                  )}
                </Stat>
                <Stat label="RSS, summed" note="counts a shared page once in every process that maps it">
                  {bytesOrMissing(status.memory.rss_bytes, "memory.rss_bytes")}
                </Stat>
                <Stat
                  label={status.memory.source === "cgroup" ? "The limit's cgroup holds" : "The machine uses"}
                  note={
                    status.memory.source === "cgroup"
                      ? "its memory.current: every process in it, page cache included (not used to judge the state)"
                      : "its total less its available memory (not used to judge the state)"
                  }
                >
                  {bytesOrMissing(status.memory.limit_used_bytes, "memory.limit_used_bytes")}
                </Stat>
              </dl>
              <p className="load-section__note">
                The state is judged on the server&apos;s own footprint against the limit; other processes in the
                limit&apos;s cgroup and reclaimable page cache are shown beside it, not counted in it. PSS is the honest
                sum: each resident page is divided by the number of processes that share it, so the graphs, loaded once
                by the master before it forks the workers, are counted once in all; RSS counts them again in every
                process.
              </p>
              <LoadChart
                label="Footprint (PSS) over this session"
                samples={samples}
                value={(s) => s.pssBytes}
                top={memTop}
                tick={(v) => `${Number((v / 2 ** 30).toFixed(2))} GiB`}
                read={(s) => (s.pssBytes === null ? "not measured" : `${gib(s.pssBytes).text} PSS`)}
                reference={
                  status.memory.limit_bytes === null
                    ? null
                    : { value: status.memory.limit_bytes, label: `limit ${gib(status.memory.limit_bytes).text}` }
                }
              />
              <p className="load-caption">
                The server&apos;s footprint, PSS summed over its processes (1 GiB = 2<sup>30</sup> bytes), sampled as in
                a. The server reads each process&apos;s memory every {status.memory_sample_interval_seconds}&nbsp;s
                {status.memory.limit_bytes !== null && status.memory.limit_bytes > memTop
                  ? `; the limit, ${gib(status.memory.limit_bytes).text}, lies above the axis.`
                  : "."}
              </p>
            </section>

            <section className="load-section" aria-labelledby={`${titleId}-processes`}>
              <h3 id={`${titleId}-processes`} className="load-section__title">
                <span className="panel-letter">c</span> Processes
                <span className="load-section__aside">
                  {status.workers_alive} of {status.workers_configured} workers alive
                  {status.workers_exited > 0 && status.last_worker_exit_at !== null ? (
                    <>
                      ; {groupedInteger(status.workers_exited)} ended and replaced since the start, the last at{" "}
                      <Mono>{clock(Date.parse(status.last_worker_exit_at))}</Mono>
                    </>
                  ) : null}
                </span>
              </h3>
              <Processes status={status} />
              <p className="load-caption">
                CPU in cores (1 is one core kept busy) over the last interval of {status.sample_interval_seconds}
                &nbsp;s; requests answered since each worker began, with its share of all the workers&apos; requests
                (the balance between them); in flight: held now; searching: its search thread busy (one at a time);
                waiting: requests queued for that thread.
              </p>
            </section>

            <section className="load-section" aria-labelledby={`${titleId}-requests`}>
              <h3 id={`${titleId}-requests`} className="load-section__title">
                <span className="panel-letter">d</span> Requests
              </h3>
              <dl className="load-stats load-stats--four">
                <Stat label="Last 60 s">
                  <Count value={status.requests.last_60_seconds} />
                </Stat>
                <Stat label="Since start">
                  <Count value={status.requests.total} />
                </Stat>
                <Stat label="Answered 4xx">
                  <Count value={status.requests.errors_4xx} />
                </Stat>
                <Stat label="Answered 5xx">
                  <Count value={status.requests.errors_5xx} />
                </Stat>
              </dl>
              <dl className="load-stats load-stats--four">
                <Stat label="In flight now">
                  <Count value={status.requests.in_flight} />
                </Stat>
                <Stat label="Searches running">
                  <Count value={status.requests.searches_running} />
                </Stat>
                <Stat label="Searches waiting" note="for a worker's search thread">
                  <Count value={status.requests.searches_waiting} />
                </Stat>
                <Stat label="Connections waiting" note="in the listen queue, for a free worker (the kernel's count)">
                  {status.requests.connections_waiting === null ? (
                    <span className="load-missing">not read</span>
                  ) : (
                    <Count value={status.requests.connections_waiting} />
                  )}
                </Stat>
              </dl>
              <h4 className="load-subtitle">Latency</h4>
              <dl className="load-stats load-stats--four">
                {(
                  [
                    ["p50", status.requests.latency.p50_ms],
                    ["p95", status.requests.latency.p95_ms],
                    ["p99", status.requests.latency.p99_ms],
                    ["max", status.requests.latency.max_ms],
                  ] as const
                ).map(([name, v]) => (
                  <Stat key={name} label={name}>
                    {v === null ? (
                      <span className="load-missing">no request</span>
                    ) : (
                      <Value reading={milliseconds(v)} />
                    )}
                  </Stat>
                ))}
              </dl>
              <LatencyStrip status={status} />
              <p className="load-caption">
                From arrival to the last byte sent, nearest rank, over the{" "}
                {unbroken(groupedInteger(status.requests.latency.count))} most recent requests (at most{" "}
                {unbroken(groupedInteger(status.requests.latency.most_recent))}) that ended in the last{" "}
                {status.requests.latency.window_seconds}&nbsp;s; the strip is logarithmic. Requests to /status are
                counted apart ({unbroken(groupedInteger(status.requests.status_requests))} since the start), so watching
                the load does not change it.
              </p>
            </section>

            <dl className="load-facts">
              <Stat label="Up">
                <Value reading={duration(status.uptime_seconds)} />
              </Stat>
              <Stat label="Lost with a worker" note="held by a worker that was killed: no answer was sent">
                <Count value={status.requests.lost} />
              </Stat>
              <Stat label="Graphs held">
                <Mono>{status.graphs.length}</Mono>, files <Value reading={gib(status.graphs_file_bytes)} />
              </Stat>
              <Stat label="Answer received">
                <Mono>{latest ? clock(latest.receivedAt) : ""}</Mono>
              </Stat>
              <Stat label="Samples' age at the answer">
                CPU {ages?.cpu === null || !ages ? "—" : <Value reading={seconds(ages.cpu)} />}, memory{" "}
                {ages?.memory === null || !ages ? "—" : <Value reading={seconds(ages.memory)} />}
              </Stat>
            </dl>
            {unavailable.size ? (
              <p className="load-section__note">
                Not measured on this server: {[...unavailable].map((f) => f).join(", ")}.
              </p>
            ) : null}

            <Disclosure summary="How this is measured">
              <ul className="load-method">
                <li>
                  Each worker writes its own facts into a table of shared memory made before the fork; a thread of each
                  samples its process&apos;s CPU every {status.sample_interval_seconds}&nbsp;s and its memory every{" "}
                  {status.memory_sample_interval_seconds}&nbsp;s, and the master is sampled by whichever worker comes
                  first. Any worker reads the whole table to answer and keeps its answer for {status.cache_seconds}
                  &nbsp;s.
                </li>
                <li>
                  CPU share: the CPU time a process used (user and system, all its threads) over the wall time between
                  two samples, counted in the kernel&apos;s 10 ms ticks. Cores available: the CPU affinity set, or fewer
                  when a cgroup v2 cpu.max quota allows fewer.
                </li>
                <li>
                  Memory, from the kernel&apos;s smaps_rollup: RSS, the resident pages; PSS, each resident page divided
                  by the number of processes sharing it; USS, the pages of the process alone. The limit: the smallest
                  cgroup v2 memory.max of the server&apos;s cgroup and its ancestors, else the machine&apos;s total.
                </li>
                <li>
                  Latency: nearest-rank percentiles of the most recent requests that ended in the window, from arrival
                  to the last byte sent. Requests to /status are counted apart.
                </li>
                <li>
                  Nothing that identifies the machine is in the answer (no host name, path, user or process id; workers
                  are numbered by their row). The charts are this page&apos;s own samples: the server reports its latest
                  sample only.
                </li>
              </ul>
            </Disclosure>
            <Disclosure summary="The answer as sent">
              <pre className="raw load-raw">{latest?.raw}</pre>
            </Disclosure>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
