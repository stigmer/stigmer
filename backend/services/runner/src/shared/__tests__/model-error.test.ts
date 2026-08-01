/**
 * Tests for the shared model-call error unwrapping and classification
 * (stigmer/stigmer#330).
 *
 * The scenarios mirror the production incident: the platform proxy rewrites
 * a platform-account billing rejection into a 503 carrying the sentinel
 * code, LangChain wraps the SDK error in a MiddlewareError whose message is
 * copied verbatim and whose `cause` is the original — and the runner must
 * (a) attribute platform faults to the platform, (b) attribute direct-mode
 * billing faults to the user's own provider account, and (c) never relabel
 * a non-model error.
 */

import { describe, it, expect } from "vitest";
import {
  PLATFORM_CAPACITY_SENTINEL,
  classifyModelCallError,
  describeExecutionError,
  unwrapModelError,
} from "../model-error.js";

/**
 * Mimic LangChain's MiddlewareError: message copied from the inner error,
 * original preserved on `cause` (langchain dist/agents/errors.js:50-57).
 */
function middlewareWrap(inner: Error): Error {
  const wrapped = new Error(inner.message);
  wrapped.cause = inner;
  return wrapped;
}

/** Mimic a provider SDK APIError: message + numeric `.status`. */
function sdkError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** The exact message shape the incident produced on the Anthropic arm. */
const ANTHROPIC_BILLING_MESSAGE =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low' +
  ' to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

/** The rewritten message the cloud proxy now returns for platform faults. */
const PLATFORM_REWRITE_MESSAGE =
  "The Stigmer platform's model capacity for anthropic is temporarily unavailable." +
  ` [code: ${PLATFORM_CAPACITY_SENTINEL}]`;

describe("unwrapModelError", () => {
  it("returns the error itself when there is no cause", () => {
    const err = new Error("plain");
    expect(unwrapModelError(err)).toBe(err);
  });

  it("walks a MiddlewareError-style cause chain to the root SDK error", () => {
    const root = sdkError(400, ANTHROPIC_BILLING_MESSAGE);
    const wrapped = middlewareWrap(root);
    expect(unwrapModelError(wrapped)).toBe(root);
  });

  it("walks nested cause chains", () => {
    const root = sdkError(503, "boom");
    const wrapped = middlewareWrap(middlewareWrap(root));
    expect(unwrapModelError(wrapped)).toBe(root);
  });

  it("survives a pathological cause cycle via the depth cap", () => {
    const a = new Error("a");
    const b = new Error("b");
    a.cause = b;
    b.cause = a;
    // Any chain member is acceptable; the point is it terminates.
    expect(unwrapModelError(a)).toBeInstanceOf(Error);
  });

  it("passes non-Error values through", () => {
    expect(unwrapModelError("string error")).toBe("string error");
  });
});

describe("classifyModelCallError — platform sentinel", () => {
  it("classifies the platform rewrite as non-retryable platform capacity", () => {
    const err = middlewareWrap(sdkError(503, PLATFORM_REWRITE_MESSAGE));

    const classified = classifyModelCallError(err, { proxyMode: true, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("platform-side issue");
    expect(classified?.message).toContain("credits were not charged");
  });

  it("sentinel wins over status mapping (a 503 would otherwise be retryable)", () => {
    const classified = classifyModelCallError(
      sdkError(503, PLATFORM_REWRITE_MESSAGE),
      { proxyMode: true },
    );
    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.retryable).toBe(false);
  });
});

describe("classifyModelCallError — provider billing prose", () => {
  it("in direct mode, attributes billing to the user's own provider account", () => {
    const err = middlewareWrap(sdkError(400, ANTHROPIC_BILLING_MESSAGE));

    const classified = classifyModelCallError(err, { proxyMode: false, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PROVIDER_BILLING");
    expect(classified?.retryable).toBe(false);
    expect(classified?.message).toContain("Your Anthropic account");
    // Direct mode keeps the provider message — it IS the user's account.
    expect(classified?.message).toContain("credit balance is too low");
  });

  it("in proxy mode, raw billing prose (version-skewed proxy) attributes to the platform", () => {
    const err = sdkError(400, ANTHROPIC_BILLING_MESSAGE);

    const classified = classifyModelCallError(err, { proxyMode: true, provider: "anthropic" });

    expect(classified?.code).toBe("LLM_PLATFORM_CAPACITY");
    expect(classified?.message).not.toContain("Plans & Billing");
  });

  it("recognizes OpenAI quota exhaustion wordings", () => {
    for (const msg of [
      "429 You have no credits remaining. Add credits to continue using the API.",
      "429 You exceeded your current quota, please check your plan and billing details.",
      '429 {"error":{"type":"insufficient_quota"}}',
    ]) {
      const classified = classifyModelCallError(
        sdkError(429, msg),
        { proxyMode: false, provider: "openai" },
      );
      expect(classified?.code).toBe("LLM_PROVIDER_BILLING");
    }
  });
});

describe("classifyModelCallError — status mapping", () => {
  it("maps statuses to the stable codes with call-llm's retryability policy", () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "LLM_AUTHENTICATION_ERROR", false],
      [403, "LLM_PERMISSION_DENIED", false],
      [404, "LLM_MODEL_NOT_FOUND", false],
      [400, "LLM_BAD_REQUEST", false],
      [422, "LLM_UNPROCESSABLE_REQUEST", false],
      [429, "LLM_RATE_LIMIT", false],
      [500, "LLM_PROVIDER_ERROR", true],
      [529, "LLM_PROVIDER_ERROR", true],
      [418, "LLM_API_ERROR", false],
    ];
    for (const [status, code, retryable] of cases) {
      const classified = classifyModelCallError(
        sdkError(status, `HTTP ${status}`),
        { proxyMode: false, provider: "openai", modelId: "gpt-4o" },
      );
      expect(classified?.code, `status ${status}`).toBe(code);
      expect(classified?.retryable, `status ${status}`).toBe(retryable);
    }
  });

  it("proxy-mode 401/403 wording points at the platform session, not a user API key", () => {
    const classified = classifyModelCallError(
      sdkError(401, "unauthorized"),
      { proxyMode: true, provider: "anthropic" },
    );
    expect(classified?.message).toContain("Stigmer platform");
    expect(classified?.message).not.toContain("your API key");
  });

  it("unwraps before duck-typing status (the incident shape end-to-end)", () => {
    const classified = classifyModelCallError(
      middlewareWrap(sdkError(429, "Too many requests")),
      { proxyMode: false, provider: "openai" },
    );
    expect(classified?.code).toBe("LLM_RATE_LIMIT");
  });
});

