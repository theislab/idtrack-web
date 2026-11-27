// The command palette (DIRECTION.md, "The disclosure components"): ⌘K or Ctrl K anywhere, or the masthead's button.
// One field and a list: what is typed converted in the organism in view, or looked up as a name; every page; every
// organism; the showcase's cases of the organism in view (from `GET /organisms/{organism}/showcase`, held for the page
// session). A combobox over a listbox: the arrow keys move, Enter goes, Escape closes and focus returns.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { convertHref, plainConversion } from "../../lib/convertParameters";
import { isCaseKind } from "../../lib/home/caseKinds";
import { KIND_TEXT } from "../../lib/home/cases";
import { docsPage } from "../../lib/links";
import { commonName, organismName } from "../../lib/organismNames";
import { useOrganisms } from "../../lib/organisms";
import { href, navigate } from "../../lib/router";
import { useShowcase } from "../../lib/showcase";

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
  window.scrollTo({ top: 0 });
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const id = useId();
  const { organisms, current, choose } = useOrganisms();
  const showcase = useShowcase(current?.organism ?? null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const element = dialog.current;
    if (element && typeof element.showModal === "function" && !element.open) element.showModal();
    field.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const organism = current?.organism ?? null;
    const keep = organism ? { organism } : {};
    const typed = text.trim();
    const out: Command[] = [];
    if (typed && organism) {
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
        run: go(href("/names", { ...keep, name: typed })),
      });
    }
    const pages: [string, string, string][] = [
      ["/", "Home", "start"],
      ["/convert", "Convert an identifier", "one"],
      ["/batch", "Convert a list", "batch many"],
      ["/names", "Names of genes", "symbol synonym"],
      ["/organisms", "Explore Ensembl's history", "stories cases graphs"],
      ["/method", "Method and accuracy", "benchmarks how cite"],
      ["/developers", "The API", "http openapi developers"],
    ];
    for (const [path, label, words] of pages)
      out.push({
        id: `page-${path}`,
        group: "Pages",
        label,
        words,
        run: go(["/organisms", "/method", "/developers"].includes(path) ? path : href(path, keep)),
      });
    out.push({
      id: "docs",
      group: "Pages",
      label: "IDTrack's documentation",
      words: "docs readthedocs",
      detail: "another site",
      run: () => {
        window.location.assign(docsPage());
      },
    });
    for (const o of organisms)
      out.push({
        id: `organism-${o.organism}`,
        group: "Organisms",
        label: organismName(o.organism),
        words: `${commonName(o.organism) ?? ""} ${o.organism}`,
        detail: o.organism === organism ? "in view" : (commonName(o.organism) ?? undefined),
        run: () => {
          choose(o.organism);
        },
      });
    if (showcase.state === "done" && organism)
      for (const c of showcase.answer.data.cases) {
        const title = isCaseKind(c.kind) ? KIND_TEXT[c.kind].title : c.kind;
        out.push({
          id: `case-${c.kind}-${c.query.identifier}`,
          group: "Cases of this graph",
          label: title,
          words: c.kind,
          detail: c.query.identifier,
          run: go(
            convertHref(organism, {
              ...plainConversion(c.query.identifier),
              fromRelease: c.query.from_release,
              toRelease: c.query.to_release,
              finalDatabase: c.query.final_database,
            }),
          ),
        });
      }
    const query = typed.toLowerCase();
    return out.filter(
      (c) =>
        c.group === "Convert" ||
        !query ||
        `${c.label} ${c.words ?? ""} ${c.detail ?? ""}`.toLowerCase().includes(query),
    );
  }, [text, current, organisms, showcase, choose]);

  const index = Math.min(active, Math.max(0, commands.length - 1));
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
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

  let group = "";
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
            aria-label="Search: a page, an organism, or what to convert"
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
            const head = c.group !== group ? c.group : null;
            group = c.group;
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
