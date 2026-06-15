import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { isRetryableError, isTerminalError } from "../grpc-retry.js";

// The persist-with-backoff loop that consumes these classifiers lives in
// status.ts and is exercised by status.test.ts ("persistStatus — transient
// retry"). This file covers the classification policy in isolation.

describe("isRetryableError", () => {
  it("returns true for UNAVAILABLE", () => {
    expect(isRetryableError(new ConnectError("down", Code.Unavailable))).toBe(true);
  });

  it("returns true for DEADLINE_EXCEEDED", () => {
    expect(isRetryableError(new ConnectError("slow", Code.DeadlineExceeded))).toBe(true);
  });

  it("returns false for NOT_FOUND", () => {
    expect(isRetryableError(new ConnectError("gone", Code.NotFound))).toBe(false);
  });

  it("returns false for non-ConnectError", () => {
    expect(isRetryableError(new Error("random"))).toBe(false);
  });
});

describe("isTerminalError", () => {
  it("returns true for INVALID_ARGUMENT", () => {
    expect(isTerminalError(new ConnectError("bad", Code.InvalidArgument))).toBe(true);
  });

  it("returns true for NOT_FOUND", () => {
    expect(isTerminalError(new ConnectError("gone", Code.NotFound))).toBe(true);
  });

  it("returns true for PERMISSION_DENIED", () => {
    expect(isTerminalError(new ConnectError("nope", Code.PermissionDenied))).toBe(true);
  });

  it("returns false for UNAVAILABLE", () => {
    expect(isTerminalError(new ConnectError("down", Code.Unavailable))).toBe(false);
  });
});
