// Convert many identifiers at once: paste or upload a list, read the answer as a figure (what came back, then the
// results one row per identifier), export it exactly as the api returned it.
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
  type SyntheticEvent,
} from "react";
import { api, ApiError } from "../api/client";
import type { BatchRequest, ConversionResult, GraphDescription } from "../api/types";
import { BatchInference } from "../components/BatchInference";
import { BatchResults, type BatchAnswer } from "../components/BatchResults";
import { ErrorPanel } from "../components/ErrorPanel";
import { Button, Field, Link, Mono, Select, Skeleton, Switch, TextInput } from "../components/ui";
import { Expandable } from "../components/v2/Expandable";
import { HoverCard } from "../components/v2/HoverCard";
import { announce } from "../lib/announce";
import {
  BATCH_TEXT_DRAFT,
  decodeFile,
  linesWithControls,
  normalizeLines,
  parseTable,
  SEPARATOR_WORDS,
  type TableChoice,
} from "../lib/batchList";
import { exampleKind, exampleSets, exampleWords, listPlaceholder, type ExampleSet } from "../lib/batchExamples";
import type { InferredRelease } from "../lib/batchExport";
import { markSeen, retryBatch, startBatch, useBatchRun, useOtherRuns } from "../lib/batchRun";
import { useShowcase } from "../lib/showcase";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { limitationAt, LIMITATION_OF } from "../lib/evidence";
import { isRecord, isText, readDraft, writeDraft } from "../lib/drafts";
import { revealArea, useFocusMove } from "../lib/focus";
import { groupedInteger } from "../lib/numbers";
import { batchSentence } from "../lib/outcomes";
import { organismName } from "../lib/organismNames";
import { useOrganisms } from "../lib/organisms";
import { useRequest } from "../lib/useRequest";
import { useLimits } from "../lib/vocabularyContext";
import { href } from "../lib/router";
import "../styles/tables.css";

/** A list longer than this many characters is read only once typing pauses (a few hundred ms), and kept for the
 *  session then too: reading a list of tens of thousands of lines at every key would hold the page. */
const LARGE_TEXT = 60_000;
/** An insertion of more lines than this at once (a dictated or dropped list) is put in by the page: the browser's own
 *  editing of a text area takes seconds over a thousand lines inserted as typed text. */
const LARGE_INSERT_LINES = 200;

/** The page's head: the same in every state, and drawn into the page the server sends before the code runs
 *  (scripts/prerender.ts). */
export function BatchHead() {
  return (
    <header className="page-head">
      <h1>Many identifiers, one setting</h1>
      <p className="lede">Every identifier is converted with one setting, by the rules of a single conversion.</p>
    </header>
  );
}

export function BatchPage() {
  const { current } = useOrganisms();
  if (!current) return null;
  return <BatchForOrganism key={current.organism} description={current} />;
}

/** The setting of a batch on one graph, kept per organism (releases and databases belong to a graph). */
interface Settings {
  fromRelease: string;
  toRelease: string;
  finalDatabase: string;
  fromDatabase: string;
  allowBridges: boolean;
}
const NO_SETTINGS: Settings = {
  fromRelease: "",
  toRelease: "",
  finalDatabase: "",
  fromDatabase: "",
  allowBridges: true,
};

const isSettings = (value: unknown): value is Settings =>
  isRecord(value) &&
  ["fromRelease", "toRelease", "finalDatabase", "fromDatabase"].every((k) => typeof value[k] === "string") &&
  typeof value["allowBridges"] === "boolean";

/** The text as typed, and the text read: the same text a render later (typing never waits on reading), or for a
 *  very long text once typing pauses. */
