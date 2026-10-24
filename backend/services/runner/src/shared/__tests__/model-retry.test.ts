/**
 * The model-call retry rule (`model-retry.ts`), over the provider SDK's own
 * error classes and LangChain's own `MiddlewareError`, never look-alike
 * doubles: a double with no `cause` is what let the classifier's connection
 * arms pass their tests while a real dropped connection read as
 * `[TypeError] fetch failed`.
 *
 * Each case is also checked wrapped as a native turn wraps it (one
 * `MiddlewareError` per middleware that wraps the model call), where the
 * wrapper copies its cause's name and message onto itself.
 *
 * The request loop's hook is pinned for what the stream loop relies on: it
 * stamps every error it sees as handled, retried or not, so the rule then
 * stops on it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { ContextOverflowError, ModelAbortError, getRetryable, stampRetryable } from "@langchain/core/errors";
import { MiddlewareError } from "langchain";

import {
  MODEL_REQUEST_RETRIES,
  MODEL_STREAM_RETRIES,
  modelRequestFailed,
  retryDecisionOf,
  type RetryDecision,
} from "../model-retry.js";
import { PROVIDER_KEY_REQUIRED_SENTINEL } from "../model-error.js";

/** A provider's error response, as the SDK builds it from the status, body and headers. */
function providerError(status: number, type: string, headers: Record<string, string> = {}, message = type): APIError {
  return APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers(headers));
}

/** An `event: error` after a 200: no status, the provider's type, the 200's headers (`core/streaming.js`). */
function streamError(type: string, message = type): APIError {
  return new APIError(undefined, { type: "error", error: { type, message } }, undefined, new Headers(), type);
}

/** Wrapped as a native turn wraps a model call's failure: once per wrapping middleware. */
function wrapped(err: Error, layers = 3): Error {
  let current = err;
  for (let layer = 0; layer < layers; layer++) current = MiddlewareError.wrap(current, `layer${layer}`) as Error;
  return current;
}

type Expected = Pick<RetryDecision, "retry" | "reason"> & { readonly retryAfterMs?: number };

const CASES: readonly (readonly [string, () => Error, Expected])[] = [
  ["408", () => providerError(408, "timeout_error"), { retry: true, reason: "request_timeout" }],
  ["409", () => providerError(409, "conflict"), { retry: true, reason: "conflict" }],
  ["429 with no hint", () => providerError(429, "rate_limit_error"), { retry: true, reason: "rate_limited" }],
  ["429 with retry-after seconds", () => providerError(429, "rate_limit_error", { "retry-after": "7" }), { retry: true, reason: "rate_limited", retryAfterMs: 7_000 }],
  ["429 with retry-after-ms", () => providerError(429, "rate_limit_error", { "retry-after-ms": "1500", "retry-after": "9" }), { retry: true, reason: "rate_limited", retryAfterMs: 1_500 }],
  ["429 with a retry-after date", () => providerError(429, "rate_limit_error", { "retry-after": new Date(Date.now() + 30_000).toUTCString() }), { retry: true, reason: "rate_limited" }],
  ["429 asking for more than a minute", () => providerError(429, "rate_limit_error", { "retry-after": "120" }), { retry: false, reason: "retry_after_too_long" }],
  ["429 insufficient_quota", () => providerError(429, "insufficient_quota", {}, "You exceeded your current quota, please check your plan and billing details."), { retry: false, reason: "billing" }],
  ["429 whose quota will reset", () => providerError(429, "rate_limit_error", {}, "Your usage quota will reset at midnight."), { retry: false, reason: "quota" }],
  ["500", () => providerError(500, "api_error"), { retry: true, reason: "server_error" }],
  ["503 with retry-after", () => providerError(503, "api_error", { "retry-after": "2" }), { retry: true, reason: "server_error", retryAfterMs: 2_000 }],
  ["502 with x-should-retry false (the cloud's refusal)", () => providerError(502, "api_error", { "x-should-retry": "false" }), { retry: false, reason: "provider_refused" }],
  ["529 with x-should-retry true", () => providerError(529, "overloaded_error", { "x-should-retry": "true" }), { retry: true, reason: "provider_asked" }],
  ["529", () => providerError(529, "overloaded_error"), { retry: true, reason: "overloaded" }],
  ["400", () => providerError(400, "invalid_request_error"), { retry: false, reason: "refused" }],
  ["401", () => providerError(401, "authentication_error"), { retry: false, reason: "refused" }],
  ["403", () => providerError(403, "permission_error"), { retry: false, reason: "refused" }],
  ["413", () => providerError(413, "request_too_large"), { retry: false, reason: "refused" }],
  ["mid-reply overloaded_error", () => streamError("overloaded_error"), { retry: true, reason: "overloaded" }],
  ["mid-reply rate_limit_error", () => streamError("rate_limit_error"), { retry: true, reason: "rate_limited" }],
  ["mid-reply invalid_request_error", () => streamError("invalid_request_error"), { retry: false, reason: "refused" }],
  ["Bedrock's mid-reply throttlingException", () => streamError("api_error", "throttlingException"), { retry: true, reason: "stream_error" }],
  ["Bedrock's mid-reply validationException", () => streamError("api_error", "validationException"), { retry: false, reason: "refused" }],
  ["a dropped connection (the SDK's error over undici's)", () => new APIConnectionError({ cause: new TypeError("fetch failed") }), { retry: true, reason: "connection" }],
  ["the SDK's request timeout", () => new APIConnectionTimeoutError(), { retry: true, reason: "timeout" }],
  ["LangChain's OpenAI timeout", () => Object.assign(new Error("Request timed out."), { name: "TimeoutError" }), { retry: true, reason: "timeout" }],
  ["a stream cut mid-reply", () => new TypeError("terminated"), { retry: true, reason: "connection" }],
  ["a TypeError that is not the network's", () => new TypeError("Cannot read properties of undefined (reading 'content')"), { retry: false, reason: "unrecognized" }],
  ["the person's stop (the SDK's abort)", () => new APIUserAbortError(), { retry: false, reason: "aborted" }],
  ["the person's stop (an AbortError)", () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), { retry: false, reason: "aborted" }],
  ["the person's stop (LangChain's)", () => new ModelAbortError("Model invocation was aborted."), { retry: false, reason: "aborted" }],
  ["an error the request loop handled", () => stampRetryable(providerError(529, "overloaded_error"), false), { retry: false, reason: "handled" }],
  ["the cloud's missing-key refusal", () => providerError(403, "permission_error", {}, `${PROVIDER_KEY_REQUIRED_SENTINEL}: no key`), { retry: false, reason: "key_required" }],
  ["billing prose", () => providerError(400, "invalid_request_error", {}, "Your credit balance is too low to access the Anthropic API."), { retry: false, reason: "billing" }],
  ["a context overflow", () => ContextOverflowError.fromError(providerError(400, "invalid_request_error", {}, "prompt is too long")), { retry: false, reason: "context_overflow" }],
  ["a cloud credential the adapter could not load", () => new Error("Could not load the default credentials."), { retry: false, reason: "unrecognized" }],
];

