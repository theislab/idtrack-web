// The Convert page's first figure: many real conversions of one graph, answered by this server once when it started (its
// showcase), drawn together on one release axis over the assembly bands, in the figure grammar (components/figure/).
// Each row is one identifier's journey: its best answer's path as a thin gene bar with Ensembl's history steps marked by
// their glyphs (a journey back in time carries chevrons pointing back). Every mark is local to its row: where the
// identifier is read through an external database its start is an open square, an answer in an external database is a
// filled square, a bridge is the square with a dot on the row itself, dashed to where it lands; no line leaves a row.
// Each set of journeys is a block of its own under its words, so no band, guide or line crosses them. Where many
// journeys take a step of one kind at one release, a line under the bands' names says what happened there, counted
// from the journeys drawn, never shortened to a bare count. A row in focus (or under the pointer, or tapped once) is
// isolated and named; pointing at a step shows that step; the arrow keys move between rows and along a row's steps with
// each step's exact values; Enter, Space, a click or a second tap opens the full answer.
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { GraphDescription } from "../../api/types";
import { databaseLabel } from "../../lib/databases";
import { answerText, eventWords, isEnsembl, type JourneyMark, type ReleaseEvent } from "../../lib/home/journeyModel";
import {
  answerName,
  bridgesOf,
  isRenamed,
  journeyList,
  readDatabases,
  symbolOf,
  type Journey,
  type JourneySet,
} from "../../lib/home/journeys";
import { clearEnds } from "../../lib/home/rowMarks";
import { journeysGeometry, layoutOf, LINE, PHONE_FIGURE, setWords } from "../../lib/home/useJourneys";
import { caseHref } from "../../lib/home/links";
import { pythonFloat } from "../../lib/numbers";
import { organismName } from "../../lib/organismNames";
import { href, navigate } from "../../lib/router";
import { prose } from "../../lib/values";
import { spaced } from "../../lib/vocabulary";
import { useVocabulary } from "../../lib/vocabularyContext";
import { Bands, ReleaseTicks } from "../figure/axis";
import { FigureNote } from "../figure/FigureNote";
import { GeneBar, StepGlyph } from "../figure/glyphs";
import { isEvent, type Glyph } from "../figure/glyph";
import { FIG_TEXT, middleCut, placeLabels, textWidth, wrapWords } from "../figure/labels";
import { assemblyBands, releaseScale, shortNames } from "../figure/releases";
import { useDismiss, useHover } from "../figure/roving";
import { useWidth } from "../figure/useWidth";

let played = false;

/** The glyph of a mark drawn on a row. */
const ROW_GLYPH: Partial<Record<JourneyMark["kind"], Glyph>> = {
  version: "version",
  event: "event",
  loop: "loop",
  handoff: "handoff",
  bridge: "bridge",
};

/** How far apart (px) two marks of a row stand at least: the start and end marks move outward to keep it. */
const CLEAR = 9.5;
/** The room kept beside an Ensembl answer for its symbol, before the symbols arrive (characters). */
const SYMBOL_ROOM = 10;

/** An event's words placed on the first line (of `taken`, the spans already used on each line) where one of its
 *  forms fits after its mark at `x`, else before it, touching no words or mark there; the spans it takes are added. */
function placeEvent(
  forms: string[],
  x: number,
  taken: [number, number][][],
  width: number,
): { row: number; x: number; anchor: "start" | "end"; text: string } | null {
  const free = (row: number, a: number, b: number) => taken[row]?.every(([p, q]) => b + 12 < p || q + 12 < a) ?? false;
  for (const text of forms) {
    const w = textWidth(text, FIG_TEXT, "sans");
    for (let row = 0; row < taken.length; row++) {
      for (const side of ["start", "end"] as const) {
        const [a, b] = side === "start" ? [x + 9, x + 9 + w] : [x - 9 - w, x - 9];
        if (a < 2 || b > width - 2 || !free(row, a, b) || !free(row, x - 5, x + 5)) continue;
        taken[row]?.push([a, b], [x - 5, x + 5]);
        return { row, x: side === "start" ? a : b, anchor: side, text };
      }
    }
  }
  return null;
}

/** Whether a journey's answer is an Ensembl gene (its symbol is asked of the name authority). */
const ensemblAnswer = (j: Journey) =>
  j.model !== null && (j.model.result.final_database === null || isEnsembl(j.model.result.final_database));

