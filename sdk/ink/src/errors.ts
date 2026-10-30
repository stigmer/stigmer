// A failure worded for a person at a terminal: what failed, the address
// tried, and the next step by what kind of failure it is. The client's
// classifyError names the kind and getUserMessage the plain cause
// (@stigmer/client, errors.ts); the raw message is kept as `details` for
// whoever needs it, never as the headline.
//
// Proven by __tests__/errors.test.ts.

import { classifyError, getUserMessage, type ErrorCategory } from "@stigmer/client";
import { ExitCode, exitCodeOf } from "@stigmer/client/node";

/** What the kit was doing when it failed. */
export type FailedStep = "start" | "load" | "stream";

/** A failure as the terminal says it. */
export interface ConnectionFailure {
  /** One sentence: what failed and where, e.g. "Could not load the session from http://localhost:7234." */
  readonly headline: string;
  /** The plain cause, from the client's wording of the error. */
  readonly cause: string;
  /** What to do next. */
  readonly next: string;
  /** The error's own message, for a details line. */
  readonly details: string;
}

const WHAT: Record<FailedStep, string> = {
  start: "Could not start the run at",
  load: "Could not load the session from",
  stream: "Lost the session's stream from",
};

const NEXT: Record<ErrorCategory, string> = {
  unavailable: "Is the server running? Start one with `stigmer up`, or pass --base-url.",
  auth: "Check STIGMER_API_KEY: the server did not accept the key.",
  permission: "Check STIGMER_API_KEY: the key's account may not use this organization or agent.",
  "not-found": "Check the session id and the organization, or the agent's org/slug.",
  validation: "Check the arguments: the server refused the request as given.",
  server: "The server failed. Try again, and check its logs if it repeats.",
  cancelled: "The request was cancelled.",
  unknown: "Try again; if it repeats, the details below say what the client saw.",
};

/** A socket-level failure Node reports in a plain Error's message, before any RPC status exists. */
const NO_CONNECTION = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i;

/** The failure's kind: the client's, or unavailable when an unclassified error says no connection was made. */
function categoryOf(error: unknown, details: string): ErrorCategory {
  const category = classifyError(error);
  return category === "unknown" && NO_CONNECTION.test(details) ? "unavailable" : category;
}

/** Words a failure for a terminal: the step, the address tried, the cause and the next step. */
export function describeConnectionFailure(error: unknown, baseUrl: string, step: FailedStep): ConnectionFailure {
  const details = error instanceof Error ? error.message : String(error);
  return {
    headline: `${WHAT[step]} ${baseUrl === "" ? "the server" : baseUrl}.`,
    cause: getUserMessage(error),
    next: NEXT[categoryOf(error, details)],
    details,
  };
}

/**
 * The exit code for a failure, read the way {@link describeConnectionFailure}
 * words it: a socket error the client leaves unclassified is "cannot
 * connect" (3) here too, so the sentence and the code never disagree.
 */
export function failureExitCode(error: unknown): ExitCode {
  const details = error instanceof Error ? error.message : String(error);
  return categoryOf(error, details) === "unavailable" ? ExitCode.Connection : exitCodeOf(error);
}
