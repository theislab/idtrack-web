// @vitest-environment jsdom
// The home's three pictures are read from the api's data exactly and drawn only where the words leave room: the
// lineages' layout and their field's map; the rings' counts, their one pitch and their place; the cable's journeys,
// its coils and its room; the words said beside the pointer and on the axis; the caption's words of a failure; the
// journey each visit follows; and how a picture is drawn (no WebGL pass where WebGL draws in software, and a lost
// context built again, or the still drawn).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, TimeoutError, UnreachableError } from "../src/api/client";
import type { ConversionResult, HistoryResponse, LineagesResponse, ShowcaseResponse } from "../src/api/types";
import {
  hostPicture,
  RESTORE_WAIT_MS,
  softwareRenderer,
  type Picture,
  type WebglPart,
} from "../src/components/hero/canvas";
import { AXIS_ROOM, fieldAt, frameOf, placeOf, type FieldFrame } from "../src/components/hero/field";
import { arcOf, ringAt, ringLabels, ringsOf, ringsPlace, radiusOf, ticksOf } from "../src/components/hero/rings";
import {
  constellationOf,
  convolutedAnswers,
  ENVELOPE,
  fitPose,
  KIND,
  project,
  ROLE,
  roomOf,
  SEGMENT,
  STAR,
  TILT,
} from "../src/lib/hero/constellationModel";
import { failureWords } from "../src/lib/hero/failure";
import {
  DOT_FLOATS,
  EDGE_FLOATS,
  idAt,
  layoutLineages,
  SEGMENT_FLOATS,
  simplified,
} from "../src/lib/hero/lineageLayout";
import { lateStep, liftedOf, ringLifted } from "../src/lib/hero/words";
import { convolution, journeySteps, journeyStepsText } from "../src/lib/path/steps";
import { conversions } from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

/** A small graph's lineages as the api writes them: two families (one of two ids joined by an edge) and a third id. */
const lineages: LineagesResponse = {
  organism: "sus_scrofa",
  content_digest: "0".repeat(64),
  releases: [10, 11, 12, 13],
  genes: 5,
  families: 3,
  focus_families: 1,
  ids: ["A", "B", "C", "D"],
  family_starts: [0, 2, 3],
  active: [[[10, 11]], [[12, 13]], [[10, 13]], [[11, 13]]],
  versions: [[11], [], [12, 13], []],
  edges: [[0, 1, 11, 12, 0.9]],
};

