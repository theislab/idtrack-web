// Every answer is checked against the shape the api's document gives it (src/api/shapes.ts, generated from
// api/openapi.json) before a page reads it: an answer of another form is "an answer the page cannot read", stated
// where the answer would be, never a page that breaks while it draws. Only the form is checked (which fields there are
// and their JSON types); values are the api's to choose, and a code the document does not list is shown as itself.
import type { Shape } from "./shapeForm";
import { SCHEMAS } from "./shapes";

export type { Shape } from "./shapeForm";

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "an object";
  if (typeof value === "number") return Number.isInteger(value) ? "an integer" : "a number";
  return `a ${typeof value}`;
}

const NAMES: Record<string, string> = {
  string: "a string",
  integer: "an integer",
  number: "a number",
  boolean: "a boolean",
  null: "null",
  object: "an object",
};

/** Where a value stands in the answer: a chain of keys and indexes from the root (null), written out only when a
 *  check fails, so that checking a large answer builds no text for the values that have their form. */
interface At {
  parent: At | null;
  key: string | number;
}

/** The place in words: `candidates[2].path`, or "the answer" for the root. */
function placeOf(at: At | null): string {
  const parts: (string | number)[] = [];
  for (let node = at; node !== null; node = node.parent) parts.push(node.key);
  let text = "";
  for (const part of parts.reverse()) text += typeof part === "number" ? `[${part}]` : text === "" ? part : `.${part}`;
  return text === "" ? "the answer" : text;
}

/** A departure from the form: where, and what is there instead (its text is made only when it is said). */
interface Departure {
  at: At | null;
  what: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const not = (at: At | null, value: unknown, form: string): Departure => ({
  at,
  what: `is ${typeName(value)}, not ${form}`,
});

function departure(value: unknown, shape: Shape, at: At | null, schemas: Record<string, Shape>): Departure | null {
  if (typeof shape === "string") {
    switch (shape) {
      case "any":
        return null;
      case "integer":
        return typeof value === "number" && Number.isInteger(value) ? null : not(at, value, "an integer");
      case "number":
        return typeof value === "number" ? null : not(at, value, "a number");
      case "null":
        return value === null ? null : not(at, value, "null");
      case "object":
        return isRecord(value) ? null : not(at, value, "an object");
      default:
        return typeof value === shape ? null : not(at, value, NAMES[shape] ?? shape);
    }
  }
  if ("r" in shape) {
    const named = schemas[shape.r];
    return named === undefined ? null : departure(value, named, at, schemas);
  }
  if ("u" in shape) {
    const found: (Departure | null)[] = [];
    for (const option of shape.u) {
      const d = departure(value, option, at, schemas);
      if (d === null) return null;
      found.push(d);
    }
    // One of the options is null: the value is meant as the other one, whose departure is the one to name.
    const meant = shape.u.filter((option) => option !== "null");
    return meant.length === 1
      ? (found[shape.u.indexOf(meant[0] as Shape)] ?? null)
      : { at, what: "has none of its forms" };
  }
  if ("a" in shape) {
    if (!Array.isArray(value)) return not(at, value, "a list");
    for (let i = 0; i < value.length; i++) {
      const d = departure(value[i], shape.a, { parent: at, key: i }, schemas);
      if (d !== null) return d;
    }
    return null;
  }
  if ("t" in shape) {
    if (!Array.isArray(value)) return not(at, value, "a list");
    if (value.length !== shape.t.length) return { at, what: `has ${value.length} items, not ${shape.t.length}` };
    for (const [i, item] of shape.t.entries()) {
      const d = departure(value[i], item, { parent: at, key: i }, schemas);
      if (d !== null) return d;
    }
    return null;
  }
  if ("m" in shape) {
    if (!isRecord(value)) return not(at, value, "an object");
    for (const key in value) {
      const d = departure(value[key], shape.m, { parent: at, key }, schemas);
      if (d !== null) return d;
    }
    return null;
  }
  if (!isRecord(value)) return not(at, value, "an object");
  for (const [key, field] of Object.entries(shape.o)) {
    if (!(key in value)) return { at, what: `has no field ${key}` };
    const d = departure(value[key], field, { parent: at, key }, schemas);
    if (d !== null) return d;
  }
  if (shape.opt)
    for (const [key, field] of Object.entries(shape.opt)) {
      if (!(key in value)) continue;
      const d = departure(value[key], field, { parent: at, key }, schemas);
      if (d !== null) return d;
    }
  return null;
}

/** The first place where `value` departs from `shape` (a path such as `candidates[2].path`, and what is there), or
 *  null when it has the shape. `schemas` names the shapes that `{r}` refers to. The path is written only for a
 *  departure: checking an answer of a thousand results with their paths builds no text. */
export function shapeProblem(value: unknown, shape: Shape, schemas: Record<string, Shape> = SCHEMAS): string | null {
  const d = departure(value, shape, null, schemas);
  return d === null ? null : `${placeOf(d.at)} ${d.what}`;
}
