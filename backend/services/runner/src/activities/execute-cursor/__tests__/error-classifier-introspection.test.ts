/**
 * Tests for the error-classifier introspection sources added alongside the
 * BiDi-route observability work:
 *
 * - `sdkError`: structured fields from a thrown CursorSdkError (top priority)
 * - `conversationErrorText`: text recovered from the failing run.conversation()
 *
 * These ensure a transport/routing failure (e.g. the grpc-status 12 routing bug)
 * surfaces an actionable message instead of the bare "no detail from SDK".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { synthesizeError } from "../error-classifier.js";

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

describe("error-classifier introspection sources", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sdkError source", () => {
    it("classifies an 'unavailable' CursorSdkError as retryable network", () => {
      const result = synthesizeError({
        ...base(),
        sdkError: { code: "unavailable", status: 503, message: "service unavailable" },
      });
      expect(result.source).toBe("sdk");
      expect(result.category).toBe("network");
      expect(result.retryable).toBe(true);
      expect(result.message).toBe("service unavailable");
    });

    it("classifies an 'unauthenticated' CursorSdkError as non-retryable auth", () => {
      const result = synthesizeError({
        ...base(),
        sdkError: { code: "unauthenticated", status: 401 },
      });
      expect(result.source).toBe("sdk");
      expect(result.category).toBe("auth");
      expect(result.retryable).toBe(false);
    });

    it("classifies from code/status alone when no message is present", () => {
      const result = synthesizeError({
        ...base(),
        sdkError: { code: "resource_exhausted" },
      });
      expect(result.source).toBe("sdk");
      expect(result.category).toBe("rate-limit");
      expect(result.message).toBe("resource_exhausted");
    });

    it("ignores an empty sdkError and falls through to the next source", () => {
      const result = synthesizeError({
        ...base(),
        sdkError: {},
        streamErrorMessage: "fetch failed",
      });
      expect(result.source).toBe("stream");
      expect(result.category).toBe("network");
    });
  });

  describe("conversationErrorText source", () => {
    it("surfaces the conversation error text instead of the generic fallback", () => {
      const result = synthesizeError({
        ...base(),
        conversationErrorText: "Method not found: agent.v1.AgentService/Run (unimplemented)",
      });
      expect(result.source).toBe("conversation");
      expect(result.message).toContain("unimplemented");
      // Not the bare fallback message.
      expect(result.message).not.toContain("no detail from SDK");
    });

    it("classifies a recognizable category from the conversation text", () => {
      const result = synthesizeError({
        ...base(),
        conversationErrorText: "deadline_exceeded while contacting upstream",
      });
      expect(result.source).toBe("conversation");
      expect(result.category).toBe("network");
      expect(result.retryable).toBe(true);
    });
  });

  describe("source precedence", () => {
    const allSources = {
      ...base(),
      sdkError: { code: "unavailable", message: "from-sdk-error" },
      sdkResultFields: "from-sdk-result network error",
      streamErrorMessage: "from-stream timeout",
      capturedRejection: { code: "unavailable", message: "from-rejection", timestamp: Date.now() },
      conversationErrorText: "from-conversation enotfound",
    };

    it("prefers the thrown CursorSdkError above all other sources", () => {
      const result = synthesizeError({ ...allSources });
      expect(result.source).toBe("sdk");
      expect(result.message).toBe("from-sdk-error");
    });

    it("falls to sdkResultFields when sdkError is absent", () => {
      const result = synthesizeError({ ...allSources, sdkError: undefined });
      expect(result.source).toBe("sdk");
      expect(result.message).toBe("from-sdk-result network error");
    });

    it("falls to the stream message next", () => {
      const result = synthesizeError({
        ...allSources,
        sdkError: undefined,
        sdkResultFields: undefined,
      });
      expect(result.source).toBe("stream");
      expect(result.message).toBe("from-stream timeout");
    });

    it("falls to the captured rejection next", () => {
      const result = synthesizeError({
        ...allSources,
        sdkError: undefined,
        sdkResultFields: undefined,
        streamErrorMessage: undefined,
      });
      expect(result.source).toBe("rejection");
      expect(result.message).toContain("from-rejection");
    });

    it("falls to the conversation text last, above the generic fallback", () => {
      const result = synthesizeError({
        ...allSources,
        sdkError: undefined,
        sdkResultFields: undefined,
        streamErrorMessage: undefined,
        capturedRejection: undefined,
      });
      expect(result.source).toBe("conversation");
      expect(result.message).toBe("from-conversation enotfound");
    });
  });
});
