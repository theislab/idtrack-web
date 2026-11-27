// A list of identifiers for a batch: its lines (every common line ending), and a file read as text with its encoding
// found from its bytes, so that what is sent is what the person sees.

/** The draft key under which the batch's typed or pasted list is kept (lib/drafts.ts); the Convert page puts a
 *  pasted column there to hand it to Batch. */
export const BATCH_TEXT_DRAFT = "batch.text";

/** Every common line ending: LF, CRLF, CR, and the line and next-line separators some exports write. */
const LINE_ENDS = /\r\n|\r|\n|\u2028|\u0085/;

/** The text with every line ending written as LF (what a textarea shows is then what is counted and sent). */
export function normalizeLines(text: string): string {
  return text.split(LINE_ENDS).join("\n");
}

/** One identifier per line; a line of a table gives the cell of its first column. Empty lines are skipped. */
export function parseList(text: string): string[] {
  return parseTable(text).identifiers;
}

/** The separators of a table's cells, in the order in which one is chosen for a text. */
const SEPARATORS = ["\t", ",", ";"] as const;
export type Separator = (typeof SEPARATORS)[number];

/** The words of a separator, for the page. */
export const SEPARATOR_WORDS: Record<Separator, string> = { "\t": "tab", ",": "comma", ";": "semicolon" };

/** The cells of a line: split at the separator outside double quotes; a cell quoted as a spreadsheet quotes it
 *  (`"a,b"`, `"say ""x"""`) is read without its quotes. Every cell is trimmed. */
export function splitCells(line: string, separator: Separator | null): string[] {
  if (separator === null) return [line.trim()];
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === separator) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** The kind of a cell by its form alone: a number, an Ensembl stable id (`ENS`, the species' letters, the kind's
 *  letter and eleven digits, perhaps a version), or any other text. */
export type CellKind = "number" | "ensembl" | "text" | "empty";
const NUMBER = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?%?$/;
const ENSEMBL = /^ENS[A-Z]*[EGPRT]\d{11}(\.\d+)?$/;
export function cellKind(cell: string): CellKind {
  if (cell === "") return "empty";
  if (NUMBER.test(cell)) return "number";
  if (ENSEMBL.test(cell)) return "ensembl";
  return "text";
}

/** How the first line of a table was judged a header, in words (null: it was not). */
export interface HeaderReason {
  column: number;
  kind: "number" | "ensembl" | "space";
}

/**
 * Whether the first line of a table is its header, by the form of its cells only (nothing here knows a gene): with at
 * least two lines after it, the first line is a header when, in some column, nine in ten of the other lines' cells are
 * numbers (or Ensembl ids) and its own cell there is text that is neither; or when its cell in the column read holds a
 * space and no other line's cell there does (an identifier holds no space).
 */
export function detectHeader(lines: readonly string[][], column: number): HeaderReason | null {
  const first = lines[0];
  const rest = lines.slice(1);
  if (!first || rest.length < 2) return null;
  const width = Math.max(...lines.map((l) => l.length));
  for (let c = 0; c < width; c++) {
    const own = cellKind(first[c] ?? "");
    if (own !== "text") continue;
    const kinds = rest.map((l) => cellKind(l[c] ?? "")).filter((k) => k !== "empty");
    if (kinds.length < 2) continue;
    for (const kind of ["number", "ensembl"] as const) {
      if (kinds.filter((k) => k === kind).length >= 0.9 * kinds.length) return { column: c, kind };
    }
  }
  const cell = first[column] ?? "";
  if (/\s/.test(cell) && rest.every((l) => !/\s/.test(l[column] ?? ""))) return { column, kind: "space" };
  return null;
}

/** A list read as a table: its lines' cells, the header when its first line is one, the column read. */
export interface ListTable {
  separator: Separator | null;
  /** The number of columns (the most cells of a line). */
  columns: number;
  /** The first line, when it is taken as the header (detected, or as the person said). */
  header: string[] | null;
  /** The header as detected from the cells' form (whether or not it is used). */
  detected: HeaderReason | null;
  /** The column read (from 0). */
  column: number;
  /** The identifiers, one per data line whose cell in the column read is not empty, in order. */
  identifiers: string[];
  /** For each identifier, its line of the text (from 1) and all of that line's cells (the person's own columns). */
  rows: { line: number; cells: string[] }[];
  /** Data lines whose cell in the column read is empty (from 1), which are not sent. */
  skipped: number[];
}

export interface TableChoice {
  /** null: as detected. */
  header?: boolean | null;
  /** The column to read (from 0); past the last column, the first. */
  column?: number;
}

/** A text read as a list or a table: the separator is the first of tab, comma and semicolon the text holds (a list
 *  without any is one column); empty lines are skipped. */
