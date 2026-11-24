// Every failure of a request, in words: what went wrong, what to change, and the api's own message and request id.
import { ApiError, TimeoutError, UnreachableError, type AnyRequestError } from "../api/client";
import { useVocabulary } from "../lib/vocabularyContext";
import { Button, Mono, Prose } from "./ui";

function allowedText(allowed: (string | number)[]): string {
  const numbers = allowed.filter((v): v is number => typeof v === "number");
  if (numbers.length === allowed.length && allowed.length > 6) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const contiguous = sorted.every((v, i) => i === 0 || v === (sorted[i - 1] ?? v) + 1);
    if (contiguous) return `${sorted[0] ?? ""} to ${sorted[sorted.length - 1] ?? ""} (${sorted.length} values)`;
  }
  return allowed.map(String).join(", ");
}

export function ErrorPanel({
  error,
  onRetry,
  context,
}: {
  error: AnyRequestError;
  onRetry?: () => void;
  /** What was being done, for the title: "The conversion", "The organisms". */
  context?: string;
}) {
  const vocabulary = useVocabulary();
  if (error instanceof UnreachableError) {
    return (
      <div className="notice notice--danger" role="alert">
        <p className="notice__title">The api cannot be reached</p>
        <p>
          {context ? `${context} could not be asked: ` : ""}no answer came from the server
          {error.status !== null ? ` (a gateway answered ${error.status})` : ""}. Check your connection; if it works,
          the server may be starting (it loads its graphs first) or down. Try again in a moment.
        </p>
        {onRetry ? (
          <div className="notice__actions">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (error instanceof TimeoutError) {
    return (
      <div className="notice notice--danger" role="alert">
        <p className="notice__title">No answer in time</p>
        <p>{error.message} Ask for less at once (fewer identifiers, or without the path), then try again.</p>
        {onRetry ? (
          <div className="notice__actions">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (error instanceof ApiError) {
    const body = error.body;
    // The code's meaning is the api's own table (`/vocabulary`); the message says what went wrong with this request.
    const meaning = vocabulary.errors.get(body.code)?.meaning ?? null;
    const retryable = ["rate_limited", "server_busy", "internal_error", "request_budget_exceeded"].includes(body.code);
    return (
      <div className="notice notice--danger" role="alert">
        <p className="notice__title">
          {meaning ? <Prose text={meaning} /> : context ? `${context} was refused.` : "The api refused the request."}
        </p>
        <p className="notice__message">{body.message}</p>
        {body.allowed?.length ? (
          <p className="notice__allowed">
            Accepted
            {body.argument ? (
              <>
                {" "}
                for <Mono>{body.argument}</Mono>
              </>
            ) : null}
            : <Mono>{allowedText(body.allowed)}</Mono>
          </p>
        ) : null}
        {body.details?.length ? (
          <ul className="notice__details">
            {body.details.map((detail, i) => (
              <li key={i}>
                <Mono>{detail.location.join(".")}</Mono>: {detail.message}
              </li>
            ))}
          </ul>
        ) : null}
        {error.retryAfter ? <p>Try again in {error.retryAfter} s.</p> : null}
        <p className="notice__meta">
          <span className="code-quiet">{body.code}</span> · status {error.status} · request{" "}
          <Mono>{body.request_id}</Mono>
        </p>
        {onRetry && retryable ? (
          <div className="notice__actions">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="notice notice--danger" role="alert">
      <p className="notice__title">An answer the page cannot read</p>
      <p>
        {error.message} This is a fault: the api answered something its document does not describe. Reload the page; if
        it persists, report it.
      </p>
      {onRetry ? (
        <div className="notice__actions">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}
