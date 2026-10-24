/**
 * Whether a failed model call is worth trying again: one rule for every
 * model the runner builds, and the hook that applies it to LangChain's own
 * retry loop.
 *
 * Two loops try a model call again, and they never see the same failure:
 *
 *  - The request loop is LangChain's client retry (`AsyncCaller`, p-retry:
 *    a 1 s start, factor 2, a 1x to 2x spread, never shorter than an
 *    error's `retryAfterMs`). It covers the request until the provider's
 *    reply begins, and nothing after: the wrappers read the streamed events
 *    outside it. `buildChatModel` gives every model {@link MODEL_REQUEST_RETRIES}
 *    and {@link modelRequestFailed}, which replaces LangChain's own
 *    classification with this one.
 *  - The stream loop is `middleware/model-retry.ts`: a reply that fails
 *    after it began (an `event: error` after a 200, a dropped connection)
 *    is tried again there, at most {@link MODEL_STREAM_RETRIES} times.
 *
 * The request loop marks every error it has handled, retried in place or
 * given up on, with LangChain's own non-retryable stamp (`stampRetryable`;
 * p-retry calls the hook on every failed attempt, the last included), and
 * this rule stops on a stamped error. So the stream loop only ever retries
 * a failure the request loop never saw, and no failure is retried twice
 * over. The stamp has no other reader in the runner's dependencies but
 * LangChain's default hook, which this one replaces.
 *
 * The rule reads the whole `cause` chain, never only its last link: the
 * SDK's connection error keeps undici's `TypeError` beneath it, and
 * LangChain's `MiddlewareError` copies its cause's name and message onto
 * itself. Every stop is checked over the whole chain before any retry, so a
 * stamp or an abort anywhere wins over a retryable shape anywhere. In order:
 *
 *  1. An abort stops: the person pressed stop (`AbortError`, the SDK's
 *     `APIUserAbortError`, LangChain's `ModelAbortError`, LangChain's
 *     `Cancel…` messages).
 *  2. The cloud's missing-key refusal stops (`PROVIDER_KEY_REQUIRED_SENTINEL`);
 *     an organization key's 401 or 403 stops by status like any other.
 *  3. Billing prose stops: no credit is not a passing condition.
 *  4. A context overflow stops: the same request overflows again.
 *  5. An error the request loop handled stops (the stamp, above; LangChain
 *     also stamps its own `ContextOverflowError` at birth, which 4 names
 *     first).
 *  6. A provider's status decides, read off the first link that carries
 *     one. `x-should-retry` is the provider's own answer and wins both ways
 *     (the cloud's own refusals say `false`). A 429 goes to LangChain's
 *     `classifyRateLimitError`: quota stops, everything else retries, a
 *     429 with no hint included, which is where this rule departs from
 *     LangChain's (it gives up on a headerless 429; the cloud's relay sent
 *     no hint until 2026-10, and every rate limit is passing by nature).
 *     408, 409 (the SDK's own rule) and every status of 500 and above
 *     retry, 529 included; every other status is a refusal and stops.
 *  7. A failure with no status mid-reply decides by the provider's error
 *     type: `overloaded_error` and `rate_limit_error` retry; `api_error`
 *     (and OpenAI's `server_error`) retry unless the message names
 *     Bedrock's `validationException`, because the Bedrock SDK reports its
 *     deterministic refusal as `api_error` too; every other type stops.
 *  8. A failed connection retries: the SDKs' `APIConnectionError` and
 *     `APIConnectionTimeoutError`, an error named `TimeoutError` (the shape
 *     LangChain's OpenAI wrapper gives the SDK's timeout; never a
 *     DOMException's, `model-error.ts` `isModelTimeout`), and a `TypeError`
 *     carrying one of p-retry's network messages (a cut stream surfaces as
 *     undici's bare `terminated`).
 *  9. Anything else stops. The runner retries only what it identifies, as
 *     `http-retry.ts` does: a bug in the runner's own model path, or a
 *     cloud credential the backend adapter could not load, fails at once
 *     instead of after two minutes of retries.
 *
 * A retry the provider asks to wait more than a minute for stops instead
 * (LangChain's own threshold for a 429): past the turn's 180 s silence
 * guard a wait becomes a continuation, and past an hour it exhausts them.
 */