describe("retryDecisionOf", () => {
  it.each(CASES)("%s", (_name, make, expected) => {
    expect(retryDecisionOf(make())).toMatchObject(expected);
  });

  it.each(CASES)("%s, wrapped by the middleware stack", (_name, make, expected) => {
    expect(retryDecisionOf(wrapped(make()))).toMatchObject(expected);
  });

  it("keeps the status for the log", () => {
    expect(retryDecisionOf(wrapped(providerError(529, "overloaded_error"))).status).toBe(529);
    expect(retryDecisionOf(streamError("overloaded_error")).status).toBeUndefined();
  });

  it("stops on a handled error even when its wrapper looks retryable (the wrapper copies the name)", () => {
    const handled = stampRetryable(Object.assign(new Error("Request timed out."), { name: "TimeoutError" }), false);
    const outer = wrapped(handled);
    expect(outer.name).toBe("TimeoutError");
    expect(retryDecisionOf(outer)).toMatchObject({ retry: false, reason: "handled" });
  });

  it("stops on a value that is not an error", () => {
    expect(retryDecisionOf("boom")).toMatchObject({ retry: false, reason: "unrecognized" });
    expect(retryDecisionOf(undefined)).toMatchObject({ retry: false, reason: "unrecognized" });
  });

  it("names its counts", () => {
    expect(MODEL_REQUEST_RETRIES).toBe(6);
    expect(MODEL_STREAM_RETRIES).toBe(2);
  });
});

describe("modelRequestFailed (the request loop's hook)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("returns for a retryable error, stamped as handled, with the provider's wait as p-retry's floor", () => {
    const err = providerError(429, "rate_limit_error", { "retry-after": "3" });
    expect(() => modelRequestFailed(err)).not.toThrow();
    expect(getRetryable(err)).toBe(false);
    expect((err as { retryAfterMs?: number }).retryAfterMs).toBe(3_000);
    expect(warn).toHaveBeenCalledWith("[MODEL-RETRY] phase=request decision=retry reason=rate_limited status=429 retry_after_ms=3000");
  });

  it("throws the error itself to stop, stamped as handled", () => {
    const err = providerError(502, "api_error", { "x-should-retry": "false" });
    expect(() => modelRequestFailed(err)).toThrow(err);
    expect(getRetryable(err)).toBe(false);
    expect(warn).toHaveBeenCalledWith("[MODEL-RETRY] phase=request decision=stop reason=provider_refused status=502 retry_after_ms=none");
  });

  it("sets no floor when the provider named no wait, and logs no message or key", () => {
    const err = new APIConnectionError({ cause: new TypeError("fetch failed") });
    modelRequestFailed(err);
    expect((err as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[MODEL-RETRY] phase=request decision=retry reason=connection status=none retry_after_ms=none");
  });

  it("leaves the stamp for the stream loop to read: a handled failure is never retried twice", () => {
    const err = providerError(529, "overloaded_error");
    modelRequestFailed(err);
    expect(retryDecisionOf(wrapped(err))).toMatchObject({ retry: false, reason: "handled" });
  });
});
