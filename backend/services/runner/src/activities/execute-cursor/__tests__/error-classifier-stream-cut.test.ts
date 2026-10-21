/**
 * Tests for the cut-connection category of the Cursor error classifier.
 *
 * Cursor's backend ends a long agent run's stream (stigmer#2436), and the
 * SDK reports it in the transport's words with no code. The category is
 * read from those words in whichever source carries them, is never upgraded
 * to a stale handle on a resumed agent (a fresh agent would drop the
 * conversation and be handed the task again), and takes neither recovery.
 * What the real SDK reports is pinned in `agent-proxy/__tests__/cursor-sdk-wire.test.ts`;
 * what a cut turn settles as, in the contract kit's stream-cut arm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRunErrorSources, formatClassifiedError, shouldRetryWithFreshAgent, synthesizeError } from "../error-classifier.js";
import { CURSOR_STREAM_CUT_ERROR } from "../__test-utils__/scripted-agent.js";

const FALLBACK = { model: "default", mode: "local", agentId: "agent-1" };

function base() {
  return {
    sdkResultFields: undefined,
    streamErrorMessage: undefined,
    capturedRejection: undefined,
    isResumedHandle: false,
    fallbackContext: FALLBACK,
  } as const;
}

describe("error-classifier stream-cut category", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the SDK's run error for a cut stream as a cut, with the SDK's words", () => {
    const result = synthesizeError({ ...base(), ...extractRunErrorSources({ status: "error", error: { message: CURSOR_STREAM_CUT_ERROR } }) });
    expect(result).toEqual({ category: "stream-cut", message: CURSOR_STREAM_CUT_ERROR, retryable: true, source: "sdk" });
    expect(formatClassifiedError(result)).toBe(`${CURSOR_STREAM_CUT_ERROR} [category=stream-cut, source=sdk, retryable=true]`);
  });

  it("reads a thrown error's code and words as a cut too", () => {
    const result = synthesizeError({ ...base(), sdkError: { code: "unknown", message: CURSOR_STREAM_CUT_ERROR } });
    expect(result.category).toBe("stream-cut");
  });

  it("is never upgraded to a stale handle on a resumed agent, and takes no fresh-agent recovery", () => {
    const result = synthesizeError({ ...base(), isResumedHandle: true, sdkResultFields: CURSOR_STREAM_CUT_ERROR });
    expect(result.category).toBe("stream-cut");
    expect(shouldRetryWithFreshAgent(result)).toBe(false);
  });

  it("leaves a reset with another code to the other categories", () => {
    const result = synthesizeError({ ...base(), sdkResultFields: "[unknown] [internal] http/2 stream closed with error code INTERNAL_ERROR (0x2)" });
    expect(result.category).not.toBe("stream-cut");
  });
});
