// What keeps the home's picture away, in the words of its caption's line: the endpoint that failed, what it answered,
// and what happens next (lib/useRequest.ts asks again by itself after a wait a refusal names, once, and when the
// connection returns). Its own module, so that the home's first chunk holds it without the pictures' code.
import { ApiError, TimeoutError, UnreachableError, type AnyRequestError } from "../../api/client";
import { AUTO_RETRY_MAX_SECONDS, waitsToRetry } from "../useRequest";

/** What failed, in the caption's words: the endpoint and the api's answer, and what happens next. `first`: the first
 *  failure of this request (a refusal that names its wait is asked again once, after it). */
export function failureWords(endpoint: string, error: AnyRequestError, first: boolean): string {
  if (error instanceof ApiError) {
    const again =
      first && waitsToRetry(error) && (error.retryAfter ?? 0) <= AUTO_RETRY_MAX_SECONDS
        ? `; it is asked again in ${String(error.retryAfter)} s`
        : "; reload the page to ask again";
    return `${endpoint} answered ${String(error.status)} ${error.body.code}${again}.`;
  }
  if (error instanceof UnreachableError)
    return error.offline
      ? `the browser is offline; ${endpoint} is asked again when the connection returns.`
      : `the server cannot be reached; ${endpoint} is asked again when the connection returns.`;
  if (error instanceof TimeoutError) return `${endpoint} did not answer in time; reload the page to ask again.`;
  return `the answer of ${endpoint} is not of the form its document gives; reload the page to ask again.`;
}
