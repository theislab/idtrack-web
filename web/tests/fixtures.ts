// The recorded answers of the real api (pig and human graphs): tests/fixtures/<organism>/index.json lists each
// request, its status and the file that holds the body exactly as the api sent it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConversionResult, GraphDescription, VocabularyResponse } from "../src/api/types";

export interface Recorded {
  organism: string;
  name: string;
  method: string;
  path: string;
  query: Record<string, string | number | boolean>;
  status: number;
  file: string;
  raw: string;
}

const ROOT = join(import.meta.dirname, "fixtures");
export const ORGANISMS = ["sus_scrofa", "homo_sapiens"];

export function recorded(organism: string): Recorded[] {
  const index = JSON.parse(readFileSync(join(ROOT, organism, "index.json"), "utf8")) as Omit<
    Recorded,
    "organism" | "raw"
  >[];
  return index.map((entry) => ({ ...entry, organism, raw: readFileSync(join(ROOT, organism, entry.file), "utf8") }));
}

/** Every successful single conversion of both graphs, with its raw text. */
export function conversions(): { entry: Recorded; result: ConversionResult }[] {
  return ORGANISMS.flatMap((organism) =>
    recorded(organism)
      .filter((e) => e.path.endsWith("/convert") && e.status === 200)
      .map((entry) => ({ entry, result: JSON.parse(entry.raw) as ConversionResult })),
  );
}

export function description(organism: string): GraphDescription {
  const entry = recorded(organism).find((e) => e.name === "organism");
  if (!entry) throw new Error(`no description of ${organism}`);
  return JSON.parse(entry.raw) as GraphDescription;
}

export function fixture(organism: string, name: string): Recorded {
  const entry = recorded(organism).find((e) => e.name === name);
  if (!entry) throw new Error(`no fixture ${organism}/${name}`);
  return entry;
}

/** The api's vocabulary as recorded (it is the same for every graph: idtrack's tables and the api's error codes). */
export function vocabularyResponse(): VocabularyResponse {
  return JSON.parse(fixture("sus_scrofa", "vocabulary").raw) as VocabularyResponse;
}
