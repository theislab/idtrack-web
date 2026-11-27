// A JSON text indented for reading without parsing it: every string, number and literal is copied from the text as
// sent, so `1.0` stays `1.0` and `0.9598796202450001` keeps every digit (JSON.parse and JSON.stringify would write
// `1` and could not keep a number's spelling). Only the white space between the tokens changes.

type TokenKind = "key" | "string" | "number" | "literal" | "punctuation" | "space";

export interface Token {
  kind: TokenKind;
  text: string;
}

/** The tokens of `raw` re-laid with `indent` spaces per level; `null` when `raw` is not JSON this reader can follow. */
export function indentJson(raw: string, indent = 2): Token[] | null {
  const out: Token[] = [];
  const stack: ("object" | "array")[] = [];
  /** In an object: the next string is a key. */
  let expectKey = false;
  let i = 0;
  const n = raw.length;
  const newline = (depth: number) => {
    out.push({ kind: "space", text: `\n${" ".repeat(depth * indent)}` });
  };
  const skip = () => {
    while (i < n && " \t\r\n".includes(raw.charAt(i))) i++;
  };
  while (i < n) {
    skip();
    if (i >= n) break;
    const c = raw.charAt(i);
    if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      i++;
      skip();
      if (raw.charAt(i) === close) {
        out.push({ kind: "punctuation", text: c + close });
        i++;
        expectKey = false;
        continue;
      }
      stack.push(c === "{" ? "object" : "array");
      out.push({ kind: "punctuation", text: c });
      newline(stack.length);
      expectKey = c === "{";
      continue;
    }
    if (c === "}" || c === "]") {
      const top = stack.pop();
      if ((c === "}" && top !== "object") || (c === "]" && top !== "array")) return null;
      newline(stack.length);
      out.push({ kind: "punctuation", text: c });
      i++;
      expectKey = false;
      continue;
    }
    if (c === ",") {
      out.push({ kind: "punctuation", text: "," });
      newline(stack.length);
      i++;
      expectKey = stack[stack.length - 1] === "object";
      continue;
    }
    if (c === ":") {
      out.push({ kind: "punctuation", text: ": " });
      i++;
      expectKey = false;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && raw.charAt(j) !== '"') j += raw.charAt(j) === "\\" ? 2 : 1;
      if (j >= n) return null;
      out.push({ kind: expectKey ? "key" : "string", text: raw.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const literal = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i, i + 400));
    if (!literal?.[0]) return null;
    const text = literal[0];
    out.push({ kind: /^[-\d]/.test(text) ? "number" : "literal", text });
    i += text.length;
  }
  if (stack.length) return null;
  return out;
}

/** The indented text (the tokens joined). */
export function indentedText(raw: string, indent = 2): string | null {
  const tokens = indentJson(raw, indent);
  return tokens ? tokens.map((t) => t.text).join("") : null;
}

/** The spans of every value of a JSON text by its path of object keys and array indexes (joined by NUL),
 *  made in one pass over the text: [start, end) of the value as written. */
function spansOf(raw: string): Map<string, [number, number]> {
  const spans = new Map<string, [number, number]>();
  const n = raw.length;
  let i = 0;
  const skip = () => {
    while (i < n && " \t\r\n".includes(raw.charAt(i))) i++;
  };
  const stringEnd = (from: number) => {
    let j = from + 1;
    while (j < n && raw.charAt(j) !== '"') j += raw.charAt(j) === "\\" ? 2 : 1;
    return j + 1;
  };
  // A value at `path` (null: inside an array, not indexed); returns false where the text is not JSON.
  const value = (path: string | null): boolean => {
    skip();
    const start = i;
    const c = raw.charAt(i);
    if (c === "{") {
      i++;
      skip();
      while (i < n && raw.charAt(i) !== "}") {
        if (raw.charAt(i) !== '"') return false;
        const keyEnd = stringEnd(i);
        const key = JSON.parse(raw.slice(i, keyEnd)) as string;
        i = keyEnd;
        skip();
        if (raw.charAt(i) !== ":") return false;
        i++;
        if (!value(path === null ? null : path === "" ? key : `${path}\u0000${key}`)) return false;
        skip();
        if (raw.charAt(i) === ",") {
          i++;
          skip();
        }
      }
      i++;
    } else if (c === "[") {
      i++;
      skip();
      let index = 0;
      while (i < n && raw.charAt(i) !== "]") {
        if (!value(path === null ? null : path === "" ? String(index) : `${path}\u0000${index}`)) return false;
        index++;
        skip();
        if (raw.charAt(i) === ",") i++;
        skip();
      }
      i++;
    } else if (c === '"') {
      i = stringEnd(i);
    } else {
      const literal = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i, i + 400));
      if (!literal?.[0]) return false;
      i += literal[0].length;
    }
    if (i > n) return false;
    if (path !== null) spans.set(path, [start, i]);
    return true;
  };
  if (!value("")) spans.clear();
  return spans;
}

/** The last text indexed and its spans: the api page reads every endpoint's example from one document. */
let indexed: { raw: string; spans: Map<string, [number, number]> } | null = null;

/** The text of the value at a path of object keys (an array's item by its index, as text) inside a JSON text,
 *  exactly as written there (no parse and write
 *  again: every number keeps its spelling); `null` when the path is not in it. The text is indexed once (one pass),
 *  then every path is a lookup. */
export function rawValueAt(raw: string, keys: readonly string[]): string | null {
  if (indexed?.raw !== raw) indexed = { raw, spans: spansOf(raw) };
  const span = indexed.spans.get(keys.join("\u0000"));
  return span ? raw.slice(span[0], span[1]) : null;
}
