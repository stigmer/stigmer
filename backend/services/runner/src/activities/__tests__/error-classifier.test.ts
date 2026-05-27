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
});

describe("formatClassifiedError", () => {
  it("includes category, source, and retryable in formatted string", () => {
    const formatted = formatClassifiedError({
      category: "auth",
      message: "unauthenticated",
      retryable: false,
      source: "stream",
    });

    expect(formatted).toContain("category=auth");
    expect(formatted).toContain("source=stream");
    expect(formatted).toContain("retryable=false");
  });
});

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
});
