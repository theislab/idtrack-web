// The compact form of a JSON schema that the api's answers are checked against (src/api/shape.ts), written by
// scripts/generate-types.ts into src/api/shapes.ts: a type name, or an object `{a}` (a list), `{t}` (a list of fixed
// length), `{o, opt}` (an object with its required and optional fields; other fields are allowed), `{m}` (an object
// whose every value has one shape), `{u}` (one of several), `{r}` (a named schema). A module of its own, so that the
// generated shapes, the checker and the generator share it without importing one another.
export type Shape =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null"
  | "object"
  | "any"
  | { a: Shape }
  | { t: Shape[] }
  | { o: Record<string, Shape>; opt?: Record<string, Shape> }
  | { m: Shape }
  | { u: Shape[] }
  | { r: string };