import { ContextOverflowError, ModelAbortError, getRetryable, stampRetryable } from "@langchain/core/errors";
import {
  classifyRateLimitError,
  parseRetryAfterMs,
  type FailedAttemptHandler,
} from "@langchain/core/utils/async_caller";

import {
  PROVIDER_KEY_REQUIRED_SENTINEL,
  causeChainOf,
  isModelTimeout,
  isProviderBillingMessage,
  providerErrorTypeOf,
} from "./model-error.js";

/**
 * Retries the request loop makes after the first attempt: LangChain's own
 * default. Its waits (1-2, 2-4, … 32-64 s; 63 to 126 s in all) fit inside
 * the turn's 180 s silence guard, so a provider that is down for a minute
 * or two is ridden out, and one down for longer fails with its reason.
 */
export const MODEL_REQUEST_RETRIES = 6;

/**
 * Retries of a reply that failed after it began: two, on the request loop's
 * first two waits (1-2 s, 2-4 s). Each retry is a whole new request, with
 * its own request retries, so a provider that keeps failing mid-reply
 * fails the turn in seconds rather than minutes.
 */
export const MODEL_STREAM_RETRIES = 2;

/** The longest wait a provider may ask for and still be waited out: LangChain's own threshold for a 429. */
export const RETRY_AFTER_CEILING_MS = 60_000;

/** Why a failed model call was tried again. */
export type RetryReason =
  | "rate_limited"
  | "overloaded"
  | "server_error"
  | "request_timeout"
  | "conflict"
  | "provider_asked"
  | "stream_error"
  | "connection"
  | "timeout";

/** Why a failed model call was not tried again. */
export type StopReason =
  | "aborted"
  | "handled"
  | "key_required"
  | "billing"
  | "context_overflow"
  | "provider_refused"
  | "quota"
  | "retry_after_too_long"
  | "refused"
  | "unrecognized";

export type RetryDecision =
  | { readonly retry: true; readonly reason: RetryReason; readonly status?: number; readonly retryAfterMs?: number }
  | { readonly retry: false; readonly reason: StopReason; readonly status?: number };

/**
 * The messages p-retry counts as a network failure of `fetch`, twinned from
 * `@langchain/core` (`dist/utils/is-network-error/index.js`, 1.2.13), which
 * does not export it. Undici says `fetch failed` for a connection that never
 * opened and `terminated` for one cut mid-body.
 */
const NETWORK_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  "network error",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "The Internet connection appears to be offline.",
  "Network request failed",
  "fetch failed",
  "terminated",
  " A network error occurred.",
  "Network connection lost",
]);

/** The provider error types a reply that failed mid-stream is retried for (rule 7). */
const RETRYABLE_STREAM_TYPES: Readonly<Record<string, RetryReason>> = {
  overloaded_error: "overloaded",
  rate_limit_error: "rate_limited",
  api_error: "stream_error",
  server_error: "stream_error",
};

/** Whether a failed model call is worth trying again, and why (the header's rule). */
export function retryDecisionOf(err: unknown): RetryDecision {
  const links = causeChainOf(err);
  const statusLink = links.find((link) => statusOf(link) !== undefined);
  const status = statusLink === undefined ? undefined : statusOf(statusLink);
  const stop = (reason: StopReason): RetryDecision => ({ retry: false, reason, ...(status !== undefined ? { status } : {}) });

  if (links.some(isAbort)) return stop("aborted");
  const messages = links.map((link) => link.message);
  if (messages.some((message) => message.includes(PROVIDER_KEY_REQUIRED_SENTINEL))) return stop("key_required");
  if (messages.some(isProviderBillingMessage)) return stop("billing");
  if (links.some((link) => ContextOverflowError.isInstance(link))) return stop("context_overflow");
  if (handledByRequestLoop(err)) return stop("handled");

  if (statusLink !== undefined && status !== undefined) return decideByStatus(statusLink, status);

  const streamType = links.map(providerErrorTypeOf).find((type) => type !== undefined);
  if (streamType !== undefined) {
    const reason = RETRYABLE_STREAM_TYPES[streamType];
    if (reason === undefined) return stop("refused");
    if (reason === "stream_error" && messages.some((message) => /validationexception/i.test(message))) return stop("refused");
    return { retry: true, reason };
  }

  if (isModelTimeout(links)) return { retry: true, reason: "timeout" };
  if (links.some((link) => className(link).includes("APIConnection") || isNetworkTypeError(link))) {
    return { retry: true, reason: "connection" };
  }
  return stop("unrecognized");
}

