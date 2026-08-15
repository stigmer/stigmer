/**
 * Tests for the billing category of the Cursor error classifier
 * (stigmer/stigmer#330 follow-through: the Cursor arm kept working during
 * the incident, but its classifier had no billing category — quota
 * exhaustion of Cursor-managed keys would have classified as retryable
 * rate-limit or unknown, burning retries against an exhausted account).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { synthesizeError } from "../error-classifier.js";
import type { CapturedRejection } from "../rejection-capture.js";

const FALLBACK = { model: "default", mode: "cloud", agentId: "agent-1" };

function base() {
  return {
    sdkResultFields: undefined,
    streamErrorMessage: undefined,
    capturedRejection: undefined,
    isResumedHandle: false,
    fallbackContext: FALLBACK,
  } as const;
}

describe("error-classifier billing category", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies credit-balance prose as non-retryable billing", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage:
        "Your credit balance is too low to access the Anthropic API.",
    });
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("classifies insufficient_quota as billing even though it carries '429'", () => {
    // Billing must be checked before rate-limit: this message matches both
    // pattern lists, and only the billing diagnosis is terminal.
    const result = synthesizeError({
      ...base(),
      sdkError: { code: "insufficient_quota", status: 429, message: "You have no credits remaining." },
    });
    expect(result.source).toBe("sdk");
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("'usage limit' is billing (terminal), no longer a retryable rate-limit", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: "You have reached your usage limit for this billing period.",
    });
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("plain rate limits remain retryable rate-limit", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: "rate limit exceeded, retry after 2s",
    });
    expect(result.category).toBe("rate-limit");
    expect(result.retryable).toBe(true);
  });

  it("the platform capacity sentinel is diagnosed as billing", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage:
        "Model capacity unavailable [code: STIGMER_PLATFORM_MODEL_CAPACITY]",
    });
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("billing via captured rejection is non-retryable", () => {
    const rejection: CapturedRejection = {
      code: "resource_exhausted",
      message: "You exceeded your current quota",
      timestamp: Date.now(),
    };
    const result = synthesizeError({
      ...base(),
      capturedRejection: rejection,
    });
    expect(result.source).toBe("rejection");
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("billing is never upgraded to agent-stale on resumed handles", () => {
    const result = synthesizeError({
      ...base(),
      isResumedHandle: true,
      streamErrorMessage: "Your credit balance is too low to access the Anthropic API.",
    });
    expect(result.category).toBe("billing");
  });
});

describe("D4 platform attribution of billing errors (proxy mode)", () => {
  // The exact message the 2026-08-15 pool-drain incident put in front of a
  // customer: Cursor's team-usage-limit prose relayed raw, telling them to
  // "reach out to an admin" of a Cursor team they cannot see.
  const CURSOR_USAGE_LIMIT_MESSAGE =
    "Your team has reached its usage limit. Please reach out to an admin to " +
    "enable on-demand usage, or return on 8/20/2026 when your limit resets.";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewords managed-key billing errors with platform attribution", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: CURSOR_USAGE_LIMIT_MESSAGE,
      proxyMode: true,
    });
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("Stigmer platform");
    expect(result.message).toContain("credits were not charged");
    expect(result.message).toContain("STIGMER_PLATFORM_MODEL_CAPACITY");
    // Cursor's limit-reset date must survive, quoted, not erased.
    expect(result.message).toContain("return on 8/20/2026");
  });

  it("leaves BYO-key (direct mode) billing errors untouched", () => {
    // A self-hoster's drained personal account: the raw message IS the
    // actionable one — never hide it behind platform attribution.
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: CURSOR_USAGE_LIMIT_MESSAGE,
      proxyMode: false,
    });
    expect(result.category).toBe("billing");
    expect(result.message).toBe(CURSOR_USAGE_LIMIT_MESSAGE);
    expect(result.message).not.toContain("STIGMER_PLATFORM_MODEL_CAPACITY");
  });

  it("does not double-wrap a message the proxy already rewrote", () => {
    const proxyRewritten =
      "The Stigmer platform's Cursor capacity is temporarily exhausted. " +
      "[code: STIGMER_PLATFORM_MODEL_CAPACITY]";
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: proxyRewritten,
      proxyMode: true,
    });
    expect(result.category).toBe("billing");
    expect(result.message).toBe(proxyRewritten);
  });

  it("never rewords non-billing categories in proxy mode", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: "rate limit exceeded, retry after 2s",
      proxyMode: true,
    });
    expect(result.category).toBe("rate-limit");
    expect(result.message).not.toContain("Stigmer platform");
  });
});
