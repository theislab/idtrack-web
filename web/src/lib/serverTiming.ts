// The `Server-Timing` header of an answer, read as the server wrote it: every metric with its duration's text kept as
// sent (no number is parsed and written again). Its metrics and their meanings are the api's (`TIMING_METRICS`, generated
// from `x-metrics` of the header in api/openapi.json).

export interface TimingMetric {
  name: string;
  /** The duration in milliseconds, as the header wrote it; `null` when the metric has none. */
  dur: string | null;
  /** The metric's description, where the header gives one. */
  desc: string | null;
}

/** What each of the api's metrics measures, in the api's words (generated from its document's `x-metrics`). */
export { TIMING_METRICS } from "../api/timing";

/** Split `text` at `separator` outside double-quoted strings. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\\" && quoted && i + 1 < text.length) {
      current += c + text.charAt(i + 1);
      i += 1;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === separator && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, "$1");
  return v;
}

/** The metrics of a `Server-Timing` header (several headers joined by commas read the same), in order. */
export function parseServerTiming(header: string | null | undefined): TimingMetric[] {
  if (!header) return [];
  const metrics: TimingMetric[] = [];
  for (const entry of splitOutsideQuotes(header, ",")) {
    const [nameText = "", ...parameters] = splitOutsideQuotes(entry, ";");
    const name = nameText.trim();
    if (!name) continue;
    let dur: string | null = null;
    let desc: string | null = null;
    for (const parameter of parameters) {
      const at = parameter.indexOf("=");
      const key = (at < 0 ? parameter : parameter.slice(0, at)).trim().toLowerCase();
      const value = at < 0 ? "" : unquote(parameter.slice(at + 1));
      if (key === "dur" && dur === null) dur = value;
      else if (key === "desc" && desc === null) desc = value;
    }
    metrics.push({ name, dur, desc });
  }
  return metrics;
}