/** Whether the request loop has already handled this failure: a link carries LangChain's non-retryable stamp. */
export function handledByRequestLoop(err: unknown): boolean {
  return causeChainOf(err).some((link) => getRetryable(link) === false);
}

/**
 * The request loop's hook (LangChain's `onFailedAttempt`), called by p-retry
 * on every failed attempt, the last included. It stamps the error as handled
 * (the header's disjointness), hands p-retry the provider's wait as
 * `retryAfterMs`, the floor p-retry keeps, and throws the error to stop.
 */
export const modelRequestFailed: FailedAttemptHandler = (error: unknown) => {
  const decision = retryDecisionOf(error);
  console.warn(
    `[MODEL-RETRY] phase=request decision=${decision.retry ? "retry" : "stop"} reason=${decision.reason} ` +
      `status=${decision.status ?? "none"} retry_after_ms=${(decision.retry ? decision.retryAfterMs : undefined) ?? "none"}`,
  );
  stampRetryable(error, false);
  if (!decision.retry) throw error;
  if (decision.retryAfterMs !== undefined && typeof error === "object" && error !== null) {
    (error as { retryAfterMs?: number }).retryAfterMs = decision.retryAfterMs;
  }
};

function decideByStatus(link: Error, status: number): RetryDecision {
  const shouldRetry = headerOf(link, "x-should-retry");
  const hint = retryAfterOf(link);
  if (shouldRetry === "false") return { retry: false, reason: "provider_refused", status };
  if (shouldRetry === "true") return retryWithin("provider_asked", status, hint);
  if (status === 429) {
    const rateLimit = classifyRateLimitError(link);
    if (rateLimit?.action === "stop") return { retry: false, reason: "quota", status };
    return retryWithin("rate_limited", status, hint ?? rateLimit?.retryAfterMs);
  }
  if (status === 408) return retryWithin("request_timeout", status, hint);
  if (status === 409) return retryWithin("conflict", status, hint);
  if (status === 529) return retryWithin("overloaded", status, hint);
  if (status >= 500) return retryWithin("server_error", status, hint);
  return { retry: false, reason: "refused", status };
}

function retryWithin(reason: RetryReason, status: number, hint: number | undefined): RetryDecision {
  if (hint !== undefined && hint > RETRY_AFTER_CEILING_MS) return { retry: false, reason: "retry_after_too_long", status };
  return { retry: true, reason, status, ...(hint !== undefined ? { retryAfterMs: hint } : {}) };
}

/** The provider's wait: `retry-after-ms` first (the SDKs' own precedence), then `retry-after` in seconds or as a date. */
function retryAfterOf(link: Error): number | undefined {
  const ms = Number.parseFloat(headerOf(link, "retry-after-ms") ?? "");
  if (Number.isFinite(ms) && ms >= 0) return ms;
  return parseRetryAfterMs(headerOf(link, "retry-after"));
}

function statusOf(link: Error): number | undefined {
  const status = (link as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** A response header on an SDK error: both provider SDKs keep the answer's `Headers`. */
function headerOf(link: Error, name: string): string | undefined {
  const headers = (link as { headers?: unknown }).headers;
  return headers instanceof Headers ? (headers.get(name) ?? undefined) : undefined;
}

function isAbort(link: Error): boolean {
  return (
    link.name === "AbortError" ||
    className(link) === "APIUserAbortError" ||
    ModelAbortError.isInstance(link) ||
    link.message.startsWith("Cancel") ||
    link.message.startsWith("AbortError")
  );
}

function isNetworkTypeError(link: Error): boolean {
  return link.name === "TypeError" && NETWORK_ERROR_MESSAGES.has(link.message);
}

function className(link: Error): string {
  return link.constructor.name;
}