export function JourneysFigure({
  graph,
  sets,
  events,
  symbols,
  fit,
  label,
  named = true,
}: {
  graph: GraphDescription;
  sets: JourneySet[];
  /** The release-wide events drawn (at most a few; the caption names them all). */
  events: ReleaseEvent[];
  /** The symbols of the Ensembl answers, by gene (null until they arrive, or where they cannot be had). */
  symbols: ReadonlyMap<string, readonly string[]> | null;
  /** The height to fill (the hero): the rows take the pitch that fills it, and the journeys travel once as it appears. */
  fit?: number;
  /** The figure's accessible name where it is a still image (an id of the element that describes it). */
  label?: string;
  /** Whether the Ensembl answers carry their symbols (off: no room is kept for them). */
  named?: boolean;
}) {
  const vocabulary = useVocabulary();
  const { ref, width } = useWidth<HTMLDivElement>(1200);
  const list = journeyList(sets);
  const phone = fit === undefined && width < PHONE_FIGURE;
  const still = journeysGeometry(width, layoutOf(sets, 0, undefined, undefined, fit)).still;
  const idOf = (j: Journey) => (j.model ? j.model.result.query_id : j.identifier);
  // Each row's two names: the identifier where its line starts, the answer where it ends (a journey back in time
  // starts on the right and ends on the left).
  const names = list.map((j) => {
    const id = idOf(j);
    const answer = j.model ? answerName(j, symbols) : null;
    const back = j.model?.backward ?? false;
    return {
      left: back && answer ? `← ${answer}` : id,
      right: back ? id : answer,
      leftIsAnswer: back && answer !== null,
    };
  });
  const room = (j: Journey, text: string | null) =>
    text === null
      ? 0
      : textWidth(text, FIG_TEXT, "mono", 600) +
        (named && ensemblAnswer(j) && symbols === null ? textWidth(" · ".padEnd(3 + SYMBOL_ROOM, "x")) : 0);
  const leftText = Math.max(
    0,
    ...list.map((j, i) => {
      const n = names[i];
      return n ? (n.leftIsAnswer ? room(j, n.left) : textWidth(n.left)) : 0;
    }),
  );
  const rightText = Math.max(
    0,
    ...list.map((j, i) => {
      const n = names[i];
      return n ? (n.leftIsAnswer ? textWidth(n.right ?? "") : room(j, n.right)) : 0;
    }),
  );
  const g0 = journeysGeometry(width, layoutOf(sets, 0, [leftText, rightText], undefined, fit));
  const releases = graph.releases;
  const first = releases[0] ?? 48;
  const last = releases[releases.length - 1] ?? 115;
  const scale = releaseScale(releases, g0.left, width - g0.right);
  const assemblyName = (key: number) => graph.assemblies.find((a) => a.assembly === key)?.name ?? String(key);

  // The words of each set, wrapped to the figure's width where they do not fit one line.
  const setText = sets.map((set) => setWords(set, graph.snapshot_release, readDatabases(set).map(databaseLabel)));
  const setLines = setText.map((t) => wrapWords(t, width - 8, FIG_TEXT, "sans"));

  // The release-wide events: on a wide screen each in full beside its mark (after it, else before it), on the first of
  // three lines where it fits; on a phone one a line, wrapped to the width. Never a bare count.
  const eventText = (e: ReleaseEvent) => `${e.old}→${e.new}: ${e.journeys} of ${e.of} ${eventWords(e, assemblyName)}`;
  // The same words with the assemblies' short names, marked as short ("M…5.0 → M…6.0"), where the full ones do not fit.
  const shortName = shortNames(graph.assemblies.map((a) => a.name ?? String(a.assembly)));
  const eventShort = (e: ReleaseEvent) =>
    `${e.old}→${e.new}: ${e.journeys} of ${e.of} ${eventWords(e, (key) => shortName.get(assemblyName(key)) ?? assemblyName(key))}`;
  const eventForms = (e: ReleaseEvent) => [...new Set([eventText(e), eventShort(e)])];
  const eventX = (e: ReleaseEvent) => scale.x((e.old + e.new) / 2);
  const eventRows = ["e0", "e1", "e2"];
  // Each event in turn (the order given), on the first line where its words fit after its mark, else before it,
  // touching no words or mark already placed on that line.
  const eventPlaced = new Map<string, { row: number; x: number; anchor: "start" | "end"; text: string }>();
  if (!phone) {
    const taken: [number, number][][] = eventRows.map(() => []);
    for (const e of events) {
      const placed = placeEvent(eventForms(e), eventX(e), taken, width);
      if (placed) eventPlaced.set(`${e.kind}-${e.old}`, placed);
    }
  }
  const phoneEvents = phone
    ? events.map((e) => ({ e, lines: wrapWords(eventText(e), width - 18, FIG_TEXT, "sans") }))
    : [];
  const eventLines = phone
    ? phoneEvents.reduce((t, x) => t + x.lines.length, 0)
    : events.length
      ? 1 + Math.max(0, ...[...eventPlaced.values()].map((p) => p.row))
      : 0;
  const g = journeysGeometry(
    width,
    layoutOf(
      sets,
      eventLines,
      [leftText, rightText],
      setLines.map((l) => l.length),
      fit,
    ),
  );
  const eventY = (line: number) => g.bandsHead + 4 + LINE * line + 11;

  const id = useId();
  // The figure is laid out again once the faces have loaded, so every word is measured in the face that draws it.
  const [, relayout] = useReducer((layouts: number) => layouts + 1, 0);
  useEffect(() => {
    let live = true;
    void (document as { fonts?: FontFaceSet }).fonts?.ready.then(() => {
      if (live) relayout();
    });
    return () => {
      live = false;
    };
  }, []);
  const [animate] = useState(() => !played);
  useEffect(() => {
    played = true;
  }, []);
  const bands = assemblyBands(graph);

  const pointer = useHover<number>();
  const hover = pointer.hover;
  const [focus, setFocus] = useState<{ j: number; k: number } | null>(null);
  const [pointed, setPointed] = useState<{ j: number; k: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [touch, setTouch] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const visible = hover ?? focus?.j ?? null;
  const dismiss = useDismiss(visible !== null);
  const active = visible;
  const shownNote = dismiss.dismissed ? null : visible;
  const step = hover !== null ? (pointed?.j === hover ? pointed : null) : focus && focus.k >= 0 ? focus : null;

  // Each row's marks on the axis: the steps where their releases put them, the start and end moved off them.
  const rowMarks = list.map((entry) => {
    const m = entry.model;
    if (!m) return null;
    const xs = m.marks.filter((mk) => ROW_GLYPH[mk.kind]).map((mk) => scale.x(mk.at));
    const ends = clearEnds(scale.x(m.result.from_release ?? m.lo), scale.x(m.result.to_release), xs, CLEAR);
    return {
      ...ends,
      lo: Math.min(ends.start, ends.end, scale.x(m.lo)),
      hi: Math.max(ends.start, ends.end, scale.x(m.hi)),
    };
  });

  const openAnswer = (j: number) => {
    const journey = list[j];
    if (!journey) return;
    const set = sets[journey.set];
    navigate(
      caseHref({
        organism: graph.organism,
        identifier: journey.identifier,
        ...(set?.from !== null && set?.from !== undefined ? { from: set.from } : {}),
        ...(set?.to !== null && set?.to !== undefined ? { to: set.to } : {}),
        ...(set?.db !== null && set?.db !== undefined ? { db: set.db } : {}),
      }),
    );
    window.scrollTo({ top: 0 });
  };

  const onKeyDown = (j: number) => (event: KeyboardEvent<SVGGElement>) => {
    const marks = list[j]?.model?.marks.length ?? 0;
    const k = focus?.j === j ? focus.k : -1;
    const moveRow = (to: number) => {
      const next = Math.max(0, Math.min(list.length - 1, to));
      setCurrent(next);
      svgRef.current?.querySelector<SVGGElement>(`[data-journey="${next}"]`)?.focus();
    };
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveRow(j + 1);
      },
      ArrowUp: () => {
        moveRow(j - 1);
      },
      ArrowRight: () => {
        setFocus({ j, k: Math.min(marks - 1, k + 1) });
      },
      ArrowLeft: () => {
        setFocus({ j, k: Math.max(-1, k - 1) });
      },
      Home: () => {
        moveRow(0);
      },
      End: () => {
        moveRow(list.length - 1);
      },
      Enter: () => {
        openAnswer(j);
      },
      " ": () => {
        openAnswer(j);
      },
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      pointer.drop();
      setPointed(null);
      dismiss.reset();
      action();
    }
  };

  /** The step of row j nearest to the pointer, within reach of its glyph. */
  const stepAt = (j: number, x: number): number | null => {
    const m = list[j]?.model;
    if (!m) return null;
    let best: number | null = null;
    let distance = 9;
    m.marks.forEach((mk, k) => {
      if (!ROW_GLYPH[mk.kind] && mk.kind !== "final") return;
      const d = Math.abs(scale.x(mk.at) - x);
      if (d < distance) {
        distance = d;
        best = k;
      }
    });
    return best;
  };

  const noteFor = (j: number): ReactNode => {
    const journey = list[j];
    if (!journey) return null;
    const m = journey.model;
    if (!m) {
      return (
        <>
          <p className="fig-note__title mono">{journey.identifier}</p>
          <p className="fig-note__quiet">
            {journey.error
              ? `Not answered when the server started: ${journey.error.message}`
              : "This conversion has no best answer to draw; open it for what the server says."}
          </p>
        </>
      );
    }
    const r = m.result;
    if (step?.j === j) {
      const mark = m.marks[step.k];
      if (!mark) return null;
      const s = mark.step;
      const meaning = vocabulary.stepReasons.get(s.reason) ?? null;
      const asm = (key: number | null) => (key === null ? "—" : `${assemblyName(key)} (${key})`);
      return (
        <>
          <p className="fig-note__title">
            <span className="mono">{r.query_id}</span> · step {mark.number} of {m.marks.length} · {spaced(s.reason)}
          </p>
          {meaning ? <p className="fig-note__quiet">{prose(meaning)}</p> : null}
          <p className="mono">
            {s.source ?? "—"} → {s.target}
          </p>
          <p>
            {s.old_release !== null && s.new_release !== null ? (
              <>
                Releases <span className="mono">{`${s.old_release} → ${s.new_release}`}</span>
                {" · "}
                {s.weight === null ? "no score" : <span className="mono">score {pythonFloat(s.weight)}</span>}
              </>
            ) : s.release !== null ? (
              <>
                Release <span className="mono">{s.release}</span>
              </>
            ) : null}
          </p>
          {mark.kind === "handoff" ? (
            <p>
              Assembly <span className="mono">{asm(s.old_assembly)}</span> →{" "}
              <span className="mono">{asm(s.assembly)}</span>
            </p>
          ) : null}
          {s.places ? (
            <p className="fig-note__quiet">{prose(vocabulary.placeRelations.get(s.places) ?? spaced(s.places))}</p>
          ) : null}
          {s.databases.length ? <p className="fig-note__quiet">{s.databases.map(databaseLabel).join(", ")}</p> : null}
        </>
      );
    }
    const counts = new Map<string, number>();
    for (const mk of m.marks) counts.set(mk.step.reason, (counts.get(mk.step.reason) ?? 0) + 1);
    const handoffs = m.marks.filter((mk) => mk.kind === "handoff").length;
    const targets = [...new Set(m.best.map((c) => c.target))];
    const sym = symbolOf(journey, symbols);
    const bridges = bridgesOf(journey);
    return (
      <>
        <p className="fig-note__title">
          <span className="mono">{r.query_id}</span> → <span className="mono">{targets.join(", ")}</span>
          {sym ? <span className="fig-note__quiet"> ({sym})</span> : null}
        </p>
        <p>
          Read at release <span className="mono">{r.from_release}</span>
          {r.from_databases.filter((d) => !isEnsembl(d)).length
            ? ` in ${r.from_databases
                .filter((d) => !isEnsembl(d))
                .map(databaseLabel)
                .join(", ")}`
            : ""}
          ; answered at release <span className="mono">{r.to_release}</span>{" "}
          {r.final_database === null || isEnsembl(r.final_database)
            ? "as an Ensembl gene"
            : `in ${databaseLabel(r.final_database)}`}
          {r.status === "tie" ? ` (a tie of ${targets.length})` : ""}
          {m.backward ? "; walked backward in time" : ""}
        </p>
        <p className="fig-note__quiet">
          {m.marks.length} steps: {[...counts.entries()].map(([reason, n]) => `${n} ${spaced(reason)}`).join(", ")}
          {handoffs ? `; ${handoffs} across an assembly change` : ""}
          {bridges.length
            ? `; through ${bridges.length === 1 ? "a bridge" : `${bridges.length} bridges`} (${bridges.map((b) => b.id).join(", ")}), idtrack's inference`
            : ""}
        </p>
        {sym ? (
          <p className="fig-note__quiet">The symbol: idtrack's conversion of the gene at the same release.</p>
        ) : null}
        <p className="fig-note__quiet">
          {touch
            ? "Tap again: the full answer"
            : "Point at a step for its values · arrow keys: rows and steps · Enter: the full answer"}
        </p>
      </>
    );
  };

  const noteX = (() => {
    if (active === null) return 0;
    const m = list[active]?.model;
    if (step && m) return scale.x(m.marks[step.k]?.at ?? m.lo);
    return m ? scale.x((m.lo + m.hi) / 2) : width / 2;
  })();

  // The names of the rows on a phone: on a line of paper above each track, the left name at the start of the axis,
  // the right name at its end; the right one cut in its middle (an identifier) where the two would touch.
  const phoneNames = phone
    ? placeLabels(
        list.flatMap((_, j) => {
          const n = names[j];
          if (!n) return [];
          const cuts = (text: string) =>
            [text, ...[16, 13, 10, 8].map((k) => middleCut(text, k) ?? "")].filter(Boolean);
          return [
            {
              key: `l${j}`,
              anchor: scale.x0,
              forms: n.leftIsAnswer ? cuts(n.left) : [n.left],
              align: "start" as const,
              rows: [`r${j}`],
              weight: n.leftIsAnswer ? 600 : 400,
            },
            ...(n.right
              ? [
                  {
                    key: `r${j}`,
                    anchor: scale.x1,
                    forms: n.leftIsAnswer ? cuts(n.right) : cuts(n.right),
                    align: "end" as const,
                    rows: [`r${j}`],
                    weight: n.leftIsAnswer ? 400 : 600,
                  },
                ]
              : []),
          ];
        }),
        { bounds: [0, width], gap: 10 },
      )
    : null;

  return (
    <div
      className={`journeys__plot fig${animate ? (fit === undefined ? " fig-wipe" : " jr-travel") : ""}${still ? " journeys__plot--still" : ""}`}
      ref={ref}
      style={{ height: g.height }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={g.height}
        className={`journeys__svg${active !== null ? " is-isolating" : ""}`}
        role={still ? "img" : "group"}
        {...(still && label ? { "aria-describedby": label } : {})}
        aria-label={
          still
            ? `The journeys of the ${organismName(graph.organism)} graph through the releases ${first} to ${last}, a still image; every journey is listed in words after the caption.`
            : `${list.length} journeys through the releases ${first} to ${last} of the ${organismName(graph.organism)} graph. Arrow keys move between journeys and along their steps; Enter opens a journey's full answer.`
        }
        onPointerLeave={() => {
          pointer.leave();
          setPointed(null);
        }}
      >
        {/* The bands' names, then each set's block (on a phone each row's track) over the bands */}
        <Bands bands={bands} scale={scale} top={0} bottom={g.bandsHead - 4} labelY={13} outerY={27} />
        {phone
          ? list.map((entry, j) => (
              <Bands
                key={`${entry.set}-${entry.identifier}`}
                bands={bands}
                scale={scale}
                top={g.trackTop(j)}
                bottom={g.trackBottom(j)}
                labels={false}
              />
            ))
          : sets.map((_, s) => (
              <Bands key={s} bands={bands} scale={scale} top={g.blockTop(s)} bottom={g.blockBottom(s)} labels={false} />
            ))}
        <ReleaseTicks scale={scale} y={g.axisY} releases={releases} bounds={[0, width]} />
        {/* Release-wide events: the mark beside its words, and a faint guide inside each set whose journeys take it */}
        <g className="jr-events" aria-hidden="true">
          {still
            ? null
            : (() => {
                let line = 0;
                return events.map((e) => {
                  const key = `${e.kind}-${e.old}`;
                  const x = eventX(e);
                  const at = phone ? line : (eventPlaced.get(key)?.row ?? null);
                  if (phone) line += phoneEvents.find((p) => p.e === e)?.lines.length ?? 1;
                  const takes = (j: Journey) =>
                    j.model?.marks.some(
                      (mk) =>
                        mk.kind === e.kind &&
                        Math.min(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.old &&
                        Math.max(mk.step.old_release ?? 0, mk.step.new_release ?? 0) === e.new,
                    ) ?? false;
                  return (
                    <g key={key}>
                      {!phone
                        ? sets.map((set, s) =>
                            set.journeys.some(takes) ? (
                              <line
                                key={s}
                                x1={x}
                                x2={x}
                                y1={g.blockTop(s) + 1}
                                y2={g.blockBottom(s) - 1}
                                className="jr-event__guide"
                              />
                            ) : null,
                          )
                        : null}
                      {at !== null ? (
                        <StepGlyph
                          glyph={e.kind}
                          x={phone ? scale.x0 + 5 : x}
                          y={eventY(at) - 4 + (e.kind === "loop" ? 4 : 0)}
                          size="thin"
                        />
                      ) : null}
                    </g>
                  );
                });
              })()}
        </g>
        {list.map((entry, j) => {
          const y = g.lineY(j);
          const m = entry.model;
          const ends = rowMarks[j];
          const isActive = active === j;
          const ringed = focus?.j === j && focus.k < 0 && hover === null;
          const readExternal = (m?.result.from_databases ?? []).some((d) => !isEnsembl(d));
          const asked = m?.result.final_database ?? null;
          const answeredExternal =
            m !== null && asked !== null && !isEnsembl(asked) && m.marks.some((mk) => mk.kind === "final");
          const bridgeMarks = m?.marks.filter((mk) => mk.kind === "bridge") ?? [];
          return (
            <g
              key={`${entry.set}-${entry.identifier}`}
              data-journey={j}
              style={{ "--j": j } as CSSProperties}
              {...(still
                ? {}
                : {
                    role: "link",
                    tabIndex: j === current ? 0 : -1,
                    "aria-label": m
                      ? `${m.result.query_id}, read at release ${m.result.from_release}, to ${answerText(m)} at release ${m.result.to_release}: ${m.marks.length} steps`
                      : `${entry.identifier}: ${entry.error ? `not answered (${entry.error.message})` : "no best answer to draw"}`,
                  })}
              className={`jr-row${still ? " jr-row--still" : " fig-target"}${m?.backward ? " jr-row--back" : ""}${isActive ? " is-active" : ""}`}
              onFocus={() => {
                setCurrent(j);
                setFocus((f) => (f?.j === j ? f : { j, k: -1 }));
                dismiss.reset();
              }}
              onBlur={() => {
                setFocus((f) => (f?.j === j ? null : f));
              }}
              onPointerDown={(event: PointerEvent) => {
                setTouch(event.pointerType !== "mouse");
              }}
              onPointerEnter={(event: PointerEvent) => {
                if (event.pointerType === "mouse" && !still) {
                  pointer.enter(j);
                  dismiss.reset();
                }
              }}
              onPointerMove={(event: PointerEvent) => {
                if (event.pointerType !== "mouse" || still) return;
                const box = svgRef.current?.getBoundingClientRect();
                if (!box) return;
                const k = stepAt(j, event.clientX - box.left);
                setPointed((p) => (k === null ? (p === null ? p : null) : p?.j === j && p.k === k ? p : { j, k }));
              }}
              onPointerLeave={(event: PointerEvent) => {
                if (event.pointerType === "mouse") pointer.leave(j);
              }}
              onClick={() => {
                if (still) return;
                // A touch shows the row first; a second touch opens it.
                if (touch && hover !== j) {
                  pointer.enter(j);
                  dismiss.reset();
                  return;
                }
                openAnswer(j);
              }}
              onKeyDown={onKeyDown(j)}
            >
              <rect x={0} y={g.rowTop(j)} width={width} height={g.row} className="fig-hit" />
              {m && ends ? (
                <g className="jr-path">
                  <GeneBar x0={ends.lo} x1={ends.hi} y={y} size="thin" className="jr-line" />
                  {m.backward ? <Chevrons x0={ends.lo} x1={ends.hi} y={y} /> : null}
                  {bridgeMarks.length >= 2 ? (
                    <line
                      x1={scale.x(bridgeMarks[0]?.at ?? m.lo)}
                      x2={scale.x(bridgeMarks[bridgeMarks.length - 1]?.at ?? m.hi)}
                      y1={y}
                      y2={y}
                      className="fig-cross jr-bridge"
                    />
                  ) : null}
                  <StepGlyph glyph={readExternal ? "read" : "form"} x={ends.start} y={y} size="thin" />
                  {m.marks.map((mk, k) => {
                    const glyph = ROW_GLYPH[mk.kind];
                    // A bridge's two steps share its id: one square marks where it passes.
                    if (!glyph || (mk.kind === "bridge" && mk.step.kind !== "bridge_near")) return null;
                    return (
                      <StepGlyph
                        key={k}
                        glyph={glyph}
                        x={scale.x(mk.at)}
                        y={y}
                        size="thin"
                        event={glyph === "handoff" && isEvent(mk.step)}
                      />
                    );
                  })}
                  {answeredExternal ? (
                    <StepGlyph glyph="final" x={ends.end} y={y} size="thin" />
                  ) : (
                    <rect x={ends.end - 3} y={y - 3} width={6} height={6} className="jr-end" />
                  )}
                  {step?.j === j ? (
                    <circle cx={scale.x(m.marks[step.k]?.at ?? m.lo)} cy={y} r={8} className="fig-focus" />
                  ) : null}
                </g>
              ) : (
                <line x1={scale.x0} x2={scale.x1} y1={y} y2={y} className="jr-wait" />
              )}
              {ringed ? (
                <rect x={1} y={g.rowTop(j) + 1} width={width - 2} height={g.row - 2} rx={4} className="fig-focus" />
              ) : null}
            </g>
          );
        })}
        {/* Every text of the figure stands on paper or in a gutter: no line runs behind a set's words, the events'
            words or a row's names. The rows' names stand apart from the rows, whose accessible names say them. */}
        {/* The group is not hidden from assistive technology: the events' words are links (each named in full); the
            sets' words and the phone's events, said by the rows' names and the caption, are hidden one by one. */}
        <g className="jr-labels">
          {(still ? [] : sets).map((_, s) => {
            const lines = setLines[s] ?? [];
            return (
              <text
                key={s}
                x={2}
                y={g.setTop(s) + 14}
                className="fig-text fig-text--sans jr-sets__name"
                aria-hidden="true"
              >
                {lines.map((line, k) => (
                  <tspan key={k} x={2} dy={k ? LINE : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          })}
          {still
            ? null
            : phone
              ? (() => {
                  let line = 0;
                  return phoneEvents.map(({ e, lines }) => {
                    const at = line;
                    line += lines.length;
                    return (
                      <text
                        key={`${e.kind}-${e.old}`}
                        x={scale.x0 + 14}
                        y={eventY(at)}
                        className="fig-text fig-text--sans jr-event__name"
                        aria-hidden="true"
                      >
                        {lines.map((l, k) => (
                          <tspan key={k} x={scale.x0 + 14} dy={k ? LINE : 0}>
                            {l}
                          </tspan>
                        ))}
                      </text>
                    );
                  });
                })()
              : events.map((e) => {
                  const key = `${e.kind}-${e.old}`;
                  const placed = eventPlaced.get(key);
                  // Each release-wide event leads to the graph's own page, where Ensembl's id history of every gene
                  // is drawn release by release.
                  const to = href(`/organisms/${graph.organism}`);
                  return placed ? (
                    <a
                      key={key}
                      href={to}
                      className="jr-event__link"
                      aria-label={`${placed.text}: Ensembl's id history of the ${organismName(graph.organism)} graph`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(to);
                      }}
                    >
                      <text
                        x={placed.x}
                        y={eventY(placed.row)}
                        textAnchor={placed.anchor}
                        className="fig-text fig-text--sans jr-event__name"
                      >
                        {placed.text}
                      </text>
                    </a>
                  ) : null;
                })}
        </g>
        <g className="jr-names" aria-hidden="true">
          {(still ? [] : list).map((entry, j) => {
            const y = g.lineY(j);
            const n = names[j];
            if (!n) return null;
            const answerCls = `jr-answer ${answerClass(entry)}`;
            const sym = symbolOf(entry, symbols);
            const answerLabel = (text: string, x: number, anchor: "start" | "end", cls: string, yy: number) => {
              // The symbol after an Ensembl answer, quieter than the id; a cut label keeps no symbol.
              const full = sym !== null && text.endsWith(` · ${sym}`);
              const head = full ? text.slice(0, text.length - sym.length - 3) : text;
              return (
                <text x={x} y={yy} textAnchor={anchor} className={`fig-text ${cls}`}>
                  {head}
                  {full ? <tspan className="jr-symbol"> · {sym}</tspan> : null}
                </text>
              );
            };
            if (phone) {
              const l = phoneNames?.get(`l${j}`);
              const r = phoneNames?.get(`r${j}`);
              const yy = g.nameY(j);
              return (
                <g key={`${entry.set}-${entry.identifier}`} className={active === j ? "is-active" : ""}>
                  {l ? (
                    n.leftIsAnswer ? (
                      answerLabel(l.text, l.x, "start", answerCls, yy)
                    ) : (
                      <text x={l.x} y={yy} textAnchor="start" className="fig-text jr-id">
                        {l.text}
                      </text>
                    )
                  ) : null}
                  {r ? (
                    n.leftIsAnswer ? (
                      <text x={r.x} y={yy} textAnchor="end" className="fig-text jr-id">
                        {r.text}
                      </text>
                    ) : (
                      answerLabel(r.text, r.x, "end", answerCls, yy)
                    )
                  ) : null}
                </g>
              );
            }
            return (
              <g key={`${entry.set}-${entry.identifier}`} className={active === j ? "is-active" : ""}>
                {n.leftIsAnswer ? (
                  answerLabel(n.left, scale.x0 - 10, "end", answerCls, y + 3.8)
                ) : (
                  <text x={scale.x0 - 10} y={y + 3.8} textAnchor="end" className="fig-text jr-id">
                    {n.left}
                  </text>
                )}
                {n.right === null ? null : n.leftIsAnswer ? (
                  <text x={scale.x1 + 12} y={y + 3.8} textAnchor="start" className="fig-text jr-id">
                    {n.right}
                  </text>
                ) : (
                  answerLabel(n.right, scale.x1 + 12, "start", answerCls, y + 3.8)
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {shownNote !== null ? (
        <FigureNote x={noteX} y={g.lineY(shownNote) + 14} width={width} pointer={pointer.note}>
          {noteFor(shownNote)}
        </FigureNote>
      ) : null}
      <p className="visually-hidden" aria-live="polite" id={id}>
        {focus && focus.k >= 0 && list[focus.j]?.model
          ? (() => {
              const mk = list[focus.j]?.model?.marks[focus.k];
              return mk
                ? `Step ${mk.number}: ${spaced(mk.step.reason)}, ${mk.step.source ?? ""} to ${mk.step.target}${
                    mk.step.old_release !== null
                      ? `, releases ${mk.step.old_release} to ${mk.step.new_release ?? ""}`
                      : mk.step.release !== null
                        ? `, release ${mk.step.release}`
                        : ""
                  }${mk.step.weight !== null ? `, score ${pythonFloat(mk.step.weight)}` : ""}`
                : "";
            })()
          : ""}
      </p>
    </div>
  );
}

/** A journey's answer: strong where it names the gene otherwise than the identifier read (a renamed gene) or is an
 *  Ensembl id, quiet where it is the identifier itself (a gene whose symbol did not change). */
function answerClass(j: Journey): string {
  if (!j.model || !j.result) return "";
  if (isRenamed(j)) return "fig-text--strong jr-answer--renamed";
  const targets = j.result.candidates.filter((c) => c.best).map((c) => c.target);
  return targets.includes(j.result.query_id) ? "jr-answer--same" : "fig-text--strong";
}

/** Chevrons along a journey that travels back in time, pointing the way it goes. */
function Chevrons({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  const n = Math.max(1, Math.floor((x1 - x0) / 64));
  const step = (x1 - x0) / (n + 1);
  return (
    <g className="jr-chevrons" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + step * (i + 1);
        return <path key={i} d={`M${x + 3},${y - 3.5}L${x - 0.5},${y}L${x + 3},${y + 3.5}`} />;
      })}
    </g>
  );
}
