import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { StigmerError, type ErrorCode } from "../gen/errors";
import {
  classifyError,
  isRetryableError,
  isTransientStreamError,
  getUserMessage,
  annotateRpcError,
  getRpcMetadata,
  type ErrorCategory,
} from "../errors";

/**
 * Guest launch-gate refusal contract (shared-agent abuse controls).
 *
 * The cloud backend resolves owner-customizable refusal copy server-side and
 * carries it in the gRPC status description; the SDK must surface that copy
 * VERBATIM through getUserMessage — no client-side mapping exists by design.
 * These tests pin the two halves of that contract:
 *
 * 1. RESOURCE_EXHAUSTED / FAILED_PRECONDITION descriptions pass through
 *    getUserMessage untouched.
 * 2. The platform-default copy (mirrors GuestLimitReason in the cloud
 *    backend) never collides with the sanitizer's rewrite patterns.
 */
describe("guest launch-gate refusal copy passthrough", () => {
  // Mirrors GuestLimitReason default copy in the cloud stigmer-service.
  // If those strings change, update here — this guardrail exists to catch a
  // default that a sanitizer pattern would silently rewrite.
  const platformDefaultCopy = [
    "You\u2019re sending messages too quickly. Please wait a moment before sending another.",
    "This agent is currently unavailable. Please check back later.",
    "This conversation has ended. Please start a new conversation to continue.",
    "This agent can\u2019t be embedded on this site.",
  ];

  const refusalCodes: Array<[string, Code]> = [
    ["ResourceExhausted (rate limit)", Code.ResourceExhausted],
    ["FailedPrecondition (fail-closed / bounds)", Code.FailedPrecondition],
    ["PermissionDenied (embed origin)", Code.PermissionDenied],
  ];

  it.each(refusalCodes)(
    "surfaces a %s status description verbatim",
    (_label, code) => {
      for (const copy of platformDefaultCopy) {
        expect(getUserMessage(new ConnectError(copy, code))).toBe(copy);
      }
    },
  );

  it("surfaces owner-customized copy verbatim", () => {
    const ownerCopy = "Whoa, slow down! Try again in a minute or two.";
    expect(
      getUserMessage(new ConnectError(ownerCopy, Code.ResourceExhausted)),
    ).toBe(ownerCopy);
  });

  it("classifies rate-limit refusals as retryable and bounds refusals as not", () => {
    expect(
      isRetryableError(new ConnectError("copy", Code.ResourceExhausted)),
    ).toBe(true);
    expect(
      isRetryableError(new ConnectError("copy", Code.FailedPrecondition)),
    ).toBe(false);
  });
});

describe("classifyError", () => {
  const stigmerMappings: Array<[string, ErrorCategory]> = [
    ["unauthenticated", "auth"],
    ["permission-denied", "permission"],
    ["not-found", "not-found"],
    ["invalid-argument", "validation"],
    ["already-exists", "validation"],
    ["failed-precondition", "validation"],
    ["resource-exhausted", "unavailable"],
    ["internal", "server"],
    ["unavailable", "unavailable"],
    ["cancelled", "cancelled"],
    ["unknown", "server"],
  ];

  it.each(stigmerMappings)(
    "maps StigmerError code '%s' to category '%s'",
    (errorCode, expectedCategory) => {
      const result = classifyError(
        new StigmerError(errorCode as ErrorCode, "test", Code.Unknown),
      );
      expect(result).toBe(expectedCategory);
    },
  );

  const connectMappings: Array<[Code, ErrorCategory]> = [
    [Code.Unauthenticated, "auth"],
    [Code.PermissionDenied, "permission"],
    [Code.NotFound, "not-found"],
    [Code.InvalidArgument, "validation"],
    [Code.FailedPrecondition, "validation"],
    [Code.OutOfRange, "validation"],
    [Code.AlreadyExists, "validation"],
    [Code.Aborted, "validation"],
    [Code.Internal, "server"],
    [Code.Unknown, "server"],
    [Code.DataLoss, "server"],
    [Code.Unimplemented, "server"],
    [Code.Unavailable, "unavailable"],
    [Code.DeadlineExceeded, "unavailable"],
    [Code.ResourceExhausted, "unavailable"],
    [Code.Canceled, "cancelled"],
  ];

  it.each(connectMappings)(
    "maps ConnectError code %i to category '%s'",
    (code, expectedCategory) => {
      const result = classifyError(new ConnectError("test", code));
      expect(result).toBe(expectedCategory);
    },
  );

  it("returns 'unknown' for plain Error", () => {
    expect(classifyError(new Error("random"))).toBe("unknown");
  });

  it("returns 'unknown' for string", () => {
    expect(classifyError("just a string")).toBe("unknown");
  });

  it("returns 'unknown' for null", () => {
    expect(classifyError(null)).toBe("unknown");
  });
});

