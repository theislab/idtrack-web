// The page's own small components: no UI kit, one look.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { navigate } from "../lib/router";
import { prose } from "../lib/values";
import { statusTitle } from "../lib/vocabulary";
import { useVocabulary } from "../lib/vocabularyContext";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" }) {
  return <button type="button" className={`button button--${variant} ${className}`} {...props} />;
}

/** A link inside the app: navigates without reloading; a modified click opens a new tab as usual. */
export function Link({
  to,
  children,
  className,
  current,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
}) {
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
        window.scrollTo({ top: 0 });
      }}
    >
      {children}
    </a>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
  className?: string;
}

/** A labelled control with its explanation under it (always visible: a control is never explained by hover alone). */
export function Field({ label, hint, error, children, className = "" }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field--error" : ""} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy })}
      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input type="text" autoComplete="off" spellCheck={false} {...props} className={`input ${props.className ?? ""}`} />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...props} className="select__control" />
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch__input"
        checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label htmlFor={id} className="switch__label">
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        {label}
      </label>
      {hint ? (
        <p className="field__hint switch__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An identifier, release or score: set in the monospaced face, never broken by the browser's hyphenation. */
export function Mono({
  children,
  title,
  strong,
}: {
  children: ReactNode;
  title?: string | undefined;
  strong?: boolean;
}) {
  return (
    <span className={`mono ${strong ? "mono--strong" : ""}`} title={title}>
      {children}
    </span>
  );
}

export function CopyButton({ text, label = "Copy", what }: { text: string; label?: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="quiet"
      className="copy"
      aria-label={`${label} ${what}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setState("copied");
            window.setTimeout(() => {
              setState("idle");
            }, 1600);
          },
          () => {
            setState("failed");
          },
        );
      }}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}

export function Skeleton({
  width = "100%",
  height = 14,
  className = "",
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return <span className={`skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

const STATUS_GLYPH: Record<string, string> = {
  converted: "●",
  tie: "◐",
  no_target: "◌",
  not_found: "○",
  unknown_version: "○",
  no_conversion: "○",
  error: "✕",
};

/** How a status is marked: a glyph and a tone (the words are the status itself). */
const STATUS_TONE: Record<string, string> = {
  converted: "good",
  tie: "warn",
  no_target: "warn",
  error: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  const meaning = useVocabulary().statuses.get(status);
  return (
    <span className={`status status--${STATUS_TONE[status] ?? "none"}`} title={meaning ? prose(meaning) : undefined}>
      <span aria-hidden="true" className="status__glyph">
        {STATUS_GLYPH[status] ?? "·"}
      </span>
      {statusTitle(status)}
    </span>
  );
}

/** An absent value: a dash, with what its absence means on focus and hover. */
export function Absent({ meaning }: { meaning: string }) {
  return (
    <span className="absent" title={meaning} aria-label={meaning}>
      —
    </span>
  );
}

/** A text of idtrack or the api: its code spans set in the monospaced face. */
export function Prose({ text }: { text: string }) {
  const parts = prose(text).split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <code key={i} className="mono">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** A table that may be wider than the page: it scrolls sideways inside its frame, with a visible cue on the side
 *  that holds more, and a line that says so; every value stays whole (nothing in a cell is cut). */
export function TableFrame({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const element = frame.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.firstElementChild;
    if (table) observer.observe(table);
    return () => {
      observer.disconnect();
    };
  }, [measure]);
  return (
    <div className={`table-frame-outer ${className}`}>
      {more.left || more.right ? (
        <p className="table-frame__cue" aria-hidden="true">
          {more.right ? "More columns to the right: scroll sideways →" : "← More columns to the left"}
        </p>
      ) : null}
      <div className={`table-frame ${more.left ? "table-frame--left" : ""} ${more.right ? "table-frame--right" : ""}`}>
        <div className="table-wrap" role="region" aria-label={label} tabIndex={0} ref={frame} onScroll={measure}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SectionTitle({ children, id, aside }: { children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <div className="section-title">
      <h2 id={id}>{children}</h2>
      {aside ? <div className="section-title__aside">{aside}</div> : null}
    </div>
  );
}

/** A label above a value, as on an instrument's panel. */
export function Readout({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`readout ${wide ? "readout--wide" : ""}`}>
      <dt className="readout__label">{label}</dt>
      <dd className="readout__value">{children}</dd>
    </div>
  );
}

export function Disclosure({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="disclosure" open={open}>
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
