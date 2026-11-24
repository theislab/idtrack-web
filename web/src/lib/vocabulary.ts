// What the api's codes mean, as the api serves them (`/vocabulary`): idtrack's own tables (reasons, step reasons,
// criteria, match steps and prefixes, reasons of other readings, place relations, bridge rules; a criterion's meaning
// is idtrack's text of the Candidate field it compares), the api's own words where idtrack gives none (statuses, and
// the fields each criterion compares), each marked by its source, and the api's table of its error codes. Nothing here
// writes a meaning: a code whose meaning the api does not give is shown as the code, and the page says so.
import type { CriterionField, VocabularyResponse } from "../api/types";

export interface Criterion {
  code: string;
  meaning: string | null;
  /** The Candidate fields the ranking compares for this criterion, in order (empty without the api's vocabulary). */
  fields: CriterionField[];
}

export interface Vocabulary {
  /** The api answered `/vocabulary`; without it every code is shown as itself. */
  available: boolean;
  statuses: Map<string, string | null>;
  reasons: Map<string, string | null>;
  stepReasons: Map<string, string | null>;
  /** The criteria in the order in which they decide. */
  criteria: Criterion[];
  /** idtrack's text of every Candidate field (the ranking record). */
  candidateFields: Map<string, string | null>;
  matchSteps: Map<string, string | null>;
  /** The prefixes of a match, in the order in which they are written. */
  matchPrefixes: Map<string, string | null>;
  readingReasons: Map<string, string | null>;
  placeRelations: Map<string, string | null>;
  bridgeRules: Map<string, { meaning: string | null; taken: boolean }>;
  errors: Map<string, { status: number; meaning: string }>;
}

export const NO_VOCABULARY: Vocabulary = {
  available: false,
  statuses: new Map(),
  reasons: new Map(),
  stepReasons: new Map(),
  criteria: [],
  candidateFields: new Map(),
  matchSteps: new Map(),
  matchPrefixes: new Map(),
  readingReasons: new Map(),
  placeRelations: new Map(),
  bridgeRules: new Map(),
  errors: new Map(),
};

export function readVocabulary(data: VocabularyResponse): Vocabulary {
  const terms = (list: { code: string; meaning: string | null }[]) => new Map(list.map((t) => [t.code, t.meaning]));
  return {
    available: true,
    statuses: terms(data.statuses),
    reasons: terms(data.reasons),
    stepReasons: terms(data.step_reasons),
    criteria: data.criteria.map((t) => ({ code: t.code, meaning: t.meaning, fields: t.fields })),
    candidateFields: terms(data.candidate_fields),
    matchSteps: terms(data.match_steps),
    matchPrefixes: terms(data.match_prefixes),
    readingReasons: terms(data.reading_reasons),
    placeRelations: terms(data.place_relations),
    bridgeRules: new Map(data.bridge_rules.map((t) => [t.code, { meaning: t.meaning, taken: t.taken }])),
    errors: new Map(data.errors.map((t) => [t.code, { status: t.status, meaning: t.meaning }])),
  };
}

/** A code for reading: `new_version` -> `new version`. The code itself, spaced; never a meaning. */
export function spaced(code: string): string {
  return code.replace(/_/g, " ");
}

/** A status in a few words, from its code (`no_target` -> `No target`). */
export function statusTitle(code: string): string {
  const text = spaced(code);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The meaning of a criterion and its place in the order, or null where the api does not give it. */
export function criterionOf(vocabulary: Vocabulary, code: string | null | undefined) {
  if (!code) return null;
  const index = vocabulary.criteria.findIndex((c) => c.code === code);
  const criterion = vocabulary.criteria[index];
  return criterion ? { index, ...criterion } : null;
}

/** One part of a match (`unicode:synonym:exact` -> its prefixes, then its step), each with the api's meaning. */
export interface MatchPart {
  code: string;
  role: "prefix" | "step";
  meaning: string | null;
}

/** A match read into its parts as idtrack writes it: the prefixes that apply, each followed by `:`, then the step. */
export function matchParts(vocabulary: Vocabulary, match: string): MatchPart[] {
  const parts = match.split(":");
  const step = parts.pop() ?? "";
  return [
    ...parts.map((code) => ({ code, role: "prefix" as const, meaning: vocabulary.matchPrefixes.get(code) ?? null })),
    { code: step, role: "step" as const, meaning: vocabulary.matchSteps.get(step) ?? null },
  ];
}
