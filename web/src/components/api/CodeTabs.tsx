// One request written in four languages: tabs (one tab stop, the arrow keys move between them), the code, a copy
// button. The language chosen is the page's: choosing it on one endpoint chooses it on all.
import { createContext, use, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { LANGUAGES, type RequestSpec } from "../../lib/apiExamples";
import { CopyButton } from "../ui";

export type LanguageKey = (typeof LANGUAGES)[number]["key"];

const KEY = "idtrack-api-language";

function readLanguage(): LanguageKey {
  try {
    const value = window.localStorage.getItem(KEY);
    return LANGUAGES.some((l) => l.key === value) ? (value as LanguageKey) : "curl";
  } catch {
    return "curl";
  }
}

const LanguageContext = createContext<{ language: LanguageKey; choose: (l: LanguageKey) => void }>({
  language: "curl",
  choose: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LanguageKey>(readLanguage);
  const value = useMemo(
    () => ({
      language,
      choose: (l: LanguageKey) => {
        setLanguage(l);
        try {
          window.localStorage.setItem(KEY, l);
        } catch {
          // Storage off: the choice lasts for this page.
        }
      },
    }),
    [language],
  );
  return <LanguageContext value={value}>{children}</LanguageContext>;
}

/** A block of code with its copy button. */
export function CodeBlock({ code, what, label }: { code: string; what: string; label?: string }) {
  return (
    <div className="code-block">
      {label ? <p className="code-block__label">{label}</p> : null}
      <pre className="code-block__pre" role="region" tabIndex={0} aria-label={what}>
        <code>{code}</code>
      </pre>
      <div className="code-block__copy">
        <CopyButton text={code} what={what} />
      </div>
    </div>
  );
}

export function CodeTabs({ origin, spec, what }: { origin: string; spec: RequestSpec; what: string }) {
  const { language, choose } = use(LanguageContext);
  const id = useId();
  const current = LANGUAGES.find((l) => l.key === language) ?? LANGUAGES[0];
  const code = current.write(origin, spec);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = LANGUAGES.findIndex((l) => l.key === language);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = step ? (index + step + LANGUAGES.length) % LANGUAGES.length : null;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = LANGUAGES.length - 1;
    if (next === null) return;
    event.preventDefault();
    const l = LANGUAGES[next];
    if (!l) return;
    choose(l.key);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-key="${l.key}"]`)?.focus();
  };
  return (
    <div className="code-tabs">
      <div className="code-tabs__bar">
        <div className="code-tabs__list" role="tablist" aria-label={`${what}: language`}>
          {LANGUAGES.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              id={`${id}-${l.key}`}
              data-key={l.key}
              aria-selected={l.key === language}
              aria-controls={`${id}-panel`}
              tabIndex={l.key === language ? 0 : -1}
              className="code-tabs__tab"
              onClick={() => {
                choose(l.key);
              }}
              onKeyDown={onKeyDown}
            >
              {l.label}
            </button>
          ))}
        </div>
        <CopyButton text={code} what={`${what} in ${current.label}`} />
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${current.key}`} className="code-tabs__panel">
        {/* A curl line is one command: its long address wraps in place rather than run out of view. */}
        <pre
          className={`code-block__pre${current.key === "curl" ? " code-block__pre--wrap" : ""}`}
          role="region"
          tabIndex={0}
          aria-label={`${what} in ${current.label}`}
        >
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
