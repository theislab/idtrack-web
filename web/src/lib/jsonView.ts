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

const QUOTE = 34;
const BACKSLASH = 92;

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** Where a JSON value that starts at `i` (after white space) ends, or -1 where the text is not JSON: strings, objects
 *  and arrays are passed by counting brackets outside strings, without reading what they hold. */
function valueEnd(raw: string, i: number): number {
  const n = raw.length;
  const c = raw.charCodeAt(i);
  if (c === QUOTE) {
    let j = i + 1;
    while (j < n) {
      const d = raw.charCodeAt(j);
      if (d === BACKSLASH) j += 2;
      else if (d === QUOTE) return j + 1;
      else j++;
    }
    return -1;
  }
  if (c === 123 || c === 91) {
    let depth = 0;
    let j = i;
    while (j < n) {
      const d = raw.charCodeAt(j);
      if (d === QUOTE) {
        const end = valueEnd(raw, j);
        if (end < 0) return -1;
        j = end;
        continue;
      }
      if (d === 123 || d === 91) depth++;
      else if (d === 125 || d === 93) {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return -1;
  }
  const literal = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(i, i + 400));
  return literal?.[0] ? i + literal[0].length : -1;
}

/** The text of the value at a path of object keys (an array's item by its index, as text) inside a JSON text,
 *  exactly as written there (no parse and write again: every number keeps its spelling); `null` when the path is not
 *  in it. The text is walked once along the path: every value off the path is passed over by its brackets, not read
 *  (a lookup in the api's document costs a scan of the bytes before the value, and keeps nothing). */
export function rawValueAt(raw: string, keys: readonly string[]): string | null {
  const n = raw.length;
  let i = 0;
  const skip = () => {
    while (i < n && isSpace(raw.charCodeAt(i))) i++;
  };
  skip();
  for (const key of keys) {
    const open = raw.charAt(i);
    if (open !== "{" && open !== "[") return null;
    i++;
    let index = 0;
    let found = false;
    for (;;) {
      skip();
      const c = raw.charAt(i);
      if (c === "}" || c === "]" || i >= n) return null;
      let name = String(index);
      if (open === "{") {
        const keyEnd = valueEnd(raw, i);
        if (keyEnd < 0) return null;
        name = JSON.parse(raw.slice(i, keyEnd)) as string;
        i = keyEnd;
        skip();
        if (raw.charAt(i) !== ":") return null;
        i++;
        skip();
      }
      if (name === key) {
        found = true;
        break;
      }
      const end = valueEnd(raw, i);
      if (end < 0) return null;
      i = end;
      skip();
      if (raw.charAt(i) === ",") i++;
      index++;
    }
    if (!found) return null;
  }
  const end = valueEnd(raw, i);
  return end < 0 ? null : raw.slice(i, end);
}
