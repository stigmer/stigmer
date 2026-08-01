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