describe("classifyModelCallError — connection heuristics and no-signal", () => {
  it("always recognizes the SDKs' own APIConnection* classes as retryable", () => {
    class APIConnectionTimeoutError extends Error {}
    class APIConnectionError extends Error {}
    expect(
      classifyModelCallError(new APIConnectionTimeoutError("timed out"), { proxyMode: false })?.code,
    ).toBe("LLM_CONNECTION_TIMEOUT");
    expect(
      classifyModelCallError(new APIConnectionError("refused"), { proxyMode: false })?.code,
    ).toBe("LLM_CONNECTION_ERROR");
  });

  it("loose Timeout/Connection names classify only when the caller vouches assumeModelCall", () => {
    class ConnectTimeoutError extends Error {}

    // A model-call-only catch (call-llm) keeps the loose heuristics.
    expect(
      classifyModelCallError(new ConnectTimeoutError("undici timeout"), {
        proxyMode: false,
        assumeModelCall: true,
      })?.code,
    ).toBe("LLM_CONNECTION_TIMEOUT");

    // A broad catch must not relabel arbitrary *TimeoutError classes.
    expect(
      classifyModelCallError(new ConnectTimeoutError("undici timeout"), { proxyMode: false }),
    ).toBeUndefined();
  });

  it("returns undefined for errors with no model-call signal", () => {
    expect(classifyModelCallError(new Error("ENOSPC: disk full"), { proxyMode: true })).toBeUndefined();
    expect(classifyModelCallError("not even an error", { proxyMode: false })).toBeUndefined();
  });
});

describe("describeExecutionError", () => {
  it("labels classified model errors with the stable code, not the wrapper class", () => {
    const { errorType, errorMessage } = describeExecutionError(
      middlewareWrap(sdkError(503, PLATFORM_REWRITE_MESSAGE)),
      { proxyMode: true },
    );
    expect(errorType).toBe("LLM_PLATFORM_CAPACITY");
    expect(errorMessage).toContain("credits were not charged");
    expect(errorMessage).not.toContain("MiddlewareError");
  });

  it("keeps the root error's identity for non-model failures", () => {
    class WorkspaceLockTimeoutError extends Error {}
    const root = new WorkspaceLockTimeoutError("workspace busy");

    const { errorType, errorMessage } = describeExecutionError(
      middlewareWrap(root),
      { proxyMode: true },
    );

    expect(errorType).toBe("WorkspaceLockTimeoutError");
    expect(errorMessage).toBe("workspace busy");
  });

  it("handles non-Error throwables", () => {
    const { errorType, errorMessage } = describeExecutionError("oops", { proxyMode: false });
    expect(errorType).toBe("UnknownError");
    expect(errorMessage).toBe("oops");
  });

  it("never surfaces provider billing-console prose in proxy mode", () => {
    const { errorMessage } = describeExecutionError(
      middlewareWrap(sdkError(400, ANTHROPIC_BILLING_MESSAGE)),
      { proxyMode: true },
    );
    expect(errorMessage).not.toContain("Plans & Billing");
    expect(errorMessage).toContain("platform-side issue");
  });
});