export function parseTable(text: string, choice: TableChoice = {}): ListTable {
  const raw = text.split(LINE_ENDS);
  const separator = SEPARATORS.find((s) => text.includes(s)) ?? null;
  const lines: { line: number; cells: string[] }[] = [];
  raw.forEach((line, i) => {
    if (line.trim() === "") return;
    lines.push({ line: i + 1, cells: splitCells(line, separator) });
  });
  const columns = Math.max(1, ...lines.map((l) => l.cells.length));
  const column = choice.column !== undefined && choice.column >= 0 && choice.column < columns ? choice.column : 0;
  const detected = detectHeader(
    lines.map((l) => l.cells),
    column,
  );
  const useHeader = choice.header ?? detected !== null;
  const header = useHeader && lines.length ? (lines[0]?.cells ?? null) : null;
  const data = header ? lines.slice(1) : lines;
  const identifiers: string[] = [];
  const rows: { line: number; cells: string[] }[] = [];
  const skipped: number[] = [];
  for (const l of data) {
    const cell = l.cells[column] ?? "";
    if (cell === "") skipped.push(l.line);
    else {
      identifiers.push(cell);
      rows.push(l);
    }
  }
  return { separator, columns, header, detected, column, identifiers, rows, skipped };
}

/** A text in a form a spreadsheet gives a date it made of a cell (`1-Mar`, `Sep-2`, `2-Sep-2023`, `2023-09-02`): a
 *  symbol such as MARCH1 or SEPT2 opened in a spreadsheet becomes one. The form alone is judged, never a gene. */
export function looksLikeSpreadsheetDate(text: string): boolean {
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  const forms = [
    new RegExp(`^\\d{1,2}[-/ ]${month}([-/ ]\\d{2,4})?$`, "i"),
    new RegExp(`^${month}[-/ ]\\d{1,4}$`, "i"),
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  ];
  return forms.some((f) => f.test(text.trim()));
}

/** The identifiers (1-based line numbers of the list) that hold a control character, which the api refuses. */
export function linesWithControls(identifiers: readonly string[]): number[] {
  const found: number[] = [];
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is looked for
  const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  identifiers.forEach((identifier, i) => {
    if (control.test(identifier)) found.push(i + 1);
  });
  return found;
}

export type DecodedFile =
  | { ok: true; text: string; encoding: "UTF-8" | "UTF-16LE" | "UTF-16BE" | "UTF-32LE" | "UTF-32BE" | "windows-1252" }
  | { ok: false; problem: string };

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/** Text in UTF-32 (the browser's decoders do not read it): four bytes a character after the mark; a file whose length
 *  is no multiple of four, or with a value that is no character, is not read. */
function utf32(bytes: Uint8Array, little: boolean): DecodedFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ((bytes.length - 4) % 4 !== 0)
    return {
      ok: false,
      problem: "begins with UTF-32's mark but its length is not whole characters of it. Save it as UTF-8.",
    };
  let text = "";
  for (let i = 4; i < bytes.length; i += 4) {
    const code = view.getUint32(i, little);
    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      return {
        ok: false,
        problem: "begins with UTF-32's mark but holds a value that is no character. Save it as UTF-8.",
      };
    text += String.fromCodePoint(code);
  }
  return { ok: true, text, encoding: little ? "UTF-32LE" : "UTF-32BE" };
}

/** A file's bytes as text. A byte-order mark names UTF-32, UTF-16 or UTF-8; text that is valid UTF-8 is read as such; a
 *  spreadsheet or archive (ZIP or OLE signature) or bytes with many NULs is not a text file; anything else is read
 *  as Windows-1252 (Latin-1's superset that spreadsheets on Windows write), and the page says so. */
export function decodeFile(buffer: ArrayBuffer): DecodedFile {
  const bytes = new Uint8Array(buffer);
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return {
      ok: false,
      problem:
        "is a spreadsheet or an archive, not a text file. Save the column of identifiers as text (CSV or TSV) and upload that.",
    };
  }
  // UTF-32's marks first: its little-endian mark begins with UTF-16's.
  if (startsWith(bytes, [0xff, 0xfe, 0x00, 0x00])) return utf32(bytes, true);
  if (startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])) return utf32(bytes, false);
  if (startsWith(bytes, [0xff, 0xfe]))
    return { ok: true, text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16LE" };
  if (startsWith(bytes, [0xfe, 0xff]))
    return { ok: true, text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16BE" };
  // UTF-16 without a mark: NULs in every other byte of ASCII text.
  const sample = bytes.subarray(0, 4096);
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) evenNul++;
      else oddNul++;
    }
  }
  const half = sample.length / 2;
  if (half > 0 && oddNul > half * 0.6 && evenNul === 0) {
    return { ok: true, text: new TextDecoder("utf-16le").decode(bytes), encoding: "UTF-16LE" };
  }
  if (half > 0 && evenNul > half * 0.6 && oddNul === 0) {
    return { ok: true, text: new TextDecoder("utf-16be").decode(bytes), encoding: "UTF-16BE" };
  }
  if (evenNul + oddNul > 0) {
    return { ok: false, problem: "holds NUL bytes, so it is not a text file. Upload a text, CSV or TSV file." };
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { ok: true, text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