describe("isRetryableError", () => {
  it("returns true for 'server' category errors", () => {
    expect(
      isRetryableError(new StigmerError("internal", "boom", Code.Internal)),
    ).toBe(true);
  });

  it("returns true for 'unavailable' category errors", () => {
    expect(
      isRetryableError(
        new StigmerError("unavailable", "down", Code.Unavailable),
      ),
    ).toBe(true);
  });

  it("returns false for 'auth' category errors", () => {
    expect(
      isRetryableError(
        new StigmerError("unauthenticated", "bad token", Code.Unauthenticated),
      ),
    ).toBe(false);
  });

  it("returns false for 'not-found' category errors", () => {
    expect(
      isRetryableError(
        new StigmerError("not-found", "gone", Code.NotFound),
      ),
    ).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isRetryableError(new Error("oops"))).toBe(false);
  });
});

describe("isTransientStreamError", () => {
  it("is true for retryable category errors (server / unavailable)", () => {
    expect(
      isTransientStreamError(
        new StigmerError("unavailable", "down", Code.Unavailable),
      ),
    ).toBe(true);
    expect(
      isTransientStreamError(new ConnectError("boom", Code.Internal)),
    ).toBe(true);
  });

  // The crux of #174: WebKit (Safari / WKWebView) phrases a failed fetch as a
  // bare `TypeError: Load failed`, which classifies as `unknown` (not
  // retryable) — yet it is exactly the transient drop we must auto-reconnect.
  it.each([
    "Load failed",
    "TypeError: Load failed",
    "Failed to fetch",
    "fetch failed",
    "read ECONNRESET",
    "connect ETIMEDOUT",
  ])("is true for transport noise %j (even as a bare TypeError)", (message) => {
    expect(isTransientStreamError(new TypeError(message))).toBe(true);
  });

  it.each([
    new StigmerError("not-found", "gone", Code.NotFound),
    new StigmerError("invalid-argument", "bad", Code.InvalidArgument),
    new StigmerError("unauthenticated", "no token", Code.Unauthenticated),
    new Error("some deterministic application error"),
  ])("is false for deterministic / unknown errors", (error) => {
    expect(isTransientStreamError(error)).toBe(false);
  });
});

describe("getUserMessage", () => {
  it("extracts message from StigmerError", () => {
    const err = new StigmerError("not-found", "Agent not found", Code.NotFound);
    expect(getUserMessage(err)).toBe("Agent not found");
  });

  it("extracts rawMessage from ConnectError", () => {
    const err = new ConnectError("Agent not found", Code.NotFound);
    expect(getUserMessage(err)).toBe("Agent not found");
  });

  it("extracts message from plain Error", () => {
    expect(getUserMessage(new Error("something"))).toBe("something");
  });

  it("extracts message from string", () => {
    expect(getUserMessage("a string error")).toBe("a string error");
  });

  it("sanitizes 'no healthy upstream' to readable message", () => {
    const err = new StigmerError(
      "unavailable",
      "no healthy upstream",
      Code.Unavailable,
    );
    expect(getUserMessage(err)).toBe(
      "The server is temporarily unavailable.",
    );
  });

  it("sanitizes 'ECONNREFUSED'", () => {
    expect(getUserMessage(new Error("connect ECONNREFUSED 127.0.0.1"))).toBe(
      "Unable to connect to the server.",
    );
  });

  it("sanitizes 'fetch failed'", () => {
    expect(getUserMessage(new Error("fetch failed"))).toBe(
      "Unable to reach the server. Check your connection.",
    );
  });

  it("sanitizes WebKit's 'Load failed' (Safari / WKWebView)", () => {
    expect(getUserMessage(new TypeError("Load failed"))).toBe(
      "The connection to the server was lost.",
    );
  });

  it("uses category fallback when message is empty", () => {
    const err = new StigmerError("not-found", "", Code.NotFound);
    expect(getUserMessage(err)).toBe("The requested resource was not found.");
  });

  it("uses custom fallback when provided and message is empty", () => {
    const err = new StigmerError("not-found", "", Code.NotFound);
    expect(getUserMessage(err, "Custom fallback")).toBe("Custom fallback");
  });

  it("uses 'unknown' category fallback for non-SDK errors without message", () => {
    expect(getUserMessage(42)).toBe("An unexpected error occurred.");
  });
});

describe("annotateRpcError / getRpcMetadata", () => {
  it("roundtrips metadata on an error object", () => {
    const err = new Error("test");
    const metadata = { method: "Get", path: "/api/agent" };
    annotateRpcError(err, metadata);
    expect(getRpcMetadata(err)).toEqual(metadata);
  });

  it("returns undefined for unannotated errors", () => {
    expect(getRpcMetadata(new Error("no metadata"))).toBeUndefined();
  });

  it("returns undefined for non-object errors", () => {
    expect(getRpcMetadata("string error")).toBeUndefined();
    expect(getRpcMetadata(null)).toBeUndefined();
    expect(getRpcMetadata(42)).toBeUndefined();
  });
});
