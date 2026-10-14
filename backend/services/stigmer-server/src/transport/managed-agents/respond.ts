/**
 * How the lane writes a whole answer: JSON with the request's id in the
 * `request-id` header, where Anthropic's SDK reads it, and an error as
 * Anthropic's envelope with the same id in its body. A POST's error also
 * says `x-should-retry: false`: the SDK retries 408, 409, 429 and 5xx on
 * its own and sends no idempotency key, so a retried send could start a
 * second turn. The answer to whether a send landed is a list, not a retry.
 *
 * Both protocol stacks run the lane (lanes.ts), so only the members they
 * share are used.
 */
import type { LaneResponse } from "../lanes.js";
import { errorEnvelope, type LaneError } from "./errors.js";

/** The response header Anthropic's SDK reads a request's id from. */
export const REQUEST_ID_HEADER = "request-id";

export function writeJson(response: LaneResponse, status: number, requestId: string, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader(REQUEST_ID_HEADER, requestId);
  response.end(JSON.stringify(body));
}

export function writeError(
  response: LaneResponse,
  requestId: string,
  error: LaneError,
  options: { readonly noRetry?: boolean; readonly allow?: string } = {},
): void {
  response.statusCode = error.status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader(REQUEST_ID_HEADER, requestId);
  if (options.noRetry === true) {
    response.setHeader("x-should-retry", "false");
  }
  if (options.allow !== undefined) {
    response.setHeader("Allow", options.allow);
  }
  response.end(errorEnvelope(error, requestId));
}