describe("the lineages' layout", () => {
  it("stands each release's active ids on one side of the centre, oldest nearest it, and draws only what the api says", () => {
    const layout = layoutLineages(lineages, [12]);
    // The column of each release holds exactly its active ids.
    expect(layout.columns.map((c) => [...c].sort())).toEqual([
      [0, 2],
      [0, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    // Every y within the field; no two ids at one height at one release.
    for (let k = 0; k < 4; k++) {
      const ys = [...(layout.columns[k] ?? [])].map((i) => layout.y[i * 4 + k] ?? Number.NaN);
      expect(new Set(ys).size).toBe(ys.length);
      for (const y of ys) expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
    }
    // A grain per new version at a release the id is active at; the edge between the two ids of a family.
    expect(layout.counts.versions).toBe(3);
    expect(layout.dots.length).toBe(3 * DOT_FLOATS);
    expect(layout.counts.edges).toBe(1);
    expect(layout.counts.fans).toBe(0);
    expect(layout.focusIds).toBe(2);
    // Of the three families, two are a single id.
    expect(layout.counts.families).toBe(3);
    expect(layout.counts.singles).toBe(2);
    // The id at a point is the id whose line is there.
    const k = 2;
    const id = layout.columns[k]?.[0] ?? -1;
    expect(idAt(layout, k / 3, layout.y[id * 4 + k] ?? Number.NaN)).toBe(id);
  });

  it("gives an edge the phase of the line it leaves, so that light on that line follows it to the other id", () => {
    const layout = layoutLineages(lineages);
    const edgeMeta = layout.edges[5] ?? -1;
    // A's segments carry the same era plus phase as the edge leaving A.
    const first = layout.segmentStart[0] ?? 0;
    expect(edgeMeta).toBeCloseTo(layout.segments[first * SEGMENT_FLOATS + 5] ?? -2);
    // A grain carries its id's phase too.
    expect(layout.dots[2]).toBeCloseTo(layout.segments[first * SEGMENT_FLOATS + 5] ?? -2);
    // The edges and grains the light reaches are those of the lines that carry it (here every line).
    expect(layout.pulseEdges.length).toBe(EDGE_FLOATS);
    expect(layout.pulseDots.length).toBe(layout.dots.length);
    // One edge crosses each cell it passes: the crowding is one.
    expect(layout.edgeCrowd).toBe(1);
  });

  it("counts how many edges crowd one cell of the field where many fans meet", () => {
    const n = 40;
    const crowded: LineagesResponse = {
      ...lineages,
      ids: Array.from({ length: n }, (_, i) => `G${String(i)}`),
      family_starts: [0],
      active: Array.from({ length: n }, (_, i) => (i === 0 ? [[10, 11]] : [[12, 13]])),
      versions: Array.from({ length: n }, () => []),
      edges: Array.from({ length: n - 1 }, (_, i) => [0, i + 1, 11, 12, null]),
    };
    const layout = layoutLineages(crowded);
    expect(layout.counts.fans).toBe(n - 1);
    expect(layout.edgeCrowd).toBeGreaterThan(5);
  });

  it("simplifies runs of a line that do not change height into one straight segment, and keeps every release", () => {
    const layout = layoutLineages(lineages);
    const { straight, curved } = simplified(layout, [2], 0.01);
    const total = straight.length / SEGMENT_FLOATS + curved.length / SEGMENT_FLOATS;
    expect(total).toBeGreaterThan(0);
    const xs = [...straight, ...curved].filter((_, i) => i % SEGMENT_FLOATS === 0 || i % SEGMENT_FLOATS === 2);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1);
    const drawn = (lines: { straight: Float32Array; curved: Float32Array }) =>
      (lines.straight.length + lines.curved.length) / SEGMENT_FLOATS;
    expect(drawn(layout.lines.all)).toBeGreaterThan(0);
    expect(drawn(layout.lines.focal)).toBeGreaterThan(0);
    expect(drawn(layout.lines.focal)).toBeLessThan(drawn(layout.lines.all));
    expect(drawn(layout.lines.pulses)).toBeGreaterThan(0);
    for (let k = 0; k < 4; k++) {
      const ys = [...(layout.columns[k] ?? [])].map((i) => layout.y[i * 4 + k] ?? 0);
      const up = ys.filter((y) => y < 0).length;
      expect(layout.top[k]).toBeCloseTo(up ? -up / layout.widest : 0);
    }
  });
});

describe("the lineages' field", () => {
  const frame: FieldFrame = { far: { x: 40, top: 600, bottom: 760 }, near: { x: 1400, top: 200, bottom: 760 } };

  it("is a plane in perspective by default: the ends where the frame says, the foot level, the inverse its inverse", () => {
    expect(placeOf(frame, 0, -0.5)).toEqual({ x: 40, y: 600 });
    expect(placeOf(frame, 0, 0.5).y).toBeCloseTo(760);
    expect(placeOf(frame, 1, -0.5).x).toBeCloseTo(1400);
    expect(placeOf(frame, 1, -0.5).y).toBeCloseTo(200);
    expect(placeOf(frame, 0.3, 0.5).y).toBeCloseTo(760);
    expect(placeOf(frame, 0.4, -0.5).x).toBeCloseTo(placeOf(frame, 0.4, 0.5).x);
    const gap = (u: number) => placeOf(frame, u + 0.1, 0).x - placeOf(frame, u, 0).x;
    expect(gap(0)).toBeLessThan(gap(0.9));
    // A plane: its top edge is a straight line on the screen.
    const a = placeOf(frame, 0, -0.5);
    const b = placeOf(frame, 1, -0.5);
    const m = placeOf(frame, 0.37, -0.5);
    expect(m.y).toBeCloseTo(a.y + ((b.y - a.y) * (m.x - a.x)) / (b.x - a.x));
    for (const [x, y] of [
      [0.25, -0.3],
      [0.8, 0.45],
    ] as const) {
      const p = placeOf(frame, x, y);
      const back = fieldAt(frame, p.x, p.y);
      expect(back.x).toBeCloseTo(x);
      expect(back.y).toBeCloseTo(y);
    }
  });

  it("opens toward the present with a flare: low longer, the same ends, the same releases, still invertible", () => {
    const flared: FieldFrame = { ...frame, depth: 2.2, flare: 2 };
    const plain: FieldFrame = { ...frame, depth: 2.2 };
    expect(placeOf(flared, 0, -0.5).y).toBeCloseTo(placeOf(plain, 0, -0.5).y);
    expect(placeOf(flared, 1, -0.5).y).toBeCloseTo(placeOf(plain, 1, -0.5).y);
    // The releases stand where they stood; the field is lower between the ends.
    expect(placeOf(flared, 0.5, 0).x).toBeCloseTo(placeOf(plain, 0.5, 0).x);
    expect(placeOf(flared, 0.5, -0.5).y).toBeGreaterThan(placeOf(plain, 0.5, -0.5).y);
    const p = placeOf(flared, 0.6, -0.2);
    const back = fieldAt(flared, p.x, p.y);
    expect(back.x).toBeCloseTo(0.6);
    expect(back.y).toBeCloseTo(-0.2);
  });

  // The outermost line of a field like human's: the ids alive grow from a third of the most to all of them.
  const top = Float32Array.from({ length: 68 }, (_, k) => -0.5 * (0.37 + (0.63 * k) / 67 + (k >= 65 ? 0.05 : 0)));
  const clearOf = (f: FieldFrame, words: { left: number; top?: number; right: number; bottom: number }) =>
    [...top].every((v, k) => {
      const p = placeOf(f, k / 67, v);
      return !(p.x < words.right + 40 && p.x > words.left - 40 && p.y < words.bottom + 40 - 0.5);
    });

  it("stands beside the words in a wide window, across the content column, its near end in the hero's upper third", () => {
    for (const [width, height, words, caption] of [
      [1440, 836, { left: 104, top: 80, right: 690, bottom: 432 }, 790],
      [1366, 704, { left: 67, top: 40, right: 640, bottom: 400 }, 660],
    ] as const) {
      const room = {
        width,
        height,
        words: { ...words },
        captionTop: caption,
        left: words.left,
        right: width - words.left,
      };
      const f = frameOf(room, top);
      expect(f, String(width)).not.toBeNull();
      if (!f) continue;
      expect(f.far.x).toBe(room.left);
      expect(f.near.x).toBe(room.right);
      expect(f.far.bottom).toBe(f.near.bottom);
      expect(f.near.bottom).toBeLessThanOrEqual(caption - AXIS_ROOM);
      expect(clearOf(f, words), String(width)).toBe(true);
      // The near end reaches 70 % of the hero's height.
      expect(f.near.top, String(width)).toBeLessThanOrEqual(height * 0.3 + 0.5);
      // The releases are spaced as on a plane of depth 2.2 (the early ones not pressed together further).
      expect(f.depth).toBeCloseTo(2.2);
    }
  });

  it("stands right of the words in a short window, under them on a small phone (flat where low), nowhere without room", () => {
    // A laptop at 200 % (720 × 450): two columns.
    const short = frameOf(
      {
        width: 720,
        height: 386,
        words: { left: 24, top: 20, right: 380, bottom: 300 },
        captionTop: 360,
        left: 24,
        right: 696,
      },
      top,
    );
    expect(short).not.toBeNull();
    if (short) {
      expect(clearOf(short, { left: 24, right: 380, bottom: 300 })).toBe(true);
      expect(short.far.x).toBeGreaterThanOrEqual(380 + 40);
    }
    // A small phone (320 × 568): a flat band in the room under the words.
    const phone = frameOf(
      {
        width: 320,
        height: 512,
        words: { left: 16, top: 16, right: 304, bottom: 300 },
        captionTop: 480,
        left: 16,
        right: 304,
      },
      top,
      24,
    );
    expect(phone).not.toBeNull();
    if (phone) {
      expect(phone.near.top).toBeGreaterThanOrEqual(300 + 20 - 0.5);
      expect(phone.near.bottom - phone.near.top).toBeCloseTo(phone.far.bottom - phone.far.top);
    }
    // No room: not drawn.
    expect(
      frameOf(
        {
          width: 320,
          height: 200,
          words: { left: 16, top: 16, right: 304, bottom: 190 },
          captionTop: 180,
          left: 16,
          right: 304,
        },
        top,
      ),
    ).toBeNull();
  });
});

describe("the rings", () => {
  const history: HistoryResponse = {
    organism: "sus_scrofa",
    content_digest: null,
    compute_seconds: 0,
    releases: [
      { release: 10, genes_active: 100, versions_active: 100, created: 100 },
      { release: 11, genes_active: 110, versions_active: 112, created: 20 },
      { release: 12, genes_active: 150, versions_active: 150, created: 45 },
    ],
    transitions: [
      {
        from_release: 10,
        to_release: 11,
        version_changes: 5,
        id_changes: 2,
        same_version: 80,
        retired: 10,
        scored: 90,
        one_to_many: 3,
        many_to_one: 1,
      },
      {
        from_release: 11,
        to_release: 12,
        version_changes: 0,
        id_changes: 0,
        same_version: 110,
        retired: 5,
        scored: 110,
        one_to_many: 1,
        many_to_one: 0,
      },
    ],
  };
  const rings = ringsOf(history, [
    { name: "Sscrofa10.2", first: 10, last: 10 },
    { name: "Sscrofa11.1", first: 11, last: 12 },
  ]);

  it("count each release's ids, the ids created at it, those retired into it and the fans, as /history gives them", () => {
    expect(rings.active).toEqual([100, 110, 150]);
    // The first release's ids are not drawn as created (they are where the graph begins).
    expect(rings.created).toEqual([0, 20, 45]);
    expect(rings.retired).toEqual([0, 10, 5]);
    expect(rings.fans).toEqual([0, 4, 1]);
    expect(rings.changes).toEqual([1]);
    expect(rings.churn[1]).toBeCloseTo(17 / 110);
  });

  it("draw a count exactly, every ring's ticks at one pitch: equal counts equal angles, the busiest one turn", () => {
    expect(ticksOf(16_878, 100)).toEqual({ whole: 168, rest: 0.78 });
    expect(ticksOf(9, 100)).toEqual({ whole: 0, rest: 0.09 });
    // The busiest count (45 at one id a tick) makes one turn; every other count an arc of its own share.
    expect(rings.unit).toBe(1);
    expect(rings.turn).toBe(45);
    expect(arcOf(45, rings)).toBeCloseTo(Math.PI * 2);
    expect(arcOf(20, rings)).toBeCloseTo((Math.PI * 2 * 20) / 45);
    expect(arcOf(10, rings)).toBeCloseTo(arcOf(10, rings));
  });

  it("say '1 fan', '2 fans' beside the pointer", () => {
    expect(ringLifted(rings, 2, { x: 0, y: 0 }).line).toMatch(/· 1 fan$/);
    expect(ringLifted(rings, 1, { x: 0, y: 0 }).line).toMatch(/· 4 fans$/);
    expect(ringLifted(rings, 1, { x: 0, y: 0 }).title).toBe("Release 11 · Sscrofa11.1");
  });

  const words = { left: 104, top: 80, right: 650, bottom: 460 };
  it("stand clear of the words, above the caption and inside the content column, or not at all", () => {
    for (const [width, height, box, caption, right] of [
      [1440, 836, words, 790, 1336],
      [1366, 704, { ...words, right: 620 }, 660, 1299],
      [1024, 704, { left: 20, top: 60, right: 600, bottom: 520 }, 660, 1000],
      [768, 960, { left: 20, top: 60, right: 640, bottom: 560 }, 900, 744],
      [390, 788, { left: 16, top: 40, right: 374, bottom: 460 }, 690, 374],
      [720, 386, { left: 24, top: 20, right: 380, bottom: 300 }, 360, 696],
    ] as const) {
      const place = ringsPlace({ width, height, words: box, captionTop: caption, left: box.left, right });
      expect(place, String(width)).not.toBeNull();
      if (!place) continue;
      const nearestX = Math.max(box.left, Math.min(place.cx, box.right));
      const nearestY = Math.max(box.top, Math.min(place.cy, box.bottom));
      const shown = place.horizon === null || nearestY <= place.horizon;
      if (shown)
        expect(Math.hypot(place.cx - nearestX, place.cy - nearestY), String(width)).toBeGreaterThan(place.outer + 10);
      const lowest = place.horizon ?? place.cy + place.outer;
      expect(lowest, String(width)).toBeLessThan(caption);
      // The disc and the last ring's label within the content column.
      expect(place.cx + place.outer, String(width)).toBeLessThanOrEqual(right - 30);
    }
    // Where neither a disc beside the words nor half a disc under them has room: none.
    expect(
      ringsPlace({
        width: 320,
        height: 300,
        words: { left: 16, top: 16, right: 304, bottom: 260 },
        captionTop: 280,
        left: 16,
        right: 304,
      }),
    ).toBeNull();
  });

  it("are labelled at the first ring, each later assembly's first ring and the last, on their rings", () => {
    const releases = Array.from({ length: 68 }, (_, i) => 48 + i);
    const model = {
      releases,
      assemblies: releases.map((r) => (r < 55 ? "NCBI36" : r < 76 ? "GRCh37" : "GRCh38")),
      active: releases.map(() => 1),
      created: releases.map(() => 0),
      retired: releases.map(() => 0),
      fans: releases.map(() => 0),
      churn: releases.map(() => 0),
      unit: 100,
      turn: 240,
      changes: [7, 28],
    };
    const place = ringsPlace({ width: 1440, height: 836, words, captionTop: 790, left: 104, right: 1336 });
    expect(place).not.toBeNull();
    if (!place) return;
    const labels = ringLabels(model, place, false);
    expect(labels.map((l) => [l.release, l.name])).toEqual([
      ["48", ""],
      ["55", "GRCh37"],
      ["76", "GRCh38"],
      ["115", ""],
    ]);
    expect(labels.every((l) => l.y === place.cy && l.align === "after")).toBe(true);
    expect(labels.map((l) => l.x)).toEqual([0, 7, 28, 67].map((k) => place.cx + radiusOf(place, k, 68)));
    expect(ringAt(place, 68, { x: place.cx + radiusOf(place, 28, 68) + 0.4, y: place.cy })).toBe(28);
    expect(ringAt(place, 68, { x: place.cx, y: place.cy })).toBe(-1);
  });
});

describe("the lineages' words", () => {
  const layout = layoutLineages(lineages);
  it("say 'on a showcase journey' only of an id a journey's path passes; of its family's other ids, 'in the family'", () => {
    const on = new Set(["A"]);
    expect(liftedOf(layout, 0, { x: 0, y: 0 }, on).line).toMatch(/on a showcase journey$/);
    expect(liftedOf(layout, 1, { x: 0, y: 0 }, on).line).toMatch(/in the family of a showcase journey$/);
    expect(liftedOf(layout, 2, { x: 0, y: 0 }, on).line).not.toMatch(/showcase/);
    expect(liftedOf(layout, 2, { x: 0, y: 0 }, on).line).toBe("active 10–13 · 2 new versions");
  });

  it("name on the axis the release after the first at which the most gene ids were new, unless an assembly begins there", () => {
    const history = {
      releases: [
        { release: 48, genes_active: 30_000, versions_active: 30_000, created: 30_000 },
        { release: 55, genes_active: 40_000, versions_active: 40_000, created: 15_000 },
        { release: 113, genes_active: 87_000, versions_active: 87_000, created: 16_878 },
      ],
    } as HistoryResponse;
    expect(lateStep(history, [55])).toEqual({ release: 113, created: 16_878 });
    expect(lateStep(history, [55, 113])).toBeNull();
    expect(lateStep(null, [])).toBeNull();
  });
});

describe("the cable", () => {
  const answers = conversions()
    .map((c) => c.result)
    .filter((r) => r.path?.steps.length);
  const showcaseOf = (results: ConversionResult[]) =>
    ({
      organism: "homo_sapiens",
      content_digest: null,
      checked_on: null,
      journeys: results.map((result) => ({
        query: {
          identifier: result.query_id,
          from_release: null,
          to_release: null,
          final_database: null,
          explain: true,
        },
        result,
        error: null,
      })),
      cases: [],
    }) as ShowcaseResponse;
  const showcase = showcaseOf(answers);
  const span = { first: 48, last: 115, changes: [55, 76] };
  const model = constellationOf(showcase, 5, span);
  const xOf = (release: number) => ((release - span.first) / (span.last - span.first)) * 2 - 1;

  it("draws the most convoluted answers by the one measure, each id a star and each step a curve", () => {
    const chosen = convolutedAnswers(showcase, 5);
    expect(model.journeys.map((j) => j.identifier)).toEqual(chosen.map((r) => r.query_id));
    expect(model.journeys.length).toBeGreaterThan(0);
    // Ranked by the measure of every page (lib/path/steps.ts), most convoluted first.
    const totals = chosen.map((r) => convolution(r).total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    chosen.forEach((r, j) => {
      const journey = model.journeys[j];
      const steps = (r.path?.steps ?? []).filter((s) => s.source !== null && s.source !== s.target);
      // A journey's steps are counted and written as on every page: its best answer's path.
      expect(journey?.steps).toBe(journeySteps(r).length);
      expect(journey?.stepsText).toBe(journeyStepsText(r));
      expect(journey?.fans).toBe(
        steps.filter((s) => (s.kind === "history" || s.kind === "self_loop") && (s.splits > 0 || s.merges > 0)).length,
      );
      const anchor = journey?.anchor ?? -1;
      expect(model.stars[anchor * STAR + 3]).toBe(j);
      expect(model.stars[anchor * STAR + 6]).toBe(ROLE.query);
    });
    expect(model.stars.length / STAR).toBe(model.journeys.reduce((n, j) => n + j.nodes, 0));
  });

  it("lays the axis of time, a ring at each change of assembly and a tick at every tenth release", () => {
    let axis = 0;
    let changes = 0;
    for (let i = 0; i < model.segments.length; i += SEGMENT) {
      expect(Math.abs(model.segments[i] ?? 2)).toBeLessThanOrEqual(1 + 1e-6);
      if (model.segments[i + 6] === KIND.axis) axis++;
      if (model.segments[i + 6] === KIND.change) changes++;
    }
    expect(axis).toBe(48);
    expect(changes).toBe(80);
    expect(model.ticks).toEqual([50, 60, 70, 80, 90, 100, 110]);
    // A star of an Ensembl id stands where the id begins.
    const r = convolutedAnswers(showcase, 1)[0];
    const begins = r?.path?.nodes.find((n) => n.kind === "ensembl_gene" && n.active.length && n.id !== r.query_id);
    if (begins) {
      const first = Math.max(span.first, begins.active[0]?.[0] ?? 0);
      const xs: number[] = [];
      for (let i = 0; i < model.stars.length; i += STAR) if (model.stars[i + 3] === 0) xs.push(model.stars[i] ?? 9);
      expect(xs.some((x) => Math.abs(x - xOf(first)) < 1e-5)).toBe(true);
    }
  });

  it("winds each journey as a coil shaped by its data: a split swells it, and the id where it splits is a knot", () => {
    const node = (id: string, active: [number, number][]) => ({
      id,
      kind: "ensembl_gene",
      label: id,
      databases: [],
      active,
      assemblies: [],
      non_reference: [],
      places: [],
    });
    const step = (source: string, target: string, splits: number, at: number) => ({
      kind: "history",
      source,
      target,
      key: 0,
      release: null,
      old_release: at - 1,
      new_release: at,
      weight: 1,
      splits,
      merges: 0,
      databases: [],
      assembly: null,
      old_assembly: null,
      reason: splits ? "split" : "new_id",
      places: null,
    });
    // One gene, continued by another at 61, which splits at 80 into two that live on.
    const split = {
      ...answers[0],
      query_id: "ENSG0",
      candidates: [],
      path: {
        nodes: [
          node("ENSG0", [[48, 60]]),
          node("ENSG1", [[61, 79]]),
          node("ENSG2", [[80, 115]]),
          node("ENSG3", [[80, 115]]),
        ],
        steps: [step("ENSG0", "ENSG1", 0, 61), step("ENSG1", "ENSG2", 1, 80), step("ENSG1", "ENSG3", 1, 80)],
      },
    } as unknown as ConversionResult;
    const coil = constellationOf(showcaseOf([split]), 1, span);
    const reach = (from: number, to: number) => {
      const out: number[] = [];
      for (let i = 0; i < coil.segments.length; i += SEGMENT)
        if (coil.segments[i + 6] === KIND.run && (coil.segments[i] ?? 0) >= from && (coil.segments[i] ?? 0) <= to)
          out.push(Math.hypot(coil.segments[i + 1] ?? 0, coil.segments[i + 2] ?? 0));
      return out.reduce((a, b) => a + b, 0) / Math.max(1, out.length);
    };
    expect(reach(xOf(90), xOf(110))).toBeGreaterThan(reach(xOf(62), xOf(75)) * 1.2);
    const roles: number[] = [];
    for (let i = 0; i < coil.stars.length; i += STAR) roles.push(coil.stars[i + 6] ?? -1);
    expect(roles).toContain(ROLE.query);
    expect(roles).toContain(ROLE.knot);
    expect(coil.journeys[0]?.fans).toBe(2);
  });

  it("lies in a band right of every word it passes and above the caption, spanning 55 % of a wide hero where it can", () => {
    const blocks = [
      { left: 104, top: 120, right: 650, bottom: 270 },
      { left: 104, top: 290, right: 670, bottom: 340 },
      { left: 88, top: 361, right: 498, bottom: 433 },
    ];
    const caption = { left: 104, top: 800, right: 1336, bottom: 820 };
    const room = roomOf(1440, 836, blocks, caption);
    expect(room).not.toBeNull();
    if (!room) return;
    expect(room.bottom).toBeLessThan(caption.top);
    expect(room.right - room.left).toBeGreaterThanOrEqual(0.55 * 1440 - 96);
    for (const b of blocks)
      if (b.bottom > room.top && b.top < room.bottom) expect(room.left).toBeGreaterThanOrEqual(b.right + 48);
    // A small phone's room under the words, or none.
    const phone = roomOf(320, 512, [{ left: 16, top: 16, right: 304, bottom: 300 }], {
      left: 16,
      top: 470,
      right: 304,
      bottom: 500,
    });
    expect(phone === null || phone.top >= 300).toBe(true);
    expect(roomOf(320, 200, [{ left: 16, top: 16, right: 304, bottom: 180 }], null)).toBeNull();
  });

  it("stays inside its room at every turn and at every tilt the pointer may give it", () => {
    for (const room of [
      { left: 560, top: 360, right: 1392, bottom: 780 },
      { left: 48, top: 486, right: 342, bottom: 682 },
    ]) {
      const pose = fitPose(model, room, { x: 10, y: 10 }, 0.16);
      const seen = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      for (let turn = 0; turn < Math.PI * 2; turn += 0.2)
        for (const yaw of [0.16 - TILT.yaw, 0.16, 0.16 + TILT.yaw])
          for (let i = 0; i < model.segments.length; i += SEGMENT) {
            const q = project(
              { ...pose, turn, yaw },
              model.segments[i] ?? 0,
              model.segments[i + 1] ?? 0,
              model.segments[i + 2] ?? 0,
            );
            seen.left = Math.min(seen.left, q.x);
            seen.right = Math.max(seen.right, q.x);
            seen.top = Math.min(seen.top, q.y);
            seen.bottom = Math.max(seen.bottom, q.y);
          }
      expect(seen.left).toBeGreaterThanOrEqual(room.left - 0.5);
      expect(seen.right).toBeLessThanOrEqual(room.right + 0.5);
      expect(seen.top).toBeGreaterThanOrEqual(room.top - 0.5);
      expect(seen.bottom).toBeLessThanOrEqual(room.bottom + 0.5);
    }
    expect(model.envelope.length).toBe(ENVELOPE);
  });
});

describe("the caption's words of a failure", () => {
  const busy = new ApiError(
    503,
    { code: "server_busy", message: "Busy.", argument: null, allowed: null, details: null, request_id: "x" },
    3,
  );
  it("name the endpoint, its answer and what happens next", () => {
    const endpoint = "GET /api/v1/organisms/homo_sapiens/lineages";
    expect(failureWords(endpoint, busy, true)).toBe(`${endpoint} answered 503 server_busy; it is asked again in 3 s.`);
    expect(failureWords(endpoint, busy, false)).toBe(
      `${endpoint} answered 503 server_busy; reload the page to ask again.`,
    );
    expect(failureWords(endpoint, new UnreachableError("down"), true)).toBe(
      `the server cannot be reached; ${endpoint} is asked again when the connection returns.`,
    );
    expect(failureWords(endpoint, new TimeoutError(), true)).toMatch(/did not answer in time/);
  });
});

describe("the journey each visit follows", () => {
  it("is the next one at each load of the page in this browser", async () => {
    window.localStorage.setItem("idtrack-visit", "4");
    vi.resetModules();
    const first = await import("../src/lib/hero/visit");
    expect(first.visitNumber()).toBe(4);
    expect(first.visitNumber()).toBe(4);
    expect(window.localStorage.getItem("idtrack-visit")).toBe("5");
    vi.resetModules();
    const next = await import("../src/lib/hero/visit");
    expect(next.visitNumber()).toBe(5);
  });
});

/** A WebGL2 context good enough for the host: its renderer's name, its extensions, its canvas. */
function fakeGl(canvas: HTMLCanvasElement, renderer: string) {
  return {
    canvas,
    RENDERER: 1,
    getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 2 } : null),
    getParameter: () => renderer,
  } as unknown as WebGL2RenderingContext;
}

/** A picture that records what it was told. */
function recorder(mode: "webgl2" | "canvas2d", canvas: HTMLCanvasElement) {
  const told: string[] = [];
  const picture: Picture<number> = {
    mode,
    element: canvas,
    moving: mode === "webgl2",
    resize: (_w, _h, p) => told.push(`resize ${String(p)}`),
    setColours: () => told.push("colours"),
    setPointer: () => -1,
    setRunning: (on) => told.push(`running ${String(on)}`),
    stats: () => ({ frames: 0, meanFrameMs: 0, meanDrawMs: 0 }),
    work: () => null,
    drawAt: () => undefined,
    destroy: () => told.push("destroyed"),
  };
  return { picture, told };
}

describe("how a picture is drawn", () => {
  it("never draws a WebGL pass where WebGL draws in software: the still, on a canvas never asked for WebGL", async () => {
    vi.resetModules();
    const asked: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      asked.push(`${kind}:${String(this.width)}`);
      return kind === "webgl2" ? fakeGl(this, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))") : null;
    } as never);
    const canvasModule = await import("../src/components/hero/canvas");
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    const start = vi.fn();
    const still = recorder("canvas2d", canvas);
    const picture = canvasModule.hostPicture<number>(canvas, { attributes: {}, start }, () => still.picture, false);
    expect(picture.mode).toBe("canvas2d");
    expect(start).not.toHaveBeenCalled();
    // Only the probe of one pixel was asked for WebGL2, once for the page.
    expect(asked).toEqual(["webgl2:1"]);
    expect(canvasModule.pageGraphics()).toEqual({ webgl2: true, software: true });
    expect(softwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(softwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
  });

  it("builds itself again on a context given back, and draws its still where none comes back within 2 s", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => f(0), 0) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (h: number) => clearTimeout(h));
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      return kind === "webgl2" ? fakeGl(this, "ANGLE (NVIDIA GeForce)") : null;
    } as never);
    const built: ReturnType<typeof recorder>[] = [];
    const part: WebglPart<number> = {
      attributes: {},
      start: () => ({
        done: () => true,
        build: () => {
          const r = recorder("webgl2", canvas);
          built.push(r);
          return r.picture;
        },
      }),
    };
    const stills: ReturnType<typeof recorder>[] = [];
    const picture = hostPicture<number>(
      canvas,
      part,
      (c) => {
        const r = recorder("canvas2d", c);
        stills.push(r);
        return r.picture;
      },
      false,
    );
    picture.resize(10, 10, 7);
    picture.setRunning(true);
    vi.advanceTimersByTime(5);
    expect(built.length).toBe(1);
    expect(built[0]?.told).toEqual(["resize 7", "running true"]);
    // Lost, then given back: built again with what it was told.
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(built[0]?.told).toContain("destroyed");
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    vi.advanceTimersByTime(5);
    expect(built.length).toBe(2);
    expect(built[1]?.told).toEqual(["resize 7", "running true"]);
    // Lost for good: the still, on a fresh canvas, after the wait.
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(RESTORE_WAIT_MS + 5);
    expect(stills.length).toBe(1);
    expect(picture.mode).toBe("canvas2d");
    expect(picture.element).not.toBe(canvas);
    expect(stills[0]?.told).toEqual(["resize 7", "running true"]);
    picture.destroy();
    vi.unstubAllGlobals();
  });

  it("gives no WebGL context up on purpose anywhere (a canvas is let go instead)", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [join(dir, d.name)] : [],
      );
    const found = files(root).filter((f) => readFileSync(f, "utf8").includes("loseContext"));
    expect(found).toEqual([]);
  });
});
