/**
 * Tests for the shape-aware run.wait() error extraction (oss#299).
 *
 * A bare String() on a structured error value yields "[object Object]",
 * which end users saw verbatim AND which shadowed every lower-priority
 * classifier source (stream, rejection, conversation introspection) because
 * classification stops at the first non-empty source. These tests pin:
 *
 * - the extractRunErrorSources shape matrix (strings, Errors, field objects,
 *   hopeless values)
 * - first-USABLE-candidate chain order (a hopeless object no longer hides a
 *   usable string one field later; an empty string no longer short-circuits)
 * - end-to-end: structured errors classify and re-enable fresh-agent retry;
 *   hopeless extraction yields to the introspection sources
 * - the "[object Object]" defense-in-depth guard in classifyFromSources
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractRunErrorSources,
  synthesizeError,
  shouldRetryWithFreshAgent,
} from "../error-classifier.js";

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

/** A run.wait()-shaped error result carrying the given error-detail fields. */
function errorResult(fields: Record<string, unknown>): unknown {
  return { id: "run-1", status: "error", ...fields };
}

const NOTHING = { sdkError: undefined, sdkResultFields: undefined };

describe("extractRunErrorSources shape matrix", () => {
  it("routes a plain string to sdkResultFields", () => {
    expect(extractRunErrorSources(errorResult({ result: "rate limit exceeded" })))
      .toEqual({ sdkError: undefined, sdkResultFields: "rate limit exceeded" });
  });

  it("lifts an Error instance into the structured channel", () => {
    expect(extractRunErrorSources(errorResult({ result: new Error("connection lost") })))
      .toEqual({ sdkError: { message: "connection lost" }, sdkResultFields: undefined });
  });

  it("lifts an Error carrying a code (Node/SDK error shape)", () => {
    const err = Object.assign(new Error("stream torn down"), { code: "unavailable" });
    expect(extractRunErrorSources(errorResult({ result: err })))
      .toEqual({ sdkError: { code: "unavailable", message: "stream torn down" }, sdkResultFields: undefined });
  });

  it("lifts { code, status, message } from a plain object", () => {
    expect(extractRunErrorSources(errorResult({ error: { code: "unauthenticated", status: 401, message: "bad token" } })))
      .toEqual({
        sdkError: { code: "unauthenticated", status: 401, message: "bad token" },
        sdkResultFields: undefined,
      });
  });

  it("lifts a message-only object", () => {
    expect(extractRunErrorSources(errorResult({ error: { message: "boom" } })))
      .toEqual({ sdkError: { message: "boom" }, sdkResultFields: undefined });
  });

  it("lifts a code-only object", () => {
    expect(extractRunErrorSources(errorResult({ error: { code: "resource_exhausted" } })))
      .toEqual({ sdkError: { code: "resource_exhausted" }, sdkResultFields: undefined });
  });

  it("yields nothing for an object with no recognizable fields (no JSON.stringify junk)", () => {
    expect(extractRunErrorSources(errorResult({ result: { weird: "shape" } }))).toEqual(NOTHING);
  });

  it("yields nothing for a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractRunErrorSources(errorResult({ result: circular }))).toEqual(NOTHING);
  });

  it("refuses the '[object Object]' junk string itself", () => {
    expect(extractRunErrorSources(errorResult({ result: "[object Object]" }))).toEqual(NOTHING);
  });

  it("stringifies non-string primitives losslessly", () => {
    expect(extractRunErrorSources(errorResult({ result: 503 })))
      .toEqual({ sdkError: undefined, sdkResultFields: "503" });
  });

  it("yields nothing when no candidate field is present", () => {
    expect(extractRunErrorSources(errorResult({}))).toEqual(NOTHING);
  });

  it("yields nothing for non-object results", () => {
    expect(extractRunErrorSources(undefined)).toEqual(NOTHING);
    expect(extractRunErrorSources(null)).toEqual(NOTHING);
    expect(extractRunErrorSources("not-a-result-object")).toEqual(NOTHING);
  });
});

describe("extractRunErrorSources chain order (first USABLE candidate wins)", () => {
  it("a hopeless object in result no longer hides a usable string in message", () => {
    const extracted = extractRunErrorSources(
      errorResult({ result: { weird: "shape" }, message: "the real reason" }),
    );
    expect(extracted).toEqual({ sdkError: undefined, sdkResultFields: "the real reason" });
  });

  it("an empty string in result no longer short-circuits the chain", () => {
    const extracted = extractRunErrorSources(
      errorResult({ result: "", reason: "torn down mid-stream" }),
    );
    expect(extracted).toEqual({ sdkError: undefined, sdkResultFields: "torn down mid-stream" });
  });

  it("respects the documented field order: result before error before message before reason", () => {
    const extracted = extractRunErrorSources(
      errorResult({ result: "from-result", error: "from-error", message: "from-message" }),
    );
    expect(extracted.sdkResultFields).toBe("from-result");
  });

  it("yields nothing when every candidate is hopeless", () => {
    const extracted = extractRunErrorSources(
      errorResult({ result: {}, error: "", message: "[object Object]" }),
    );
    expect(extracted).toEqual(NOTHING);
  });
});

describe("end-to-end through synthesizeError", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a structured retryable error classifies and re-enables fresh-agent recovery", () => {
    // The regression at the heart of oss#299: String() turned this into
    // "[object Object]" -> category=unknown, retryable=false -> the
    // poisoned-handle retry could never fire for a plain network flake.
    const extracted = extractRunErrorSources(
      errorResult({ error: { code: "unavailable", message: "upstream connect error" } }),
    );
    const classified = synthesizeError({ ...base(), ...extracted });

    expect(classified.source).toBe("sdk");
    expect(classified.category).toBe("network");
    expect(classified.message).toBe("upstream connect error");
    expect(classified.retryable).toBe(true);
    expect(shouldRetryWithFreshAgent(classified)).toBe(true);
  });

  it("hopeless extraction yields to the conversation introspection source", () => {
    const extracted = extractRunErrorSources(errorResult({ result: { weird: "shape" } }));
    const classified = synthesizeError({
      ...base(),
      ...extracted,
      conversationErrorText: "grpc-status 12: routing failure",
    });

    expect(classified.source).toBe("conversation");
    expect(classified.message).toBe("grpc-status 12: routing failure");
  });

  it("hopeless extraction yields to the captured rejection source", () => {
    const extracted = extractRunErrorSources(errorResult({ result: { weird: "shape" } }));
    const classified = synthesizeError({
      ...base(),
      ...extracted,
      capturedRejection: { code: "unavailable", message: "socket hang up", timestamp: Date.now() },
    });

    expect(classified.source).toBe("rejection");
    expect(classified.message).toContain("socket hang up");
  });
});

describe("classifyFromSources '[object Object]' defense-in-depth guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a leaked '[object Object]' sdkResultFields as absent", () => {
    // Extraction never emits it, but any other producer of the junk string
    // must not shadow the sources below it.
    const classified = synthesizeError({
      ...base(),
      sdkResultFields: "[object Object]",
      streamErrorMessage: "fetch failed",
    });

    expect(classified.source).toBe("stream");
    expect(classified.category).toBe("network");
  });
});
