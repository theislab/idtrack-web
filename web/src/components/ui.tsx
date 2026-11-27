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
import { focusWhenThere, fragmentTarget } from "../lib/focus";
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

/** A link inside the app: navigates without reloading; a modified click opens a new tab as usual. An address with a
 *  fragment (`/method#method-evidence`) leads to that place: on another page the route's focus brings it into view once
 *  it is drawn (App.tsx); on the same page it is brought into view at once. Any other link starts at the page's top. */
export function Link({
  to,
  children,
  className,
  current,
  label,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  current?: boolean;
  /** The link's accessible name, when its content is not text (a logo). */
  label?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        const target = new URL(to, window.location.href);
        const samePage = target.pathname === window.location.pathname;
        navigate(to);
        if (!target.hash) window.scrollTo({ top: 0 });
        else if (samePage) {
          const place = fragmentTarget(target.hash);
          if (place) focusWhenThere(() => document.getElementById("main"), place);
        }
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

/** A field of text: it takes exactly what is typed (an identifier, a name, a release), so a phone neither capitalizes
 *  nor corrects it, and its Enter key says it sends the form. */
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="go"
      {...props}
      className={`input ${props.className ?? ""}`}
    />
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

export function CopyButton({
  text,
  label = "Copy",
  what,
}: {
  /** The text copied, or a function that writes it when the button is pressed (a long text is not kept in the page). */
  text: string | (() => string);
  label?: string;
  what: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="quiet"
      className="copy"
      aria-label={`${label} ${what}`}
      onClick={() => {
        // The clipboard is given only to secure pages (https, localhost); elsewhere the copy is said to fail.
        if (
          !("clipboard" in navigator) ||
          typeof (navigator.clipboard as Clipboard | undefined)?.writeText !== "function"
        ) {
          setState("failed");
          return;
        }
        navigator.clipboard.writeText(typeof text === "function" ? text() : text).then(
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

export function StatusBadge({ status, said = false }: { status: string; said?: boolean }) {
  // `said`: a sentence beside the badge says what the status means for this result (the answer's panel a).
  const known = useVocabulary().statuses.get(status);
  const meaning = said ? null : known;
  return (
    <span className={`status status--${STATUS_TONE[status] ?? "none"}`} title={meaning ? prose(meaning) : undefined}>
      <span aria-hidden="true" className="status__glyph">
        {STATUS_GLYPH[status] ?? "·"}
      </span>
      {statusTitle(status)}
      {/* The status's meaning is read after its word, not left to a hover. */}
      {meaning ? <span className="visually-hidden">: {prose(meaning)}</span> : null}
    </span>
  );
}

/** An absent value: a dash, with what its absence means: in the text itself for assistive technology (read in place
 *  of the dash), and on a mouse's hover. */
export function Absent({ meaning }: { meaning: string }) {
  return (
    <span className="absent" title={meaning}>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">{meaning}</span>
    </span>
  );
}

/** A text of idtrack or the api: its code spans set in the monospaced face. For reading, `null`, `true` and `false`
 *  in code are written as words ("none", "yes", "no"); `literal` keeps every code span as written (the api's reference,
 *  where a value is the one the contract takes and returns). */
export function Prose({ text, literal = false }: { text: string; literal?: boolean }) {
  const parts = (literal ? text : prose(text)).split("`");
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
  // Measured where layout is already done: in the observer's callback (which also reports at once when it starts
  // observing) and in a frame after a scroll, never in the middle of a commit.
  const frameRequest = useRef(0);
  const onScroll = useCallback(() => {
    if (!frameRequest.current)
      frameRequest.current = window.requestAnimationFrame(() => {
        frameRequest.current = 0;
        measure();
      });
  }, [measure]);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const table = element.firstElementChild;
    if (table) observer.observe(table);
    return () => {
      observer.disconnect();
      if (frameRequest.current) window.cancelAnimationFrame(frameRequest.current);
      frameRequest.current = 0;
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
        <div className="table-wrap" role="region" aria-label={label} tabIndex={0} ref={frame} onScroll={onScroll}>
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
