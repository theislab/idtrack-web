// The command palette (DIRECTION.md, "The disclosure components"): ⌘K or Ctrl K anywhere, or the masthead's button.
// One field and a list: the conversions this browser opened last; what is typed converted in the organism in view
// (or in the graph whose Ensembl ids it is shaped like), or looked up as a name; every page and the views the
// addresses name (Method's stages, accuracy and uses; Explore's graphs; each organism, to use it or to open its graph
// and its history; the API's endpoints; the theme; the citation); the showcase's cases of the organism in view (from
// `GET /organisms/{organism}/showcase/queries`). Found by the starts of words, ordered by lib/palette.ts. A combobox
// over a listbox: the arrow keys move, Enter goes, Escape closes (with a short fade) and focus returns.
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../../api/client";
import { convertHref, plainConversion } from "../../lib/convertParameters";
import { isCaseKind } from "../../lib/home/caseKinds";
import { KIND_TEXT } from "../../lib/home/cases";
import { docsPage } from "../../lib/links";
import { anchorOf } from "../../lib/openapi";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { ensemblSpecies, ranked } from "../../lib/palette";
import { clearRecent, readRecent, type Recent } from "../../lib/recent";
import { href, navigate } from "../../lib/router";
import { useShowcaseQueries } from "../../lib/showcase";
import { requestTheme } from "../../lib/theme";
import { EXIT_MS, exitMoves } from "./useExit";

interface Command {
  id: string;
  group: string;
  label: string;
  /** Words it is also found by. */
  words?: string;
  detail?: string | undefined;
  run: () => void;
}

const go = (to: string) => () => {
  navigate(to);
  if (!to.includes("#")) window.scrollTo({ top: 0 });
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An address with the organism in view added to its query (its fragment kept). */
function withOrganism(to: string, organism: string | null): string {
  const url = new URL(to, "http://local");
  if (organism) url.searchParams.set("organism", organism);
  return url.pathname + url.search + url.hash;
}

/** Each graph's Ensembl species part (lib/palette.ts), read from the Ensembl ids of its showcase's queries: asked of
 *  every graph only once something shaped like an Ensembl id of another graph is typed. */
function useSpecies(organisms: readonly string[], wanted: boolean): Map<string, string> {
  const [species, setSpecies] = useState(() => new Map<string, string>());
  const key = organisms.join(" ");
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    for (const organism of key.split(" ").filter(Boolean))
      api.showcaseQueries(organism, { signal: controller.signal }).then(
        (answer) => {
          const ids = [...answer.data.journeys, ...answer.data.cases].map((q) => q.query.identifier);
          const code = ids.map(ensemblSpecies).find((c) => c !== null);
          if (code) setSpecies((m) => (m.get(code) === organism ? m : new Map(m).set(code, organism)));
        },
        () => undefined,
      );
    return () => {
      controller.abort();
    };
  }, [key, wanted]);
  return species;
}

