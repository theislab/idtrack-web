// An answer of the api as it came: its status, the server's times (`Server-Timing`) and the browser's, its size, its
// request id, and its body as sent, or indented for reading with every value's text kept (lib/jsonView.ts).
import { useId, useState } from "react";
import type { Exchange } from "../../api/client";
import { indentJson, rawValueAt } from "../../lib/jsonView";
import { groupedInteger } from "../../lib/numbers";
import { parseServerTiming, TIMING_METRICS } from "../../lib/serverTiming";
import { useVocabulary } from "../../lib/vocabularyContext";
import { CopyButton, Mono, Prose } from "../ui";

/** Above this size the indented view is drawn as plain text (no colour per token), to stay quick. */
const TOKENS_MAX = 300_000;

export function JsonText({ raw }: { raw: string }) {
  const tokens = indentJson(raw);
  if (!tokens) return <>{raw}</>;
  if (raw.length > TOKENS_MAX) return <>{tokens.map((t) => t.text).join("")}</>;
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "space" ? (
          t.text
        ) : (
          <span key={i} className={`json-${t.kind}`}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

/** The api's error of an answer: its code, its message for people and the values it allowed, as sent. */
function errorOf(raw: string): { code: string; message: string | null; allowed: string | null } | null {
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.code !== "string") return null;
    return {
      code: parsed.error.code,
      message: typeof parsed.error.message === "string" ? parsed.error.message : null,
      // The allowed values as the answer writes them (a list keeps its spelling).
      allowed: rawValueAt(raw, ["error", "allowed"]),
    };
  } catch {
    return null;
  }
}

/** The first rows of a tab-separated answer as a table (its cells as sent). */
const TABLE_ROWS = 100;

export function TsvTable({ raw, what }: { raw: string; what: string }) {
  const lines = raw.split("\n").filter((line) => line !== "");
  // A first line that begins with `#` names what made the table (`provenance=true`): shown above it, not as a row.
  const comment = lines[0]?.startsWith("#") ? lines.shift() : undefined;
  const [head = "", ...rows] = lines;
  const columns = head.split("\t");
  return (
    <div className="exchange__table" role="region" tabIndex={0} aria-label={`${what}: the table`}>
      {comment ? (
        <p className="exchange__note">
          <Mono>{comment}</Mono>
        </p>
      ) : null}
      <table className="table table--compact">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col">
                <Mono>{c}</Mono>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, TABLE_ROWS).map((row, r) => (
            <tr key={r}>
              {row.split("\t").map((cell, i) => (
                <td key={i}>
                  <Mono>{cell}</Mono>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > TABLE_ROWS ? (
        <p className="exchange__note">
          The first {TABLE_ROWS} of {groupedInteger(rows.length)} rows; the whole table is in &quot;As sent&quot;.
        </p>
      ) : null}
    </div>
  );
}

export function ExchangeView({ exchange, what }: { exchange: Exchange; what: string }) {
  // JSON opens indented (every value's text kept); a table opens as sent.
  const [view, setView] = useState<"raw" | "indented" | "table">(() =>
    (exchange.contentType ?? "").startsWith("application/json") ? "indented" : "raw",
  );
  const id = useId();
  const vocabulary = useVocabulary();
  const timing = parseServerTiming(exchange.serverTiming);
  const ok = exchange.status >= 200 && exchange.status < 300;
  const isJson = (exchange.contentType ?? "").startsWith("application/json");
  const isTsv = (exchange.contentType ?? "").startsWith("text/tab-separated-values");
  const error = ok ? null : errorOf(exchange.raw);
  const code = error?.code ?? null;
  const meaning = code ? vocabulary.errors.get(code)?.meaning : undefined;
  const indented = view === "indented" && isJson;
  return (
    <div className="exchange" aria-label={what} role="region">
      <dl className="exchange__facts">
        <div className="exchange__fact">
          <dt>Status</dt>
          <dd className={`exchange__status exchange__status--${ok ? "ok" : "error"}`}>
            <Mono strong>{exchange.status}</Mono> {exchange.statusText}
            {code ? (
              <>
                {" "}
                <Mono>{code}</Mono>
              </>
            ) : null}
          </dd>
        </div>
        <div className="exchange__fact">
          <dt>Server-Timing</dt>
          <dd>
            {timing.length ? (
              timing.map((m, i) => (
                <span
                  key={`${m.name}-${i}`}
                  className="exchange__timing"
                  title={(TIMING_METRICS[m.name] ?? m.desc ?? "").replace(/`/g, "")}
                >
                  {m.name}{" "}
                  {m.dur !== null ? (
                    <>
                      <Mono>{m.dur}</Mono> ms
                    </>
                  ) : (
                    <Mono>{m.desc ?? ""}</Mono>
                  )}
                </span>
              ))
            ) : (
              <span className="muted">not sent</span>
            )}
          </dd>
        </div>
        <div className="exchange__fact">
          <dt>In the browser</dt>
          <dd>
            <Mono>{exchange.elapsedMs.toFixed(1)}</Mono> ms
          </dd>
        </div>
        <div className="exchange__fact">
          <dt>Size</dt>
          <dd>
            <Mono>{groupedInteger(exchange.bytes)}</Mono> bytes
          </dd>
        </div>
        <div className="exchange__fact exchange__fact--wide">
          <dt>Request id</dt>
          <dd>{exchange.requestId ? <Mono>{exchange.requestId}</Mono> : <span className="muted">not sent</span>}</dd>
        </div>
      </dl>
      {error ? (
        <dl className="exchange__error">
          {error.message ? (
            <div>
              <dt>The server&apos;s message</dt>
              <dd>{error.message}</dd>
            </div>
          ) : null}
          {error.allowed !== null && error.allowed !== "null" ? (
            <div>
              <dt>Allowed</dt>
              <dd>
                <Mono>{error.allowed}</Mono>
              </dd>
            </div>
          ) : null}
          {meaning ? (
            <div>
              <dt>
                What <Mono>{code}</Mono> means
              </dt>
              <dd>
                <Prose text={meaning} literal />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {exchange.retryAfter ? (
        <p className="exchange__meaning">
          Retry-After: <Mono>{exchange.retryAfter}</Mono> s
        </p>
      ) : null}
      <div className="exchange__bar">
        <div className="segmented" role="radiogroup" aria-label={`${what}: view`}>
          {(isTsv ? (["raw", "table"] as const) : (["raw", "indented"] as const)).map((v) => (
            <label key={v} className="segmented__option">
              <input
                type="radio"
                name={`${id}-view`}
                value={v}
                checked={view === v}
                disabled={v === "indented" && !isJson}
                onChange={() => {
                  setView(v);
                }}
              />
              <span>{v === "raw" ? "As sent" : v === "table" ? "Table" : "Indented"}</span>
            </label>
          ))}
        </div>
        <span className="exchange__type">
          <Mono>{exchange.contentType ?? "no content type"}</Mono>
        </span>
        <CopyButton text={exchange.raw} what={`${what}, the body as sent`} />
      </div>
      {view === "table" && isTsv ? (
        <TsvTable raw={exchange.raw} what={what} />
      ) : (
        <pre
          className={`exchange__body ${indented ? "exchange__body--indented" : ""} ${isTsv ? "exchange__body--tsv" : ""}`}
          role="region"
          tabIndex={0}
          aria-label={`${what}: body`}
        >
          {indented ? <JsonText raw={exchange.raw} /> : exchange.raw}
        </pre>
      )}
      {indented ? (
        <p className="exchange__note">
          Indented for reading: only the white space between the values is changed; every value is the text as sent.
        </p>
      ) : null}
    </div>
  );
}
