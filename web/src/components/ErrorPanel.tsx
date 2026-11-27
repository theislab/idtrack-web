// Every failure of a request, in words: what went wrong, what to change, and the api's own message and request id. A
// refusal that names its wait (`Retry-After`) counts it down on its button; a statement is a heading, so that it is
// found and read as one.
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, TimeoutError, UnexpectedAnswerError, UnreachableError, type AnyRequestError } from "../api/client";
import { databaseLabel, sortDatabases } from "../lib/databases";
import { useVocabulary } from "../lib/vocabularyContext";
import { Button, Mono, Prose } from "./ui";

/** The api's arguments in the words of the page's form. */
const ARGUMENT_WORDS: Record<string, string> = {
  final_database: "the target database at this release",
  from_database: "the source database",
  from_release: "the release read at",
  to_release: "the target release",
  organism: "the organism",
};

function allowedText(allowed: (string | number)[]): string {
  const numbers = allowed.filter((v): v is number => typeof v === "number");
  if (numbers.length === allowed.length && allowed.length > 6) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === (sorted[i - 1] ?? v) + 1);
    if (contiguous) return `${sorted[0] ?? ""} to ${sorted[sorted.length - 1] ?? ""} (${sorted.length} values)`;
  }
  return allowed.map(String).join(", ");
}

/** The seconds left of a refusal's wait, counted down each second (0: it may be asked again). */
function useWaitLeft(error: AnyRequestError): number {
  const until = error instanceof ApiError && error.retryAfter ? error.receivedAt + error.retryAfter * 1000 : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) window.clearInterval(timer);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function ErrorPanel({
  error,
  onRetry,
  context,
  level = 2,
  actions,
}: {
  error: AnyRequestError;
  onRetry?: () => void;
  /** What was being done, for the title: "The conversion", "The organisms". */
  context?: string;
  /** The level of the statement's heading in the page's outline (1 where the statement is the whole page). */
  level?: 1 | 2 | 3;
  /** Ways on that the page offers for this failure (ask without a refused value, for example). */
  actions?: ReactNode;
}) {
  const vocabulary = useVocabulary();
  const left = useWaitLeft(error);
  const Heading = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
  const retryButton = (label = "Try again") =>
    onRetry ? (
      <Button onClick={onRetry} disabled={left > 0}>
        {left > 0 ? `${label} in ${left} s` : label}
      </Button>
    ) : null;
  const actionRow = (retry: ReactNode) =>
    retry || actions ? (
      <div className="notice__actions">
        {retry}
        {retry && actions ? " " : null}
        {actions}
      </div>
    ) : null;
  if (error instanceof UnreachableError) {
    return (
      <div className="notice notice--danger" role="alert">
        <Heading className="notice__title">
          {error.offline ? "The browser is offline" : "The api cannot be reached"}
        </Heading>
        <p>
          {context ? `${context} could not be asked: ` : ""}
          {error.offline
            ? "the browser has no network connection. It is asked again by itself when the connection returns."
            : `no answer came from the server${error.status !== null ? ` (a gateway answered ${error.status})` : ""}. Check your connection; if it works, the server may be starting (it loads its graphs first) or down. It is asked again when the browser is back online or this tab is shown again, or try again now.`}
        </p>
        {actionRow(retryButton())}
      </div>
    );
  }
  if (error instanceof TimeoutError) {
    return (
      <div className="notice notice--danger" role="alert">
        <Heading className="notice__title">No answer in time</Heading>
        <p>
          {context ? `${context}: ` : ""}
          {error.message} Ask for less at once (fewer identifiers, or without the path), then try again.
        </p>
        {actionRow(retryButton())}
      </div>
    );
  }
  if (error instanceof ApiError) {
    const body = error.body;
    // The code's meaning is the api's own table (`/vocabulary`); the message says what went wrong with this request.
    // Its title is the vocabulary's few plain words for people; whether to try again, the vocabulary's `retryable`.
    const term = vocabulary.errors.get(body.code);
    const meaning = term?.title ?? null;
    const retryable =
      term?.retryable ??
      ["rate_limited", "server_busy", "internal_error", "request_budget_exceeded", "request_timeout"].includes(
        body.code,
      );
    const listed = body.allowed?.length ? body.allowed : null;
    const databases = body.argument === "final_database" || body.argument === "from_database";
    // A problem of `details` that the message already says is not said twice.
    const details = (body.details ?? []).filter((detail) => !body.message.includes(detail.message));
    return (
      <div className="notice notice--danger" role="alert">
        <Heading className="notice__title">
          {meaning ? <Prose text={meaning} /> : context ? `${context} was refused.` : "The api refused the request."}
        </Heading>
        {listed ? (
          <>
            {/* The accepted values in the page's words; the api's own message (which lists them too) on request. */}
            <p className="notice__allowed">
              Accepted for {ARGUMENT_WORDS[body.argument ?? ""] ?? <Mono>{body.argument}</Mono>}:{" "}
              {databases ? (
                sortDatabases(listed.map(String)).map(databaseLabel).join(", ")
              ) : (
                <Mono>{allowedText(listed)}</Mono>
              )}
            </p>
            <details className="notice__message-details">
              <summary>The api&apos;s message</summary>
              <p className="notice__prose">
                <Prose text={body.message} />
              </p>
            </details>
          </>
        ) : (
          <p className="notice__prose">
            {/* What was refused is named before the api's words, whatever its code: every statement says what failed. */}
            {context && meaning ? `${context} was refused: ` : ""}
            <Prose text={body.message} />
          </p>
        )}
        {details.length ? (
          <ul className="notice__details">
            {details.map((detail, i) => (
              <li key={i}>
                <Mono>{detail.location.join(".")}</Mono>: {detail.message}
              </li>
            ))}
          </ul>
        ) : null}
        {error.retryAfter ? (
          <p>
            The api asks to wait {error.retryAfter} s before asking again
            {left > 0 ? `: ${left} s left` : ": the wait is over"}.
          </p>
        ) : null}
        <p className="notice__meta">
          <span className="code-quiet">{body.code}</span> · status {error.status} · request{" "}
          <Mono>{body.request_id}</Mono>
        </p>
        {actionRow(retryable ? retryButton() : null)}
      </div>
    );
  }
  return (
    <div className="notice notice--danger" role="alert">
      <Heading className="notice__title">An answer the page cannot read</Heading>
      <p className="notice__prose">
        {context ? `${context}: ` : ""}
        {error.message} This is a fault: the api answered something its document does not describe. Try again; if it
        persists, report it
        {error instanceof UnexpectedAnswerError && error.requestId ? (
          <>
            {" "}
            with the request <Mono>{error.requestId}</Mono>
          </>
        ) : null}
        .
      </p>
      {actionRow(retryButton())}
    </div>
  );
}
