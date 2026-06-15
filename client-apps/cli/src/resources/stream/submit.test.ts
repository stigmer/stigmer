// Tests for approval-submit resilience: retry classification, backoff loop,
// and stream-error message parity with Go.

import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { classifyStreamError, isRetryableSubmitError, retryWithBackoff } from "./submit.js";

const never = new AbortController().signal;

describe("isRetryableSubmitError", () => {
  it("retries transient gRPC codes", () => {
    for (const code of [Code.Unavailable, Code.DeadlineExceeded, Code.ResourceExhausted, Code.Aborted, Code.Internal, Code.Unknown]) {
      expect(isRetryableSubmitError(new ConnectError("x", code))).toBe(true);
    }
  });

  it("retries FailedPrecondition only for 'no pending approvals'", () => {
    expect(isRetryableSubmitError(new ConnectError("no pending approvals yet", Code.FailedPrecondition))).toBe(true);
    expect(isRetryableSubmitError(new ConnectError("something else", Code.FailedPrecondition))).toBe(false);
  });

  it("does not retry permanent codes, but retries non-RPC errors", () => {
    expect(isRetryableSubmitError(new ConnectError("nope", Code.NotFound))).toBe(false);
    expect(isRetryableSubmitError(new ConnectError("nope", Code.InvalidArgument))).toBe(false);
    expect(isRetryableSubmitError(new Error("socket hang up"))).toBe(true);
  });
});

describe("retryWithBackoff", () => {
  it("retries a retryable failure then succeeds", async () => {
    let calls = 0;
    await retryWithBackoff(never, 3, 1, async () => {
      calls++;
      if (calls < 3) throw new ConnectError("lost", Code.Unavailable);
    });
    expect(calls).toBe(3);
  });

  it("stops immediately on a non-retryable failure", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(never, 3, 1, async () => {
        calls++;
        throw new ConnectError("bad", Code.InvalidArgument);
      }),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(never, 2, 1, async () => {
        calls++;
        throw new ConnectError("still down", Code.Unavailable);
      }),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(calls).toBe(2);
  });
});

describe("classifyStreamError", () => {
  it("maps known codes and appends a resume hint", () => {
    const msg = classifyStreamError(new ConnectError("x", Code.Unavailable), "ses_1");
    expect(msg).toContain("Connection to server lost.");
    expect(msg).toContain("stigmer resume ses_1");
  });

  it("omits the resume hint when there is no session", () => {
    const msg = classifyStreamError(new ConnectError("x", Code.DeadlineExceeded), "");
    expect(msg).toBe("Server response timed out.");
  });

  it("falls back for non-RPC errors", () => {
    expect(classifyStreamError(new Error("boom"), "")).toBe("Unexpected stream error: boom");
  });
});
