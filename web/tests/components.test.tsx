// @vitest-environment jsdom
// The result view and the error panel render what the api returned, with every element of the path reachable by
// keyboard and its exact values on focus.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UnreachableError } from "../src/api/client";
import type { ConversionResult, ErrorBody } from "../src/api/types";
import { ErrorPanel } from "../src/components/ErrorPanel";
import { ResultView } from "../src/components/ResultView";
import { pythonFloat } from "../src/lib/numbers";
import { splitLimitation } from "../src/lib/noTarget";
import { criterionValue, prose } from "../src/lib/values";
import { readVocabulary } from "../src/lib/vocabulary";
import { VocabularyContext } from "../src/lib/vocabularyContext";
import { expand, openTab, resetAddress } from "./disclose";
import { conversions as recordedConversions, description, fixture, vocabularyResponse } from "./fixtures";

const vocabulary = readVocabulary(vocabularyResponse());

/** Text of the page outside the api's answer as sent (which is JSON, as the api wrote it). */
function shownText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("pre.raw").forEach((pre) => {
    pre.remove();
  });
  const titles = [...clone.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "");
  const labels = [...clone.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label") ?? "");
  return `${clone.textContent} ${titles.join(" ")} ${labels.join(" ")}`;
}

afterEach(() => {
  cleanup();
  resetAddress();
});

function show(organism: string, name: string) {
  const recorded = fixture(organism, name);
  const result = JSON.parse(recorded.raw) as ConversionResult;
  const database = (recorded.query["final_database"] as string | undefined) ?? null;
  render(
    <VocabularyContext.Provider value={vocabulary}>
      <ResultView result={result} raw={recorded.raw} description={description(organism)} requestedDatabase={database} />
    </VocabularyContext.Provider>,
  );
  return result;
}