function useSettledText(text: string): string {
  const deferred = useDeferredValue(text);
  const [settled, setSettled] = useState(text);
  const large = text.length > LARGE_TEXT;
  useEffect(() => {
    if (!large) return;
    const timer = window.setTimeout(() => {
      setSettled(text);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, large]);
  return large ? settled : deferred;
}

/** What the page asks of the list field: set its text (an example, a file), read it as typed now, keep it for the
 *  session at once, focus it. */
interface ListHandle {
  set: (value: string) => void;
  value: () => string;
  keep: () => void;
  focus: () => void;
}

/** The list as typed: its own state, so that a keystroke draws the field alone and never the page around it (a list
 *  of tens of thousands of lines, a thousand results below); the page reads it a render later, or for a very long text
 *  once typing pauses (`onSettled`), and kept for the session as it is typed (a very long one once typing pauses, and
 *  when the page goes). */
const ListText = memo(function ListText({
  id,
  describedBy,
  invalid,
  placeholder,
  onSettled,
  onEdit,
  ref,
}: {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  placeholder: string;
  onSettled: (text: string) => void;
  /** Told of an edit, where the page has a problem to clear. */
  onEdit: (() => void) | undefined;
  ref: Ref<ListHandle>;
}) {
  const [text, setTextState] = useState(() => readDraft(BATCH_TEXT_DRAFT, isText) ?? "");
  const field = useRef<HTMLTextAreaElement>(null);
  const pendingDraft = useRef<string | null>(null);
  const keepText = useCallback(() => {
    if (pendingDraft.current === null) return;
    writeDraft(BATCH_TEXT_DRAFT, pendingDraft.current === "" ? undefined : pendingDraft.current);
    pendingDraft.current = null;
  }, []);
  useEffect(() => keepText, [keepText]);
  const setText = useCallback(
    (value: string) => {
      setTextState(value);
      pendingDraft.current = value;
      if (value.length <= LARGE_TEXT) keepText();
    },
    [keepText],
  );
  useEffect(() => {
    if (text.length <= LARGE_TEXT) return;
    const timer = window.setTimeout(keepText, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text, keepText]);
  const settled = useSettledText(text);
  useEffect(() => {
    onSettled(settled);
  }, [settled, onSettled]);
  useImperativeHandle(
    ref,
    () => ({
      set: setText,
      value: () => field.current?.value ?? text,
      keep: keepText,
      focus: () => field.current?.focus(),
    }),
    [setText, keepText, text],
  );
  // A large insertion as typed text (dictation, a drop, an automated fill) is put in by the page, at the selection.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (caret.current === null || !element) return;
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const edited = useRef(onEdit);
  useEffect(() => {
    edited.current = onEdit;
  });
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const insert = (event: InputEvent) => {
      if (!["insertText", "insertReplacementText", "insertFromDrop"].includes(event.inputType)) return;
      const data = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      let lines = 0;
      for (let i = data.indexOf("\n"); i >= 0 && lines <= LARGE_INSERT_LINES; i = data.indexOf("\n", i + 1)) lines++;
      if (lines <= LARGE_INSERT_LINES) return;
      event.preventDefault();
      const value = element.value;
      const next = value.slice(0, element.selectionStart) + data + value.slice(element.selectionEnd);
      caret.current = element.selectionStart + data.length;
      setTextState(next);
      pendingDraft.current = next;
      edited.current?.();
    };
    element.addEventListener("beforeinput", insert);
    return () => {
      element.removeEventListener("beforeinput", insert);
    };
  }, []);
  return (
    <textarea
      id={id}
      ref={field}
      className="input input--mono textarea batch-form__textarea"
      rows={8}
      value={text}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      aria-describedby={describedBy}
      aria-invalid={invalid}
      aria-required="true"
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        edited.current?.();
      }}
    />
  );
});