/** The api's endpoints, from its OpenAPI document (asked for once something is typed). */
function useEndpoints(wanted: boolean): { method: string; path: string; summary: string; id: string }[] {
  const [list, setList] = useState<{ method: string; path: string; summary: string; id: string }[]>([]);
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    api.openapi({ signal: controller.signal }).then(
      (answer) => {
        const paths = (
          answer.data as { paths?: Record<string, Record<string, { summary?: string; operationId?: string }>> }
        ).paths;
        const out: { method: string; path: string; summary: string; id: string }[] = [];
        for (const [path, item] of Object.entries(paths ?? {}))
          for (const [method, op] of Object.entries(item))
            if (["get", "post", "put", "delete", "patch"].includes(method))
              out.push({ method: method.toUpperCase(), path, summary: op.summary ?? "", id: op.operationId ?? "" });
        setList(out);
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [wanted]);
  return list;
}

/** What is typed, converted in the organism in view (and first in the graph whose Ensembl ids it is shaped like,
 *  where that is another), or looked up as a name. */
function conversionCommands(typed: string, organism: string | null, species: Map<string, string>): Command[] {
  if (!typed || !organism) return [];
  const out: Command[] = [];
  const code = ensemblSpecies(typed);
  const own = code ? species.get(code) : undefined;
  if (own && own !== organism)
    out.push({
      id: "convert-own",
      group: "Convert",
      label: `Convert ${typed}`,
      detail: `in ${organismName(own)}, whose Ensembl ids it is shaped like`,
      run: go(convertHref(own, plainConversion(typed))),
    });
  out.push({
    id: "convert",
    group: "Convert",
    label: `Convert ${typed}`,
    detail: `in ${organismName(organism)}, to the graph's last release`,
    run: go(convertHref(organism, plainConversion(typed))),
  });
  out.push({
    id: "names",
    group: "Convert",
    label: `The genes named ${typed}`,
    detail: "every database that attaches the name, at which releases",
    run: go(href("/names", { organism, name: typed })),
  });
  return out;
}

/** The conversions this browser opened last, and the way to forget them. */
function recentCommands(recent: readonly Recent[], forget: (r: Recent[]) => void): Command[] {
  if (!recent.length) return [];
  const span = (r: Recent) => (r.from || r.to ? `, ${r.from ?? "its release"} → ${r.to ?? "the last"}` : "");
  return [
    ...recent.map((r, i) => ({
      id: `recent-${i}`,
      group: "Recent",
      label: r.identifier,
      detail: `${organismName(r.organism)}${span(r)}${r.db ? `, ${r.db}` : ""}`,
      run: go(href("/convert", { organism: r.organism, id: r.identifier, from: r.from, to: r.to, db: r.db })),
    })),
    {
      id: "recent-clear",
      group: "Recent",
      label: "Clear recent",
      detail: "forget these conversions in this browser",
      run: () => {
        clearRecent();
        forget([]);
      },
    },
  ];
}

const PAGES: [string, string, string][] = [
  ["/", "Home", "start"],
  ["/convert", "Convert an identifier", "one"],
  ["/batch", "Convert a list", "batch many"],
  ["/names", "Names of genes", "symbol synonym"],
  ["/organisms", "Explore Ensembl's history", "stories cases journeys"],
  ["/method", "Method and accuracy", "benchmarks how"],
  ["/developers", "The API", "http openapi developers"],
];

function pageCommands(organism: string | null): Command[] {
  return [
    ...PAGES.map(([path, label, words]) => ({
      id: `page-${path}`,
      group: "Pages",
      label,
      words,
      run: go(withOrganism(path, organism)),
    })),
    {
      id: "docs",
      group: "Pages",
      label: "IDTrack's documentation",
      words: "docs readthedocs",
      detail: "another site",
      run: () => {
        window.location.assign(docsPage());
      },
    },
  ];
}

/** The views the addresses name. */
const VIEWS: [string, string, string][] = [
  ["/method?stage=read", "How IDTrack reads an identifier", "method stage read"],
  ["/method?stage=walk", "How IDTrack walks Ensembl's history", "method stage walk"],
  ["/method?stage=bridge", "How IDTrack bridges through an id two genes carried", "method stage bridge"],
  ["/method?stage=rank", "How IDTrack ranks the candidates", "method stage rank criteria"],
  ["/method?stage=answer", "How IDTrack gives its answer", "method stage answer tie"],
  ["/method?accuracy=organism", "Accuracy for one organism", "benchmarks how often right"],
  ["/method?accuracy=all", "Accuracy in every organism", "benchmarks matrix"],
  ["/method?accuracy=family", "Accuracy: each benchmark family whole", "benchmarks families"],
  ["/method?accuracy=tools", "Accuracy against other tools", "benchmarks comparison"],
  ["/method?about=limitations", "What IDTrack does not do yet", "limitations known"],
  ["/method?about=data", "The data of this server", "graphs releases"],
  ["/method?about=limits", "The limits of this server", "bounds rate"],
  ["/method#cite", "Cite IDTrack", "citation reference bibtex"],
  ["/organisms?tab=graphs", "Explore: the graphs compared", "assemblies history databases"],
];

function viewCommands(organism: string | null): Command[] {
  return [
    ...VIEWS.map(([to, label, words]) => ({
      id: `view-${to}`,
      group: "Views",
      label,
      words,
      run: go(withOrganism(to, organism)),
    })),
    ...(["light", "dark", "system"] as const).map((theme) => ({
      id: `theme-${theme}`,
      group: "Views",
      label: theme === "system" ? "Follow the system's theme" : `Switch to the ${theme} theme`,
      words: `theme mode ${theme}`,
      run: () => {
        requestTheme(theme);
      },
    })),
  ];
}

/** Each organism twice over: to use it on this page, and to open its graph (and its history). */
function organismCommands(
  organisms: readonly { organism: string }[],
  organism: string | null,
  choose: (organism: string) => void,
): Command[] {
  return organisms.flatMap((o) => {
    const common = commonName(o.organism);
    const name = organismName(o.organism);
    const short = common ? capital(common) : name;
    const page = `/organisms/${encodeURIComponent(o.organism)}`;
    return [
      {
        id: `organism-${o.organism}`,
        group: "Organisms",
        label: common ? `Use ${short} (${name})` : `Use ${name}`,
        words: `${common ?? ""} ${name} ${o.organism}`,
        detail: o.organism === organism ? "in view" : "on this page",
        run: () => {
          choose(o.organism);
        },
      },
      {
        id: `graph-${o.organism}`,
        group: "Organisms",
        label: `${short}: its graph`,
        words: `${name} ${o.organism} releases assemblies composition`,
        detail: page,
        run: go(page),
      },
      {
        id: `history-${o.organism}`,
        group: "Organisms",
        label: `${short}: its history, every id a line`,
        words: `${name} ${o.organism} lineages history`,
        run: go(`${page}?tab=history`),
      },
    ];
  });
}

function caseCommands(
  cases: readonly {
    kind: string;
    query: {
      identifier: string;
      from_release?: number | null;
      to_release?: number | null;
      final_database?: string | null;
    };
  }[],
  organism: string,
): Command[] {
  return cases.map((c) => ({
    id: `case-${c.kind}-${c.query.identifier}`,
    group: "Cases of this graph",
    label: isCaseKind(c.kind) ? KIND_TEXT[c.kind].title : c.kind,
    words: `${c.kind} ${c.query.identifier}`,
    detail: c.query.identifier,
    run: go(
      convertHref(organism, {
        ...plainConversion(c.query.identifier),
        fromRelease: c.query.from_release ?? null,
        toRelease: c.query.to_release ?? null,
        finalDatabase: c.query.final_database ?? null,
      }),
    ),
  }));
}

function endpointCommands(
  endpoints: readonly { method: string; path: string; summary: string; id: string }[],
): Command[] {
  return endpoints.map((e) => ({
    id: `endpoint-${e.method}-${e.path}`,
    group: "API endpoints",
    label: `${e.method} ${e.path.replace(/^\/api\/v\d+/, "") || "/"}`,
    words: `${e.id.replace(/_/g, " ")} ${e.summary} endpoint`,
    detail: e.summary,
    run: go(`/developers#${anchorOf(e.method, e.path)}`),
  }));
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const id = useId();
  const { organisms, current, choose } = useOrganisms();
  const queries = useShowcaseQueries(current?.organism ?? null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const [closing, setClosing] = useState(false);
  const exitTimer = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const typed = text.trim();
  const species = useSpecies(
    organisms.map((o) => o.organism),
    ensemblSpecies(typed) !== null,
  );
  const endpoints = useEndpoints(typed.length > 0);

  useEffect(() => {
    opener.current = document.activeElement;
    const element = dialog.current;
    if (element && typeof element.showModal === "function" && !element.open) element.showModal();
    field.current?.focus();
    return () => {
      // The focus goes back where it was; opened from the page itself (the shortcut), to the palette's button.
      const back =
        opener.current instanceof HTMLElement && opener.current !== document.body
          ? opener.current
          : document.querySelector<HTMLElement>(".mast__palette");
      back?.focus();
    };
  }, []);

  /** Close with the exit's fade (at once under reduced motion). */
  const leave = () => {
    if (closing) return;
    if (!exitMoves()) {
      onClose();
      return;
    }
    setClosing(true);
    exitTimer.current = window.setTimeout(onClose, EXIT_MS);
  };
  const onPressBeside = useEffectEvent(leave);
  const onClosedByBrowser = useEffectEvent(onClose);
  // A press on the dimmed page (the dialog's own box, outside its sheet) closes it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onPressBeside();
    };
    // A dialog the browser closed by itself (a close request it does not let the page hold) is gone for the page too.
    const onClosed = () => {
      onClosedByBrowser();
    };
    element.addEventListener("click", onClick);
    element.addEventListener("close", onClosed);
    return () => {
      element.removeEventListener("click", onClick);
      element.removeEventListener("close", onClosed);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const commands = useMemo<Command[]>(() => {
    const organism = current?.organism ?? null;
    const out: Command[] = [
      ...(typed ? [] : recentCommands(recent, setRecent)),
      ...pageCommands(organism),
      ...viewCommands(organism),
      ...organismCommands(organisms, organism, choose),
      ...(queries.state === "done" && organism ? caseCommands(queries.answer.data.cases, organism) : []),
      ...endpointCommands(endpoints),
    ];
    return ranked(out, conversionCommands(typed, organism, species), typed);
  }, [typed, current, organisms, queries, choose, recent, species, endpoints]);

  const index = Math.min(active, Math.max(0, commands.length - 1));
  const run = (c: Command | undefined) => {
    if (!c) return;
    // "Clear recent" keeps the palette open on what remains.
    if (c.id === "recent-clear") {
      c.run();
      setActive(0);
      return;
    }
    c.run();
    leave();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index + step + commands.length) % Math.max(1, commands.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(commands[index]);
    }
  };
  useEffect(() => {
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, id]);

  // A group's name before its first entry.
  const heads = commands.map((c, i) => (i === 0 || commands[i - 1]?.group !== c.group ? c.group : null));
  return (
    <dialog
      ref={dialog}
      className={`palette${closing ? " palette--closing" : ""}`}
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        leave();
      }}
    >
      <div className="palette__sheet">
        <div className="palette__field">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={field}
            className="palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={commands.length ? `${id}-option-${index}` : undefined}
            aria-autocomplete="list"
            aria-label="Search: a page, a view, an organism, or what to convert"
            placeholder="A gene id or name, a page, an organism…"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="palette__esc">esc</kbd>
        </div>
        <div className="palette__list" role="listbox" id={`${id}-list`} aria-label="Results">
          {commands.map((c, i) => {
            const head = heads[i];
            return (
              <div key={c.id} role="presentation">
                {head ? (
                  <span className="palette__group" aria-hidden="true">
                    {head}
                  </span>
                ) : null}
                <div
                  id={`${id}-option-${i}`}
                  role="option"
                  aria-selected={i === index}
                  tabIndex={-1}
                  className="palette__option"
                  onPointerMove={() => {
                    if (i !== index) setActive(i);
                  }}
                  onClick={() => {
                    run(c);
                  }}
                  onKeyDown={() => undefined}
                >
                  <span className="palette__label">{c.label}</span>
                  {c.detail ? <span className="palette__detail">{c.detail}</span> : null}
                </div>
              </div>
            );
          })}
          {commands.length ? null : <p className="palette__none">Nothing matches.</p>}
        </div>
      </div>
    </dialog>
  );
}