describe("ResultView", () => {
  it("states the best answer, the deciding criterion and every candidate", () => {
    const result = show("sus_scrofa", "convert_refseq_peptide_long");
    const best = result.candidates.find((c) => c.best);
    expect(best).toBeDefined();
    expect(screen.getAllByText(best?.target ?? "").length).toBeGreaterThan(0);
    openTab(/^Decision/);
    expect(screen.getAllByText("Decided by").length).toBeGreaterThan(0);
    const table = screen.getByRole("region", { name: "Candidates, ranked" });
    expect(within(table).getAllByRole("row")).toHaveLength(result.candidates.length + 1);
    // Each candidate's score as the api wrote it, beside the steps without a score that the criterion compares first.
    const rows = within(table).getAllByRole("row").slice(1);
    result.candidates.forEach((candidate, i) => {
      const text = rows[i]?.textContent ?? "";
      // History steps, cross-reference steps and unscored steps each in a column of its own, then the exact score.
      expect(text).toContain(pythonFloat(candidate.score));
      const cells = [...(rows[i]?.querySelectorAll("td") ?? [])].map((td) => td.getAttribute("data-label"));
      expect(cells).toEqual(expect.arrayContaining(["History steps", "Cross-reference steps", "Unscored steps"]));
    });
  });

  it("draws every step of the drawn candidates as a focusable element with the api's values", () => {
    const result = show("sus_scrofa", "convert_handoff_long");
    const drawing = screen.getByRole("group", { name: /^Path of/ });
    const buttons = within(drawing).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    // One tab stop: exactly one element of the drawing is in the tab order.
    expect(buttons.filter((b) => b.getAttribute("tabindex") === "0")).toHaveLength(1);
    const steps = buttons.filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Step "));
    const drawn = new Set(result.candidates.slice(0, 10).flatMap((c) => [...c.path, ...c.final_path]));
    expect(steps.length).toBeGreaterThanOrEqual(Math.min(drawn.size, 1));
    // Arrow keys move along the elements; the tooltip shows the focused element's exact values.
    const first = buttons.find((b) => b.getAttribute("tabindex") === "0");
    if (!first) throw new Error("no tab stop");
    act(() => {
      first.focus();
    });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent.length).toBeGreaterThan(0);
    const focused = document.activeElement;
    expect(focused).not.toBe(first);
    expect(focused?.getAttribute("tabindex")).toBe("0");
  });

  it("reads the path in words, every candidate and step", () => {
    const result = show("homo_sapiens", "convert_tp53");
    fireEvent.click(screen.getByRole("radio", { name: "In words" }));
    const reading = screen.getByText("The path in words").closest(".reading");
    expect(reading).not.toBeNull();
    // One candidate's steps at a time, the best first: one row per step, in order.
    const items = reading?.querySelectorAll(".steps__row") ?? [];
    const best = result.candidates.find((c) => c.best);
    expect(items.length).toBe((best?.path.length ?? 0) + (best?.final_path.length ?? 0));
  });

  it("says why there is no answer in idtrack's words, the code quietly", () => {
    const result = show("sus_scrofa", "convert_not_found");
    expect(result.reason).toBe("not_in_graph");
    const headline = document.querySelector(".answer__headline");
    const meaning = vocabulary.reasons.get("not_in_graph") ?? "-";
    expect(headline?.textContent).toBe(`No answer: ${meaning.replace(/^The identifier/, "the identifier")}`);
    // The code in words, its meaning and the code itself on a press.
    expect(document.querySelector(".answer__codes .term")?.textContent).toBe("not in graph");
  });

  it("names the database that the best answer has no id in, and shows the gene as reached, not as the answer", () => {
    const result = show("sus_scrofa", "convert_reason_no_id_in_final_database");
    expect(result.no_target).toBe(true);
    const headline = document.querySelector(".answer__headline")?.textContent ?? "";
    expect(headline).toBe(`No HGNC Symbol for the best-ranked gene at release ${result.to_release}`);
    const reached = document.querySelector(".answer__reached")?.textContent ?? "";
    for (const c of result.candidates) expect(reached).toContain(c.gene);
    expect(document.querySelector(".answer__targets")).toBeNull();
    // One statement: the idtrack reason text is not repeated as a sentence; its code is there, its meaning on focus.
    expect(document.body.textContent).not.toContain(vocabulary.reasons.get("no_id_in_final_database") ?? "-");
    const term = document.querySelector<HTMLButtonElement>(".answer__codes .term button");
    expect(term?.textContent).toBe("no id in final database");
    if (term) fireEvent.click(term);
    expect(document.querySelector(".answer__codes .term")?.textContent).toContain(
      prose(vocabulary.reasons.get("no_id_in_final_database") ?? "-").replace(/`/g, ""),
    );
  });

  it.each([
    ["sus_scrofa", "convert_refseq_peptide_long"],
    ["sus_scrofa", "convert_decided_by_annotation"],
    ["sus_scrofa", "convert_reason_no_id_in_final_database"],
    ["homo_sapiens", "convert_tp53"],
    ["homo_sapiens", "convert_kind_identity_long"],
  ])("%s/%s: no value is written in a programming language's spelling", (organism, name) => {
    show(organism, name);
    expect(shownText()).not.toMatch(/\b(None|True|False|null|undefined|NaN)\b/);
    expect(shownText()).not.toMatch(/[^-]\b(true|false)\b/);
  });

  it("states the deciding criterion with idtrack's text and the pair's values, a tuple by its named parts", () => {
    const result = show("sus_scrofa", "convert_decided_by_annotation");
    expect(result.decided_by).toBe("annotation");
    openTab(/^Decision/);
    const decision = document.querySelector(".decision")?.textContent ?? "";
    const meaning = vocabulary.criteria.find((c) => c.code === "annotation")?.meaning ?? "-";
    expect(decision).toContain(prose(meaning).replace(/`/g, ""));
    const runnerUp = result.candidates.find((c) => !c.best)?.annotation;
    expect(runnerUp).toBeTruthy();
    const [ids, transcripts, translations] = (runnerUp ?? []).map((v) => String(-v));
    expect(decision).toContain(`external ids ${ids}, transcripts ${transcripts}, translations ${translations}`);
    expect(document.querySelector(".decision__fallback")).toBeNull();
    expect(document.querySelector(".decision__rule")?.textContent).toBe(
      "annotation: more external ids, then transcripts, then translations rank first.",
    );
  });

  it("names every reason, and what the reasons add to an answer with targets", () => {
    const entry = recordedConversions().find(
      ({ result }) => result.candidates.some((c) => c.best) && result.reasons.length && !result.no_target,
    );
    expect(entry).toBeDefined();
    if (!entry) return;
    show(entry.entry.organism, entry.entry.name);
    // A reason the evidence marks say is one of them; any other is a note in idtrack's words, its code beside.
    const notes = document.querySelector(".answer__notes")?.textContent ?? "";
    const evidence = document.querySelector(".answer__cautions")?.textContent ?? "";
    for (const code of entry.result.reasons) {
      if (code === "read_at_another_release")
        expect(evidence).toContain(`read at release ${entry.result.from_release}`);
      else expect(notes).toContain((vocabulary.reasons.get(code) ?? code).replace(/`/g, ""));
    }
  });

  it("lists the other readings with why each is reported and what it answers", () => {
    const result = show("homo_sapiens", "convert_other_release_rnr1");
    expect(result.other_readings.length).toBeGreaterThan(0);
    openTab("Reading");
    const table = screen.getByRole("region", { name: "Other readings of the identifier" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(result.other_readings.length);
    result.other_readings.forEach((reading, i) => {
      const text = rows[i]?.textContent ?? "";
      expect(text).toContain(reading.reason.replace(/_/g, " "));
      for (const gene of reading.genes) expect(text).toContain(gene);
      for (const release of reading.releases) expect(text).toContain(String(release));
    });
  });

  it("lists every bridge the search considered, the chosen path's first and the refused on a press", () => {
    const entry = recordedConversions().find(
      ({ result }) => result.path?.bridges.some((b) => b.taken) && result.path.bridges.some((b) => !b.taken),
    );
    expect(entry).toBeDefined();
    if (!entry?.result.path) return;
    const bridges = entry.result.path.bridges;
    show(entry.entry.organism, entry.entry.name);
    openTab("Reading");
    expand(/^The bridges the search considered/);
    // Every list is bounded: the rest of each verdict, and every id a bridge shares, on a press.
    const refused = bridges.filter((b) => !b.taken).length;
    fireEvent.click(screen.getByRole("button", { name: `Show the ${refused} refused` }));
    for (const button of screen.queryAllByRole("button", { name: /^Show all \d+$/ })) fireEvent.click(button);
    for (const button of screen.queryAllByRole("button", { name: /^and \d+ more$/ })) fireEvent.click(button);
    const rows = [
      ...within(screen.getByRole("region", { name: "Bridges taken, one row per pair of genes" })).getAllByRole("row"),
      ...within(screen.getByRole("region", { name: "Bridges refused, one row per pair of genes" })).getAllByRole("row"),
    ].filter((row) => row.closest("tbody"));
    expect(rows).toHaveLength(bridges.length);
    const label = (id: string) => entry.result.path?.nodes.find((n) => n.id === id)?.label ?? id;
    for (const bridge of bridges) {
      const row = rows.find((r) => {
        const cells = r.querySelectorAll("td");
        return cells[0]?.textContent === label(bridge.source) && cells[1]?.textContent.startsWith(label(bridge.target));
      });
      expect(row).toBeDefined();
      const text = row?.textContent ?? "";
      expect(text).toContain(bridge.places.replace(/_/g, " "));
      expect(text).toContain(bridge.taken ? "yes" : "no");
      for (const [, rule] of bridge.through) expect(text).toContain(rule.replace(/_/g, " "));
    }
    // The taken come first, in the natural order of their ids, the chosen path's first.
    const taken = rows.slice(0, bridges.filter((b) => b.taken).length);
    expect(taken.every((r) => r.textContent.includes("yes"))).toBe(true);
  });

  it("lists the history steps the search did not follow, each with its rule", () => {
    // No recorded answer refuses a step (idtrack refuses only a step between the mitochondrial genome and a nuclear
    // sequence): one of a recorded answer's history steps stands in for one, as the api would send it.
    const recorded = fixture("homo_sapiens", "convert_handoff");
    const result = JSON.parse(recorded.raw) as ConversionResult;
    const history = result.path?.steps.find((step) => step.kind === "history");
    expect(history).toBeDefined();
    if (!result.path || !history) return;
    const refused = { ...history, reason: "mitochondrial_genome" as const };
    render(
      <VocabularyContext.Provider value={vocabulary}>
        <ResultView
          result={{ ...result, path: { ...result.path, refused: [refused] } }}
          raw={recorded.raw}
          description={description("homo_sapiens")}
          requestedDatabase={null}
        />
      </VocabularyContext.Provider>,
    );
    openTab("Reading");
    expand(/^Steps not followed/);
    const items = document.querySelectorAll(".result__refused li");
    expect(items).toHaveLength(1);
    const text = items[0]?.textContent ?? "";
    expect(text).toContain(`${history.old_release ?? ""} → ${history.new_release ?? ""}`);
    expect(text).toContain("Refused: mitochondrial genome");
    expect(text).toContain(prose(vocabulary.stepReasons.get("mitochondrial_genome") ?? "-").replace(/`/g, ""));
  });

  it.each([
    ["sus_scrofa", "convert_split_no_target"],
    ["homo_sapiens", "convert_split_no_target"],
  ])("%s/%s: a split whose best answer has no id states the absence for the best answer only", (organism, name) => {
    const result = show(organism, name);
    expect(result.status).toBe("no_target");
    expect(document.querySelector(".answer__targets")).toBeNull();
    const best = result.candidates.filter((c) => c.best).map((c) => c.gene);
    const others = result.candidates.filter((c) => !c.best).map((c) => c.gene);
    expect(others.length).toBeGreaterThan(0);
    const database = String(fixture(organism, name).query["final_database"]);
    const headline = document.querySelector(".answer__headline")?.textContent ?? "";
    expect(headline).toBe(
      `No ${database} for ${best.length === 1 ? "the best-ranked gene" : "the genes of the best answer"} at release ${result.to_release}`,
    );
    // The best answer is named as such; no sentence says the other genes lack an id.
    const reached = document.querySelector(".answer__reached")?.textContent ?? "";
    for (const gene of best) expect(reached).toContain(gene);
    for (const gene of others) expect(reached).not.toContain(gene);
    expect(document.body.textContent).not.toMatch(/none has|these genes/);
    // The other genes: not looked up, each a link that converts it to the database at the target release.
    const box = document.querySelector(".answer__others");
    expect(box?.textContent).toContain("not looked up");
    const links = [...(box?.querySelectorAll(".answer__other-genes a") ?? [])];
    expect(links.map((a) => a.textContent.split(" ")[0])).toEqual(others);
    for (const [i, link] of links.entries()) {
      const url = new URL(link.getAttribute("href") ?? "", "http://x");
      expect(url.searchParams.get("id")).toBe(others[i]);
      expect(url.searchParams.get("to")).toBe(String(result.to_release));
      expect(url.searchParams.get("db")).toBe(database);
    }
    // idtrack's own sentence of its limitation on splits, as the generated list holds it.
    const limitation = document.querySelector(".answer__limitation")?.textContent ?? "";
    expect(limitation).toContain((splitLimitation() ?? "-").replace(/`/g, ""));
  });

  it("finds idtrack's limitation on splits in the generated list", () => {
    expect(splitLimitation()).toMatch(/^A gene whose history splits/);
  });

  it("lists the versions the graph holds for an unknown version", () => {
    const result = show("sus_scrofa", "convert_unknown_version");
    for (const version of result.known_versions) expect(screen.getAllByText(version).length).toBeGreaterThan(0);
  });

  it("compares the best answer and the runner-up criterion by criterion, in idtrack's order", () => {
    const result = show("sus_scrofa", "convert_decided_by_annotation");
    const best = result.candidates.find((c) => c.best);
    const runner = result.candidates.find((c) => !c.best);
    if (!best || !runner) throw new Error("no pair");
    openTab(/^Decision/);
    const rows = [...document.querySelectorAll(".compare tbody tr")];
    expect(rows).toHaveLength(vocabulary.criteria.length);
    const at = vocabulary.criteria.findIndex((c) => c.code === result.decided_by);
    vocabulary.criteria.forEach((criterion, i) => {
      const row = rows[i];
      const cells = [...(row?.querySelectorAll("td") ?? [])].map((td) => td.textContent);
      expect(row?.querySelector("th")?.textContent).toContain(criterion.code.replace(/_/g, " "));
      expect(cells[1]).toBe(criterionValue(criterion, best).text);
      expect(cells[2]).toBe(criterionValue(criterion, runner).text);
      const state = cells[3] ?? "";
      if (i < at) expect(state).toBe("equal");
      else if (i === at) expect(state).toContain("decides");
      else expect(state).toBe("not compared");
    });
  });

  it("keeps the verdict on the surface and each part of the answer behind its tab, one drawn at a time", () => {
    const result = show("homo_sapiens", "convert_handoff_long");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs[0]).toMatch(/^Path/);
    expect(tabs).toEqual(expect.arrayContaining([expect.stringMatching(/^Decision/), "Reading", "Record"]));
    // The Decision tab carries the count of candidates; only the chosen panel is drawn.
    expect(screen.getByRole("tab", { name: /^Decision/ }).textContent).toContain(String(result.candidates.length));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    // The anatomy (read, walked, ranked, answered) is the record's, stage by stage.
    openTab("Record");
    expect(document.querySelectorAll(".anatomy__stage")).toHaveLength(4);
    expect(document.querySelector(".answer__facts")).not.toBeNull();
    // No lettered panels: the tabs order the answer.
    expect(document.querySelectorAll(".figure-panel__head .panel-letter")).toHaveLength(0);
  });

  it("opens a candidate's whole ranking record, every criterion in idtrack's order", () => {
    const result = show("sus_scrofa", "convert_refseq_peptide_long");
    const first = result.candidates[0];
    if (!first) throw new Error("no candidate");
    openTab(/^Decision/);
    const toggle = screen.getAllByRole("button", { name: /^Show the ranking record of candidate 1/ })[0];
    if (!toggle) throw new Error("no toggle");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = [...document.querySelectorAll(".record__grid:not(.record__grid--more) .record__item")];
    expect(items.map((i) => i.querySelector("dd")?.textContent)).toEqual(
      vocabulary.criteria.map((c) => criterionValue(c, first).text),
    );
  });

  it("shows the api's answer as sent", () => {
    const recorded = fixture("sus_scrofa", "convert_symbol_ins");
    show("sus_scrofa", "convert_symbol_ins");
    openTab("Record");
    expand(/^The api's answer, as sent/);
    const pre = document.querySelector("pre.raw");
    expect(pre?.textContent).toBe(recorded.raw);
  });
});

describe("ErrorPanel", () => {
  it("shows the code, the message, what to change, the accepted values and the request id", () => {
    const body = (JSON.parse(fixture("sus_scrofa", "error_unknown_release").raw) as { error: ErrorBody }).error;
    render(
      <VocabularyContext.Provider value={vocabulary}>
        <ErrorPanel error={new ApiError(400, body, null)} />
      </VocabularyContext.Provider>,
    );
    expect(screen.getByText("unknown_release")).toBeTruthy();
    // The message reads as prose: its code spans are set as code, not shown with their backticks.
    expect(document.querySelector(".notice__prose")?.textContent).toBe(body.message.replace(/`/g, ""));
    expect(document.querySelector(".notice__prose code")?.textContent).toBe("to_release");
    expect(document.querySelector("h2.notice__title")).toBeTruthy();
    expect(document.querySelector(".notice__title")?.textContent).toBe(vocabulary.errors.get("unknown_release")?.title);
    expect(screen.getByText(body.request_id)).toBeTruthy();
    expect(screen.getByText(/56 to 115 \(60 values\)/)).toBeTruthy();
  });

  it("lists every problem of an invalid request that its message does not already say", () => {
    const body = (JSON.parse(fixture("sus_scrofa", "error_batch_type").raw) as { error: ErrorBody }).error;
    render(<ErrorPanel error={new ApiError(400, body, null)} />);
    const said = document.querySelector(".notice__prose")?.textContent ?? "";
    for (const detail of body.details ?? []) {
      if (body.message.includes(detail.message)) {
        expect(said).toContain(detail.message);
        expect(screen.queryByText(detail.location.join("."))).toBeNull();
      } else expect(screen.getByText(detail.location.join("."))).toBeTruthy();
    }
    const extra = {
      ...body,
      message: "The request is not valid.",
      details: [{ location: ["body", "identifiers"], message: "Input should be a valid list" }],
    };
    cleanup();
    render(<ErrorPanel error={new ApiError(400, extra, null)} />);
    expect(screen.getByText("body.identifiers")).toBeTruthy();
  });

  it("counts a refusal's wait down on its button, which is pressed only when the wait is over", () => {
    vi.useFakeTimers();
    try {
      const body = {
        code: "rate_limited" as const,
        message: "Too many requests.",
        argument: null,
        allowed: null,
        details: null,
        request_id: "r",
      };
      let tried = 0;
      render(<ErrorPanel error={new ApiError(429, body, 3)} onRetry={() => (tried += 1)} />);
      const button = screen.getByRole("button", { name: /Try again in 3 s/ });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      const ready = screen.getByRole("button", { name: "Try again" });
      expect((ready as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(ready);
      expect(tried).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says that the browser is offline, apart from a server that does not answer", () => {
    render(<ErrorPanel error={new UnreachableError("offline", null, true)} />);
    expect(screen.getByRole("heading", { name: "The browser is offline" })).toBeTruthy();
  });

  it("tells an unreachable api apart and offers to try again", () => {
    let tried = 0;
    render(<ErrorPanel error={new UnreachableError("down")} onRetry={() => (tried += 1)} />);
    expect(screen.getByText("The api cannot be reached")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(tried).toBe(1);
  });
});
