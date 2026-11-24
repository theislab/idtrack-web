// Numbers exactly as the api wrote them.
//
// The api writes a float as Python's `repr` does (the shortest text that reads back as the same double) and JSON.parse
// reads it back exactly. JavaScript's own shortest text has the same digits but other rules for where it switches to
// an exponent and for whole numbers ("1" for the api's "1.0"), so the fields the api's document types as `number`
// (a score, a mapping weight) are written back with Python's rules: what the page shows is the text the api sent.

/** Python's `repr` of a float: the text the api sent for a `number` field. */
export function pythonFloat(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  // toExponential() without an argument gives the shortest digits that read back as the same double.
  const [mantissa = "", exponentText = "0"] = Math.abs(value).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  if (exponent < -4 || exponent >= 16) {
    const fraction = digits.slice(1);
    const exp = Math.abs(exponent).toString().padStart(2, "0");
    return `${sign}${digits[0] ?? ""}${fraction ? `.${fraction}` : ""}e${exponent < 0 ? "-" : "+"}${exp}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}.${fraction || "0"}`;
}

/** A float shortened for a small space: at most `significant` digits, marked with "…" when anything was cut. */
export function shortFloat(value: number, significant = 3): { text: string; shortened: boolean } {
  const full = pythonFloat(value);
  // Cut the api's own text, never round: 0.9999 must not read as 1.0, and no arithmetic error can enter.
  const match = /^(-?)(\d+)\.(\d+)$/.exec(full);
  if (!match) return { text: full, shortened: false }; // exponent notation: already short
  const [, sign = "", whole = "", fraction = ""] = match;
  const leadingZeros = whole === "0" ? (/^0*/.exec(fraction)?.[0].length ?? 0) : 0;
  const keep = whole === "0" ? leadingZeros + significant : Math.max(1, significant - whole.length);
  if (fraction.length <= keep) return { text: full, shortened: false };
  return { text: `${sign}${whole}.${fraction.slice(0, keep)}…`, shortened: true };
}

/** An integer with thin separators for reading (counts, sizes); the exact value is the digits without them. */
export function groupedInteger(value: number): string {
  return value.toLocaleString("en-US").replace(/,/g, " ");
}

/** A byte size in words beside its exact number of bytes. */
export function byteSize(bytes: number): string {
  const units = ["bytes", "KiB", "MiB", "GiB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} bytes` : `${size.toFixed(1)} ${units[unit] ?? ""}`;
}

/** Ascending releases written as ranges: [56, 57, 58, 60] -> "56–58, 60". Exact: every release is in the text. */
export function releaseRanges(releases: readonly number[]): string {
  const sorted = [...releases].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const release of sorted) {
    if (start !== null && previous !== null && release === previous + 1) {
      previous = release;
      continue;
    }
    if (start !== null && previous !== null) parts.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = release;
    previous = release;
  }
  if (start !== null && previous !== null) parts.push(start === previous ? `${start}` : `${start}–${previous}`);
  return parts.join(", ");
}
