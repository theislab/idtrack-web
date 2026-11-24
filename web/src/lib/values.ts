// The values of a candidate's ranking record, shown by their type: yes or no for a truth value, a dash for a value that
// is absent (its meaning on focus), numbers as the api wrote them, a tuple by the names of its parts where the api's
// vocabulary names them. No spelling of the language that made them.
import type { Candidate, CriterionField } from "../api/types";
import { pythonFloat } from "./numbers";

export interface Shown {
  text: string;
  /** What the value means where the text alone does not say it (on focus and hover). */
  title?: string;
  /** The value is the engine's sort key, whose parts the api does not name (shown as given, marked). */
  sortKey?: boolean;
}

/** A dash for an absent value. */
export const ABSENT = "—";

export function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** Which value of a field ranks first, in words. */
export const FIRST_WORDS: Record<CriterionField["first"], string> = {
  yes: "yes ranks first",
  lower: "the lower value ranks first",
  higher: "the higher value ranks first",
};

/** Which value of a compared field ranks first, in words: for a tuple of negated counts, said of the counts shown. */
export function firstWords(field: Pick<CriterionField, "field" | "first" | "parts">): string {
  const name = field.field.replace(/_/g, " ");
  if (field.parts?.length) {
    const counts = field.first === "lower" ? "more" : field.first === "higher" ? "fewer" : "";
    return `${name}: ${counts} ${field.parts.join(", then ")} rank first`;
  }
  return `${name}: ${FIRST_WORDS[field.first]}`;
}

/**
 * A field's value of a candidate. `meaning` is the field's text from the api; `parts` the names of the parts of a
 * tuple, each the negated count (the api's vocabulary names them for `annotation`): shown as the counts, named.
 */
export function candidateValue(
  field: string,
  candidate: Candidate,
  meaning: string | null = null,
  parts: readonly string[] | null = null,
): Shown {
  const value: unknown = (candidate as unknown as Record<string, unknown>)[field];
  const absent = (): Shown => (meaning ? { text: ABSENT, title: `Not given. ${prose(meaning)}` } : { text: ABSENT });
  if (value === null || value === undefined) return absent();
  if (typeof value === "boolean") return { text: yesNo(value) };
  if (typeof value === "number") return { text: field === "score" ? pythonFloat(value) : String(value) };
  if (Array.isArray(value)) {
    const numbers = value.filter((v): v is number => typeof v === "number");
    if (parts?.length === value.length && numbers.length === value.length) {
      const counts = numbers.map((v, i) => `${parts[i] ?? ""} ${String(-v)}`);
      return { text: counts.join(", "), title: `As idtrack gives it: (${value.map(String).join(", ")})` };
    }
    return { text: `(${value.map(String).join(", ")})`, sortKey: true, ...(meaning ? { title: prose(meaning) } : {}) };
  }
  return { text: typeof value === "string" ? value : JSON.stringify(value) };
}

/**
 * A criterion's value of a candidate: the value of each field its ranking compares (the api's vocabulary), named
 * where it is not the criterion's own field; without the vocabulary, the field of the criterion's name.
 */
export function criterionValue(
  criterion: { code: string; meaning: string | null; fields: readonly CriterionField[] },
  candidate: Candidate,
): Shown {
  const fields = criterion.fields.length
    ? criterion.fields
    : [{ field: criterion.code, first: null, parts: null as string[] | null }];
  const shown = fields.map((f) => ({
    f,
    v: candidateValue(f.field, candidate, f.field === criterion.code ? criterion.meaning : null, f.parts),
  }));
  const order = fields
    .filter((f): f is CriterionField => f.first !== null)
    .map(firstWords)
    .join("; ");
  const [only] = shown;
  if (only && shown.length === 1 && only.f.field === criterion.code) {
    return { ...only.v, ...(order ? { title: [only.v.title, order].filter(Boolean).join(". ") } : {}) };
  }
  return {
    text: shown.map(({ f, v }) => `${f.field.replace(/_/g, " ")} ${v.text}`).join(", "),
    sortKey: shown.some(({ v }) => v.sortKey === true),
    ...(order ? { title: order } : {}),
  };
}

/** A text of idtrack or the api for reading: code spans kept as they are, the absent value written as "none". */
export function prose(text: string): string {
  return text
    .replace(/`None`/g, "none")
    .replace(/`True`/g, "yes")
    .replace(/`False`/g, "no");
}