function BatchForOrganism({ description }: { description: GraphDescription }) {
  const organism = description.organism;
  const limits = useLimits();
  const settingsKey = `batch.settings.${organism}`;
  const list = useRef<ListHandle>(null);
  // The list as the page reads it: the text a render after it is typed (ListText).
  const [typed, setTyped] = useState(() => readDraft(BATCH_TEXT_DRAFT, isText) ?? "");
  const [choice, setChoice] = useState<TableChoice>(() => readDraft("batch.table", isChoice) ?? {});
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => readDraft(settingsKey, isSettings) ?? NO_SETTINGS);
  const [problem, setProblem] = useState<string | null>(null);
  // The release read at as IDTrack's source inference of the list gave it, while the form holds that release.
  const [inferred, setInferred] = useState<InferredRelease | null>(null);
  // The setting folds under one line that says it; it opens where one of its values is refused.
  const [settingOpen, setSettingOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLElement>(null);
  const setText = (value: string) => {
    list.current?.set(value);
    setTyped(value);
  };
  const clearProblem = useCallback(() => {
    setProblem(null);
  }, []);
  const choose = (next: TableChoice) => {
    setChoice(next);
    writeDraft("batch.table", next);
  };
  const setting =
    <K extends keyof Settings>(name: K) =>
    (value: Settings[K]) => {
      setSettings((current) => {
        const next = { ...current, [name]: value };
        writeDraft(settingsKey, next);
        return next;
      });
    };
  const { fromRelease, toRelease, finalDatabase, fromDatabase, allowBridges } = settings;
  const setFromRelease = setting("fromRelease");
  const setToRelease = setting("toRelease");
  const setFinalDatabase = setting("finalDatabase");
  const setFromDatabase = setting("fromDatabase");
  const setAllowBridges = setting("allowBridges");
  const table = useMemo(() => parseTable(typed, choice), [typed, choice]);
  const identifiers = table.identifiers;
  const distinct = useMemo(() => new Set(identifiers).size, [identifiers]);
  const toNumber = /^\d+$/.test(toRelease.trim()) ? Number(toRelease.trim()) : null;
  const finals = useRequest(`${organism}:${toNumber ?? "snapshot"}`, (signal, fresh) =>
    api.finalDatabases(organism, toNumber, { signal, fresh }),
  );
  const finalOptions =
    finals.state === "done"
      ? sortDatabases(finals.answer.data.final_databases)
      : sortDatabases(description.final_databases);
  const showcase = useShowcase(organism);
  const shown = showcase.state === "done" ? showcase.answer.data : null;
  const examples = useMemo(() => exampleSets(shown), [shown]);
  const placeholder = useMemo(() => listPlaceholder(shown), [shown]);

  // The organism's batch: held by lib/batchRun.ts, so that it goes on while another page is shown and is kept for the
  // session once, when its answer comes.
  const batch = useBatchRun(organism);
  const run = batch.run;
  const others = useOtherRuns(organism);
  // A batch the person started on this page: said in one sentence, its results brought into view and focused.
  const followed = useRef<number | null>(null);
  const moveFocus = useFocusMove();
  useEffect(() => {
    if (run.state === "done") markSeen(organism);
    if (followed.current !== batch.id || (run.state !== "done" && run.state !== "failed")) return;
    followed.current = null;
    if (run.state === "done") announce(batchSentence(run.answer.data.results));
    // Focus on the figure's first heading (panel a), the results' head above it brought to the top of the window.
    moveFocus(() => area.current, '#batch-summary, [role="alert"] .notice__title');
    // The results' head at the top of the window, so that the answers come first (on a phone too).
    window.requestAnimationFrame(() => {
      const head = area.current;
      if (!head) return;
      const top = head.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.25 || top < 0)
        head.scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
    });
  }, [batch.id, run, organism, moveFocus]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (file.size > 4 * 1024 * 1024) {
      setFileNote(
        `${file.name} is ${groupedInteger(file.size)} bytes; a list of identifiers is far smaller. Choose a text file with one identifier per line.`,
      );
      return;
    }
    file.arrayBuffer().then(
      (buffer) => {
        const decoded = decodeFile(buffer);
        if (!decoded.ok) {
          setFileNote(`${file.name} ${decoded.problem}`);
          return;
        }
        const content = normalizeLines(decoded.text);
        setText(content);
        choose({});
        const read = parseTable(content);
        const n = read.identifiers.length;
        const garbled =
          decoded.encoding === "windows-1252" ? read.identifiers.filter((id) => /[^\x20-\x7e]/.test(id)).length : 0;
        const encoding =
          decoded.encoding === "windows-1252"
            ? garbled
              ? ` It is not UTF-8, so it was read as Windows-1252, and ${groupedInteger(garbled)} identifier${garbled === 1 ? " holds" : "s hold"} letters outside plain ASCII: if they look garbled, the file is in another encoding. Save it as UTF-8 and upload it again.`
              : " It is not UTF-8, so it was read as Windows-1252."
            : decoded.encoding === "UTF-8"
              ? ""
              : ` It was read as ${decoded.encoding}, as its first bytes say.`;
        const header = read.header ? ` Its first line was taken as the header (${read.header.join(", ")}).` : "";
        setFileNote(`Read ${file.name}: ${groupedInteger(n)} identifier${n === 1 ? "" : "s"}.${header}${encoding}`);
      },
      () => {
        setFileNote(`${file.name} could not be read.`);
      },
    );
  };

  // A list over the server's bound whose different identifiers fit it is sent once per different identifier, and each
  // answer drawn at every place of its identifier (the api answers a repeated identifier alike at each place, a copy
  // too: the items of a batch are the same set). A list of more different identifiers than the bound is refused.
  const over = limits !== null && distinct > limits.batch_max;
  const onceEach = limits !== null && !over && identifiers.length > limits.batch_max;
  const overWords = limits
    ? `The list has ${groupedInteger(distinct)} different identifiers; this server converts at most ${groupedInteger(limits.batch_max)} per request. The page does not split a list: a batch's answers can depend on its members (an item that is another item with a separator and a number appended, -1, .2 or _3, is read as that item's copy), and the server's bound is its own. To convert more, use IDTrack's convert_many in Python, which takes a list of any length, or the http api in requests of at most ${groupedInteger(limits.batch_max)}, keeping each name with its copies in one request (API page).`
    : "";
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (run.state === "loading") return;
    // The list as typed now (the reading may be a render behind).
    const now = parseTable(list.current?.value() ?? typed, choice);
    if (!now.identifiers.length) {
      setProblem("Paste or upload at least one identifier.");
      list.current?.focus();
      return;
    }
    const different = [...new Set(now.identifiers)];
    if (limits && different.length > limits.batch_max) {
      setProblem(overWords);
      list.current?.focus();
      return;
    }
    const lines = linesWithControls(now.identifiers);
    if (lines.length) {
      const shownLines = lines
        .slice(0, 10)
        .map((k) => now.rows[k - 1]?.line ?? k)
        .join(", ");
      setProblem(
        `${groupedInteger(lines.length)} line${lines.length === 1 ? " holds" : "s hold"} a control character, which the api refuses for the whole batch: line${lines.length === 1 ? "" : "s"} ${shownLines}${lines.length > 10 ? " …" : ""} of the list. Remove ${lines.length === 1 ? "it" : "them"} and convert again.`,
      );
      list.current?.focus();
      return;
    }
    for (const value of [fromRelease, toRelease]) {
      if (value.trim() !== "" && !/^\d+$/.test(value.trim())) {
        setProblem("A release is a whole number.");
        setSettingOpen(true);
        return;
      }
    }
    setProblem(null);
    list.current?.keep();
    // Over the bound by repeats alone: each different identifier once, its answer drawn at each of its places.
    const sendOnce = limits !== null && now.identifiers.length > limits.batch_max;
    const place = new Map(different.map((id, i) => [id, i]));
    const body: Required<BatchRequest> = {
      identifiers: sendOnce ? different : now.identifiers,
      from_release: fromRelease.trim() ? Number(fromRelease.trim()) : null,
      to_release: toRelease.trim() ? Number(toRelease.trim()) : null,
      final_database: finalDatabase || null,
      from_database: fromDatabase || null,
      explain: true,
      allow_bridges: allowBridges,
      read_copies: true,
    };
    announce(`Converting ${groupedInteger(now.identifiers.length)} identifiers…`);
    followed.current = startBatch(organism, body, {
      separator: now.separator,
      header: now.header,
      column: now.column,
      rows: now.rows,
      inferred: inferred && fromRelease.trim() === String(inferred.release) ? inferred : null,
      places: sendOnce ? now.identifiers.map((id) => place.get(id) ?? 0) : null,
    });
    window.requestAnimationFrame(() => {
      revealArea(area.current);
    });
  };
  const takeExample = (set: ExampleSet) => {
    setText(set.identifiers.join("\n"));
    choose({});
    setSettings((current) => {
      const next = {
        ...current,
        fromRelease: set.from === null ? "" : String(set.from),
        toRelease: set.to === null ? "" : String(set.to),
        finalDatabase: set.database ?? "",
      };
      writeDraft(settingsKey, next);
      return next;
    });
    setFileNote(
      `An example: ${groupedInteger(set.identifiers.length)} identifiers of the Convert page's first figure, with its settings (${exampleWords(set, description.snapshot_release)}).`,
    );
  };
  // The answer drawn below, the same object while the run is the same: typing in the form never draws the results again.
  const answer = useMemo(
    (): BatchAnswer | null =>
      run.state === "done"
        ? {
            results: expand(run.answer.data.results, batch.source?.places ?? null),
            count: batch.source?.places?.length ?? run.answer.data.count,
            request: run.request,
            raw: run.answer.raw,
            serverTiming: run.answer.serverTiming,
            requestId: run.answer.requestId,
            answeredAt: run.answeredAt || null,
            source: batch.source,
            pathsRefused: batch.pathsRefused,
          }
        : null,
    [run, batch.source, batch.pathsRefused],
  );
  // The list read at the release IDTrack's source inference gives it, from the answer's line: the same batch asked
  // again at that release, which the form then holds too.
  const latest = useRef({ run, source: batch.source, setFromRelease });
  useEffect(() => {
    latest.current = { run, source: batch.source, setFromRelease };
  });
  const readAt = useCallback(
    (next: InferredRelease) => {
      const { run: last, source, setFromRelease: setFrom } = latest.current;
      if (last.state !== "done") return;
      setFrom(String(next.release));
      setInferred(next);
      announce(
        `Converting ${groupedInteger(last.request.identifiers.length)} identifiers at release ${String(next.release)}…`,
      );
      followed.current = startBatch(
        organism,
        { ...last.request, from_release: next.release, explain: true },
        source ? { ...source, inferred: next } : null,
      );
      window.requestAnimationFrame(() => {
        revealArea(area.current);
      });
    },
    [organism, setInferred],
  );
  const settingWords = [
    `${fromRelease.trim() ? `from ${fromRelease.trim()}` : "each from its own release"} to ${toRelease.trim() || String(description.snapshot_release)}`,
    finalDatabase ? databaseLabel(finalDatabase) : "Ensembl gene",
    ...(fromDatabase ? [`read in ${databaseLabel(fromDatabase)}`] : []),
    ...(allowBridges ? [] : ["no bridges"]),
  ].join(" · ");
  const synonyms = new Set(description.synonym_databases);
  const sources = description.external_databases;
  const otherRelease = limitationAt(LIMITATION_OF.other_release);

  return (
    <div className="page page--batch">
      <BatchHead />
      <form className="panel batch-form" onSubmit={submit} noValidate aria-label="Batch conversion">
        <div className="batch-form__list">
          <Field
            label="Identifiers"
            error={problem}
            hint={
              <>
                One per line, or a table pasted from a spreadsheet (tab, comma or semicolon between its cells); a text,
                TSV or CSV file is read the same way.{" "}
                {limits ? (
                  <>
                    This server takes at most {groupedInteger(limits.batch_max)} per request, each of at most{" "}
                    {groupedInteger(limits.identifier_max_length)} characters.
                  </>
                ) : null}
              </>
            }
          >
            {({ id, describedBy }) => (
              <ListText
                ref={list}
                id={id}
                describedBy={describedBy}
                invalid={Boolean(problem)}
                placeholder={placeholder}
                onSettled={setTyped}
                onEdit={problem ? clearProblem : undefined}
              />
            )}
          </Field>
          <div className="batch-form__under">
            <div className="batch-form__meter" aria-hidden={identifiers.length === 0}>
              <span className={`batch-form__count ${over ? "is-over" : ""}`}>
                <span className="mono">{groupedInteger(identifiers.length)}</span>
                {limits ? <span className="muted"> / {groupedInteger(limits.batch_max)}</span> : null}{" "}
                {identifiers.length === 1 ? "identifier" : "identifiers"}
                {identifiers.length && distinct !== identifiers.length ? (
                  <span className="muted">
                    {" "}
                    · <span className="mono">{groupedInteger(distinct)}</span> distinct
                  </span>
                ) : null}
              </span>
              {limits ? (
                <span className="batch-form__gauge" aria-hidden="true">
                  <span
                    className={`batch-form__gauge-fill ${over ? "is-over" : ""}`}
                    style={{ width: `${Math.min(100, (distinct / limits.batch_max) * 100)}%` }}
                  />
                </span>
              ) : null}
            </div>
            <div className="batch-form__file">
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.tsv,.csv,text/plain,text/csv,text/tab-separated-values"
                className="visually-hidden"
                id="batch-file"
                aria-label="A file of identifiers"
                onChange={onFile}
                tabIndex={-1}
              />
              <Button variant="quiet" className="batch-form__upload" onClick={() => fileInput.current?.click()}>
                Upload a file…
              </Button>
            </div>
          </div>
          <p className="batch-form__file-note" role="status">
            {fileNote}
          </p>
          {over && !problem ? <p className="batch-form__over">{overWords}</p> : null}
          {onceEach ? (
            <p className="batch-form__once">
              More identifiers than one request takes (<Mono>{groupedInteger(limits.batch_max)}</Mono>), but only{" "}
              <Mono>{groupedInteger(distinct)}</Mono> different ones: each is sent once, and its answer is drawn at
              every place of the list where it stands (the api answers a repeated identifier alike at each place).
            </p>
          ) : null}
          {table.separator !== null || table.header ? (
            <div className="batch-form__table" role="group" aria-label="How the table is read">
              <p className="batch-form__table-note">
                {table.separator !== null ? (
                  <>
                    A {SEPARATOR_WORDS[table.separator]}-separated table of {table.columns} column
                    {table.columns === 1 ? "" : "s"}: column <Mono>{table.column + 1}</Mono>
                    {table.header?.[table.column] ? (
                      <>
                        {" "}
                        (<Mono>{table.header[table.column]}</Mono>)
                      </>
                    ) : null}{" "}
                    is read
                  </>
                ) : (
                  <>One identifier per line</>
                )}
                {table.header ? (
                  <>
                    ; its first line is taken as the header
                    {choice.header === undefined || choice.header === null
                      ? table.detected?.kind === "space"
                        ? " (its cell holds a space, which no other line's does)"
                        : ` (the other lines of column ${String((table.detected?.column ?? 0) + 1)} hold ${table.detected?.kind === "ensembl" ? "Ensembl ids" : "numbers"}, it does not)`
                      : ""}
                  </>
                ) : null}
                . The table of one row per identifier keeps every column.
                {table.skipped.length ? (
                  <>
                    {" "}
                    {groupedInteger(table.skipped.length)} line{table.skipped.length === 1 ? " has" : "s have"} an empty
                    cell there and {table.skipped.length === 1 ? "is" : "are"} left out.
                  </>
                ) : null}
              </p>
              <div className="batch-form__table-controls">
                <Switch
                  checked={table.header !== null}
                  onChange={(value) => {
                    choose({ ...choice, header: value });
                  }}
                  label="First line is a header"
                />
                {table.columns > 1 ? (
                  <Field label="Column read" className="batch-form__column">
                    {({ id }) => (
                      <Select
                        id={id}
                        value={String(table.column)}
                        onChange={(e) => {
                          choose({ ...choice, column: Number(e.target.value) });
                        }}
                      >
                        {Array.from({ length: table.columns }, (_, c) => (
                          <option key={c} value={c}>
                            {`Column ${String(c + 1)}${table.header?.[c] ? `: ${table.header[c]}` : ""}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
              </div>
            </div>
          ) : null}
          {examples.length ? (
            <div className="batch-examples" role="group" aria-labelledby="batch-examples-label">
              <span className="batch-examples__label" id="batch-examples-label">
                Try
              </span>
              <ul className="batch-examples__list">
                {examples.map((set, k) => (
                  <li key={set.identifiers.join("|")}>
                    <HoverCard
                      trigger={exampleKind(set)}
                      triggerClassName="example batch-examples__set"
                      className="batch-examples__card"
                      describedBy={`batch-example-${String(k)}`}
                      onPress={() => {
                        takeExample(set);
                      }}
                    >
                      <span className="batch-examples__first mono">
                        {set.identifiers.slice(0, 3).join(", ")}
                        {set.identifiers.length > 3 ? ", …" : ""}
                      </span>
                      <span className="batch-examples__words">{exampleWords(set, description.snapshot_release)}</span>
                    </HoverCard>
                    <span id={`batch-example-${String(k)}`} hidden>
                      {`${set.identifiers.slice(0, 3).join(", ")}${set.identifiers.length > 3 ? ", …" : ""}; ${exampleWords(set, description.snapshot_release)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <Expandable
          className="batch-form__setting"
          summary="Setting for every identifier"
          meta={settingWords}
          expanded={settingOpen}
          onExpandedChange={setSettingOpen}
        >
          <div className="batch-form__settings">
            <div className="batch-form__pair">
              <Field
                label="From release"
                hint={
                  <>
                    For a dataset, the Ensembl release of its annotation (the release of its GTF, for instance). Empty:
                    each identifier is read at the release IDTrack infers for it alone, a symbol with its meaning there
                    {otherRelease ? (
                      <>
                        {" "}
                        (
                        <a href={otherRelease.href} target="_blank" rel="noreferrer">
                          {otherRelease.title}
                          <span className="visually-hidden"> (IDTrack&apos;s documentation, opens in a new tab)</span>
                          <span aria-hidden="true"> ↗</span>
                        </a>
                        )
                      </>
                    ) : null}
                    .
                  </>
                }
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    className="input--mono"
                    value={fromRelease}
                    placeholder="each at its own release"
                    aria-describedby={describedBy}
                    onChange={(e) => {
                      setFromRelease(e.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label="To release" hint={`Empty: the graph's last, ${description.snapshot_release}.`}>
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    className="input--mono"
                    value={toRelease}
                    placeholder={String(description.snapshot_release)}
                    aria-describedby={describedBy}
                    onChange={(e) => {
                      setToRelease(e.target.value);
                    }}
                  />
                )}
              </Field>
            </div>
            <BatchInference
              description={description}
              identifiers={identifiers}
              bound={limits?.batch_max ?? 1000}
              current={fromRelease}
              onUse={(next) => {
                setFromRelease(String(next.release));
                setInferred(next);
              }}
            />
            <div className="batch-form__pair">
              <Field
                label="Target database"
                hint="The database of the answers, among those of the target release. Every row also gives the Ensembl gene at that release."
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    value={finalDatabase}
                    aria-describedby={describedBy}
                    onChange={(e) => {
                      setFinalDatabase(e.target.value);
                    }}
                  >
                    <option value="">Ensembl gene (with version), the default</option>
                    <DatabaseGroups databases={finalOptions.filter((d) => d !== "ensembl_gene")} synonyms={synonyms} />
                  </Select>
                )}
              </Field>
              <Field
                label="Source database"
                hint="The database the identifiers are meant in. Empty: any. Ensembl lists some sources under two names (Vega gene and Vega_gene, for instance): each is a database of its own in Ensembl's tables."
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    value={fromDatabase}
                    aria-describedby={describedBy}
                    onChange={(e) => {
                      setFromDatabase(e.target.value);
                    }}
                  >
                    <option value="">Any database</option>
                    <DatabaseGroups databases={sources} synonyms={synonyms} />
                  </Select>
                )}
              </Field>
            </div>
            <Switch
              checked={allowBridges}
              onChange={setAllowBridges}
              label="Allow bridges"
              hint="Where Ensembl's history of a gene ends, continue to another gene through an id both carried: IDTrack's inference, not a record of Ensembl, marked in the results."
            />
          </div>
        </Expandable>
        <div className="batch-form__actions">
          <Button type="submit" variant="primary" disabled={run.state === "loading"}>
            {run.state === "loading"
              ? "Converting…"
              : `Convert ${identifiers.length ? groupedInteger(identifiers.length) : ""}`}
          </Button>
        </div>
      </form>

      {others.length ? (
        <ul className="batch-elsewhere" aria-label="Batches of other organisms">
          {others.map(({ organism: other, run: r }) => (
            <li key={other}>
              {r.run.state === "loading" ? (
                <>
                  A batch of <Mono>{groupedInteger(r.run.request.identifiers.length)}</Mono> identifiers of{" "}
                  <i>{organismName(other)}</i> is being converted; it is kept for that organism.{" "}
                </>
              ) : (
                <>
                  The batch of <i>{organismName(other)}</i> is done.{" "}
                </>
              )}
              <Link to={href("/batch", { organism: other })}>
                See it on the page of <i>{organismName(other)}</i>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="result-area" aria-busy={run.state === "loading"} aria-label="The results" ref={area}>
        {run.state === "idle" ? <EmptyBatch organism={organism} /> : null}
        {run.state === "loading" ? (
          <div className="result--loading" aria-label="Converting the list">
            <p className="batch-loading">
              Converting <Mono>{groupedInteger(run.request.identifiers.length)}</Mono> identifiers
              {run.request.explain ? ", with every path" : ", without the paths (the server would not send them)"}…
            </p>
            <Skeleton width="100%" height={36} className="skeleton--row" />
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} width="100%" height={28} className="skeleton--row" />
            ))}
          </div>
        ) : null}
        {run.state === "failed" ? (
          <>
            <ErrorPanel
              error={run.error}
              context="The batch"
              onRetry={() => {
                followed.current = batch.id + 1;
                retryBatch(organism);
              }}
              actions={
                run.request.explain &&
                run.error instanceof ApiError &&
                run.error.body.code === "request_budget_exceeded" &&
                batch.retry?.state !== "waiting" ? (
                  <Button
                    onClick={() => {
                      followed.current = batch.id + 1;
                      retryBatch(organism, true);
                    }}
                  >
                    Ask without the paths
                  </Button>
                ) : null
              }
            />
            {batch.retry ? (
              <p className="batch-retry" role="status">
                {batch.retry.state === "waiting"
                  ? "The batch is asked again by itself once, when the wait is over (while this tab is shown); after that, you decide."
                  : `The batch was asked again by itself at ${timeOf(batch.retry.at)}, after the wait the api named, and refused again: nothing more is asked until you try again${run.request.explain && run.error instanceof ApiError && run.error.body.code === "request_budget_exceeded" ? ", with the paths or without them" : ""}.`}
              </p>
            ) : null}
          </>
        ) : null}
        {run.state === "done" && answer ? (
          <BatchResults key={batch.id} description={description} answer={answer} onReadAt={readAt} />
        ) : null}
      </section>
    </div>
  );
}

/** The results at every place of the list, where each different identifier was sent once (`places`: for each place,
 *  the index of its identifier among those sent); else the results as they came. */
function expand(results: ConversionResult[], places: readonly number[] | null): ConversionResult[] {
  if (!places) return results;
  return places.flatMap((i) => {
    const result = results[i];
    return result ? [result] : [];
  });
}

/** A time of day as the browser's clock writes it, to the second (`17:02:11`). */
const timeOf = (iso: string) => new Date(iso).toTimeString().slice(0, 8);

const isChoice = (value: unknown): value is TableChoice =>
  isRecord(value) &&
  (value["header"] === undefined || value["header"] === null || typeof value["header"] === "boolean") &&
  (value["column"] === undefined || typeof value["column"] === "number");

/** The databases of a select: those that record names and synonyms (the graph's `synonym_databases`) first. */
function DatabaseGroups({ databases, synonyms }: { databases: readonly string[]; synonyms: ReadonlySet<string> }) {
  const names = databases.filter((d) => synonyms.has(d));
  const rest = databases.filter((d) => !synonyms.has(d));
  const options = (list: readonly string[]) =>
    list.map((d) => (
      <option key={d} value={d}>
        {databaseLabel(d)}
      </option>
    ));
  if (!names.length) return <>{options(rest)}</>;
  return (
    <>
      <optgroup label="Databases of names and their synonyms">{options(names)}</optgroup>
      <optgroup label="Other databases">{options(rest)}</optgroup>
    </>
  );
}

/** Before a list is converted: what the answer will hold, and where to convert one identifier. */
function EmptyBatch({ organism }: { organism: string }) {
  return (
    <div className="batch-empty">
      <p className="batch-empty__title">No list converted yet</p>
      <p className="batch-empty__lede">
        The answer appears here: what came back, then one row per identifier in your order, each opening to its answer.
        For one identifier with its whole path drawn, use <Link to={href("/convert", { organism })}>Convert</Link>.
      </p>
    </div>
  );
}
