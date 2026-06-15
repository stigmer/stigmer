/**
 * Extended gRPC error-classification tests — ported from Python
 * test_grpc_retry.py. Covers additional status codes beyond the core
 * grpc-retry.test.ts. The persist-with-backoff loop that consumes these
 * classifiers is tested in status.test.ts ("persistStatus — transient retry").
 */

import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { isRetryableError, isTerminalError } from "../grpc-retry.js";

describe("isRetryableError — extended codes", () => {
  it("returns false for INTERNAL", () => {
    expect(isRetryableError(new ConnectError("err", Code.Internal))).toBe(false);
  });

  it("returns false for ALREADY_EXISTS", () => {
    expect(isRetryableError(new ConnectError("dup", Code.AlreadyExists))).toBe(false);
  });

  it("returns false for CANCELLED", () => {
    expect(isRetryableError(new ConnectError("cancelled", Code.Canceled))).toBe(false);
  });
});

describe("isTerminalError — extended codes", () => {
  it("returns false for INTERNAL", () => {
    expect(isTerminalError(new ConnectError("err", Code.Internal))).toBe(false);
  });

  it("returns false for DEADLINE_EXCEEDED", () => {
    expect(isTerminalError(new ConnectError("slow", Code.DeadlineExceeded))).toBe(false);
  });

  it("returns false for non-ConnectError", () => {
    expect(isTerminalError(new Error("random"))).toBe(false);
  });
});
