// What a refusal of the api names: the arguments it refused, so that a page can offer to ask without them.
import { ApiError, type AnyRequestError } from "../api/client";

/** The arguments a refusal names: its `argument`, and the field of each problem of its `details`. */
export function refusedArguments(error: AnyRequestError): string[] {
  if (!(error instanceof ApiError)) return [];
  const named = new Set<string>();
  if (error.body.argument) named.add(error.body.argument);
  for (const detail of error.body.details ?? []) {
    const last = detail.location[detail.location.length - 1];
    if (detail.location.length >= 2 && typeof last === "string") named.add(last);
  }
  return [...named];
}
