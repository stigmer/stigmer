/**
 * Unit tests for the Cursor error classifier.
 *
 * Covers the three-source priority cascade, the resumed-handle override
 * (T04 bug fix), captured rejection handling, and the retry-decision
 * function that gates poisoned-handle recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { synthesizeError, formatClassifiedError, shouldRetryWithFreshAgent } from "../execute-cursor/error-classifier.js";

describe("synthesizeError", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  const fallbackContext = { model: "claude-sonnet-4", mode: "local", agentId: "agent-123" };

  // ---------------------------------------------------------------------------
  // Diagnostic logging
  // ---------------------------------------------------------------------------

  it("logs diagnostic info for every call", () => {
    synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(consoleLogSpy).toHaveBeenCalledOnce();
    const logCall = consoleLogSpy.mock.calls[0][0] as string;
    expect(logCall).toContain("[error-classifier] synthesizeError diagnostic:");
    expect(logCall).toContain("Cursor run failed");
    expect(logCall).toContain("model=claude-sonnet-4");
    expect(logCall).toContain("mode=local");
  });

  // ---------------------------------------------------------------------------
  // SDK result source
  // ---------------------------------------------------------------------------

  it("uses specific SDK result when not bare generic", () => {
    const result = synthesizeError({
      sdkResultFields: "rate limit exceeded for model gpt-4",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("rate-limit");
    expect(result.source).toBe("sdk");
    expect(result.retryable).toBe(true);
  });

  it("does not override specific SDK classification even on resumed handle", () => {
    const result = synthesizeError({
      sdkResultFields: "unauthenticated: bad token",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("auth");
    expect(result.source).toBe("sdk");
    expect(result.retryable).toBe(false);
  });

  it("upgrades non-bare SDK unknown to agent-stale on resumed handle", () => {
    const result = synthesizeError({
      sdkResultFields: "something completely unexpected happened",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("agent-stale");
    expect(result.retryable).toBe(true);
    expect(result.source).toBe("sdk");
    expect(result.message).toBe("something completely unexpected happened");
  });

  // ---------------------------------------------------------------------------
  // Stream error source
  // ---------------------------------------------------------------------------

  it("prefers stream error over fallback for bare SDK result", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: "unauthenticated: invalid token",
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("auth");
    expect(result.source).toBe("stream");
    expect(result.message).toBe("unauthenticated: invalid token");
  });

  it("does not override classifiable stream error on resumed handle", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: "unauthenticated: expired credential",
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("auth");
    expect(result.source).toBe("stream");
    expect(result.retryable).toBe(false);
  });

  it("upgrades unclassifiable stream error to agent-stale on resumed handle", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: "an opaque error with no recognizable pattern",
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("agent-stale");
    expect(result.retryable).toBe(true);
    expect(result.source).toBe("stream");
    expect(result.message).toBe("an opaque error with no recognizable pattern");
  });

  it("leaves unclassifiable stream error as unknown when not resumed", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: "an opaque error with no recognizable pattern",
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("unknown");
    expect(result.source).toBe("stream");
    expect(result.retryable).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Captured rejection source
  // ---------------------------------------------------------------------------

  it("upgrades unknown captured rejection to network", () => {
    const result = synthesizeError({
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: { code: "internal", message: "something broke", timestamp: Date.now() },
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("network");
    expect(result.source).toBe("rejection");
    expect(result.retryable).toBe(true);
    expect(result.message).toBe("[internal] something broke");
  });

  it("classifies auth captured rejection as auth and non-retryable", () => {
    const result = synthesizeError({
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: { code: "unauthenticated", message: "invalid api key", timestamp: Date.now() },
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("auth");
    expect(result.source).toBe("rejection");
    expect(result.retryable).toBe(false);
  });

  it("classifies network captured rejection correctly", () => {
    const result = synthesizeError({
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: { code: "unavailable", message: "service unavailable", timestamp: Date.now() },
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("network");
    expect(result.source).toBe("rejection");
    expect(result.retryable).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Fallback (no sources)
  // ---------------------------------------------------------------------------

  it("classifies bare 'Cursor run failed' as unknown fallback when no other sources available", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("unknown");
    expect(result.source).toBe("fallback");
    expect(result.message).toContain("no detail from SDK");
    expect(result.message).toContain("claude-sonnet-4");
  });

  it("classifies bare 'Cursor run failed' as agent-stale when resumed handle", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("agent-stale");
    expect(result.retryable).toBe(true);
    expect(result.source).toBe("fallback");
  });

  it("returns agent-stale when no sources at all and handle is resumed", () => {
    const result = synthesizeError({
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: true,
      fallbackContext,
    });

    expect(result.category).toBe("agent-stale");
    expect(result.retryable).toBe(true);
    expect(result.source).toBe("fallback");
  });

  it("returns unknown with context when no sources and not resumed", () => {
    const result = synthesizeError({
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("unknown");
    expect(result.source).toBe("fallback");
    expect(result.message).toContain("Model=claude-sonnet-4");
    expect(result.message).toContain("mode=local");
    expect(result.message).toContain("agentId=agent-123");
  });

  // ---------------------------------------------------------------------------
  // Source priority
  // ---------------------------------------------------------------------------

  it("prefers specific SDK result over stream error", () => {
    const result = synthesizeError({
      sdkResultFields: "forbidden: access denied",
      streamErrorMessage: "timeout waiting for response",
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("auth");
    expect(result.source).toBe("sdk");
  });

  it("prefers stream error over captured rejection for bare SDK", () => {
    const result = synthesizeError({
      sdkResultFields: "Cursor run failed",
      streamErrorMessage: "resource_exhausted: quota exceeded",
      capturedRejection: { code: "unavailable", message: "service down", timestamp: Date.now() },
      isResumedHandle: false,
      fallbackContext,
    });

    expect(result.category).toBe("rate-limit");
    expect(result.source).toBe("stream");
  });
});

// ---------------------------------------------------------------------------
// formatClassifiedError
// ---------------------------------------------------------------------------

describe("formatClassifiedError", () => {
  it("places message first followed by bracketed metadata", () => {
    const formatted = formatClassifiedError({
      category: "auth",
      message: "unauthenticated",
      retryable: false,
      source: "stream",
    });

    expect(formatted).toBe(
      "unauthenticated [category=auth, source=stream, retryable=false]",
    );
  });
});

// ---------------------------------------------------------------------------
// shouldRetryWithFreshAgent
// ---------------------------------------------------------------------------

describe("shouldRetryWithFreshAgent", () => {
  it("returns true for agent-stale category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "agent-stale",
      message: "stale",
      retryable: true,
      source: "fallback",
    })).toBe(true);
  });

  it("returns true for network category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "network",
      message: "timeout",
      retryable: true,
      source: "rejection",
    })).toBe(true);
  });

  it("returns false for auth category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "auth",
      message: "unauthenticated",
      retryable: false,
      source: "sdk",
    })).toBe(false);
  });

  it("returns false for rate-limit category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "rate-limit",
      message: "quota exceeded",
      retryable: true,
      source: "stream",
    })).toBe(false);
  });

  it("returns false for model category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "model",
      message: "invalid model",
      retryable: false,
      source: "sdk",
    })).toBe(false);
  });

  it("returns false for unknown category", () => {
    expect(shouldRetryWithFreshAgent({
      category: "unknown",
      message: "no idea",
      retryable: false,
      source: "fallback",
    })).toBe(false);
  });
});
