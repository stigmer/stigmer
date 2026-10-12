/**
 * Tests for the account-shaped categories of the Cursor error classifier.
 *
 * Billing (stigmer/stigmer#330 follow-through: without a billing category,
 * quota exhaustion classified as retryable rate-limit or unknown, burning
 * retries against an exhausted account): terminal, and Cursor's own message
 * is what the user reads, because the Cursor key is the organization's own
 * through the proxy and the operator's own in direct mode.
 *
 * No Cursor key: the proxy's refusal, recognised by its code in any source
 * the classifier reads, reads as the missing key and where an admin adds
 * it, is terminal, and is never taken for a stale agent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { synthesizeError } from "../error-classifier.js";
import type { CapturedRejection } from "../rejection-capture.js";
import { PROVIDER_KEY_REQUIRED_SENTINEL } from "../../../shared/model-error.js";

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

describe("Cursor's own billing message", () => {
  // Cursor's team-usage-limit prose: about the account the key belongs to,
  // which is the organization's own (or the operator's, in direct mode).
  const CURSOR_USAGE_LIMIT_MESSAGE =
    "Your team has reached its usage limit. Please reach out to an admin to " +
    "enable on-demand usage, or return on 8/20/2026 when your limit resets.";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through unchanged, as terminal billing", () => {
    const result = synthesizeError({
      ...base(),
      streamErrorMessage: CURSOR_USAGE_LIMIT_MESSAGE,
    });
    expect(result.category).toBe("billing");
    expect(result.retryable).toBe(false);
    expect(result.message).toBe(CURSOR_USAGE_LIMIT_MESSAGE);
  });
});

describe("an organization with no Cursor key", () => {
  // The cloud's Cursor REST lane refuses the SDK's key exchange with this
  // body; the SDK surfaces it as a thrown error carrying the message.
  const REFUSAL =
    "This organization has no Cursor key. An admin can add one in Settings → Provider keys. " +
    `[code: ${PROVIDER_KEY_REQUIRED_SENTINEL}]`;
  const NO_KEY = "This organization has no Cursor key. An admin can add one in Settings → Provider keys.";

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads as the missing key from a thrown SDK error, terminal and not retried", () => {
    const result = synthesizeError({
      ...base(),
      sdkError: { code: "permission_denied", status: 403, message: `[permission_denied] ${REFUSAL}` },
    });
    expect(result).toEqual({ category: "auth", message: NO_KEY, retryable: false, source: "sdk" });
  });

  it("reads the same from every other source the classifier reads", () => {
    const fromResult = synthesizeError({ ...base(), sdkResultFields: REFUSAL });
    const fromStream = synthesizeError({ ...base(), streamErrorMessage: REFUSAL });
    const fromConversation = synthesizeError({ ...base(), conversationErrorText: REFUSAL });
    const fromRejection = synthesizeError({
      ...base(),
      capturedRejection: { code: "permission_denied", message: REFUSAL, timestamp: Date.now() },
    });
    for (const result of [fromResult, fromStream, fromConversation, fromRejection]) {
      expect(result.category, result.source).toBe("auth");
      expect(result.message, result.source).toBe(NO_KEY);
      expect(result.retryable, result.source).toBe(false);
    }
  });

  it("is checked before billing, so a refusal quoting billing prose still names the missing key", () => {
    const result = synthesizeError({ ...base(), streamErrorMessage: `usage limit ${REFUSAL}` });
    expect(result.message).toBe(NO_KEY);
  });

  it("is never upgraded to agent-stale on a resumed handle", () => {
    const result = synthesizeError({ ...base(), isResumedHandle: true, streamErrorMessage: REFUSAL });
    expect(result.category).toBe("auth");
    expect(result.retryable).toBe(false);
  });
});
