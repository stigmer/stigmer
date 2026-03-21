import { describe, it, expect } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import {
  StigmerError,
  wrapError,
  isNotFound,
  isUnauthenticated,
  isPermissionDenied,
  isRetryable,
} from "../../gen/errors";

describe("StigmerError", () => {
  it("has name 'StigmerError'", () => {
    const err = new StigmerError("not-found", "resource missing", Code.NotFound);
    expect(err.name).toBe("StigmerError");
  });

  it("inherits from Error", () => {
    const err = new StigmerError("internal", "boom", Code.Internal);
    expect(err).toBeInstanceOf(Error);
  });

  it("exposes code and connectCode", () => {
    const err = new StigmerError("unauthenticated", "bad token", Code.Unauthenticated);
    expect(err.code).toBe("unauthenticated");
    expect(err.connectCode).toBe(Code.Unauthenticated);
    expect(err.message).toBe("bad token");
  });
});

describe("wrapError", () => {
  const connectCodeMappings: Array<[Code, string]> = [
    [Code.NotFound, "not-found"],
    [Code.PermissionDenied, "permission-denied"],
    [Code.Unauthenticated, "unauthenticated"],
    [Code.InvalidArgument, "invalid-argument"],
    [Code.AlreadyExists, "already-exists"],
    [Code.ResourceExhausted, "resource-exhausted"],
    [Code.FailedPrecondition, "failed-precondition"],
    [Code.Internal, "internal"],
    [Code.Unavailable, "unavailable"],
    [Code.Canceled, "cancelled"],
  ];

  it.each(connectCodeMappings)(
    "maps ConnectError code %i to ErrorCode '%s'",
    (connectCode, expectedErrorCode) => {
      const connectErr = new ConnectError("test", connectCode);
      const result = wrapError(connectErr);
      expect(result).toBeInstanceOf(StigmerError);
      expect(result.code).toBe(expectedErrorCode);
    },
  );

  it("maps unmapped ConnectError codes to 'unknown'", () => {
    const connectErr = new ConnectError("test", 0 as unknown as Code);
    const result = wrapError(connectErr);
    expect(result.code).toBe("unknown");
  });

  it("passes through StigmerError unchanged", () => {
    const original = new StigmerError("not-found", "gone", Code.NotFound);
    const result = wrapError(original);
    expect(result).toBe(original);
  });

  it("wraps plain Error as 'unknown'", () => {
    const result = wrapError(new Error("something broke"));
    expect(result).toBeInstanceOf(StigmerError);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("something broke");
  });

  it("wraps string as 'unknown'", () => {
    const result = wrapError("raw string error");
    expect(result).toBeInstanceOf(StigmerError);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("raw string error");
  });
});

describe("predicates", () => {
  it("isNotFound returns true for not-found StigmerError", () => {
    expect(isNotFound(new StigmerError("not-found", "x", Code.NotFound))).toBe(true);
  });

  it("isNotFound returns false for other codes", () => {
    expect(isNotFound(new StigmerError("internal", "x", Code.Internal))).toBe(false);
  });

  it("isNotFound returns false for non-StigmerError", () => {
    expect(isNotFound(new Error("not found"))).toBe(false);
  });

  it("isUnauthenticated returns true for unauthenticated StigmerError", () => {
    expect(
      isUnauthenticated(new StigmerError("unauthenticated", "x", Code.Unauthenticated)),
    ).toBe(true);
  });

  it("isUnauthenticated returns false for other codes", () => {
    expect(
      isUnauthenticated(new StigmerError("not-found", "x", Code.NotFound)),
    ).toBe(false);
  });

  it("isPermissionDenied returns true for permission-denied StigmerError", () => {
    expect(
      isPermissionDenied(
        new StigmerError("permission-denied", "x", Code.PermissionDenied),
      ),
    ).toBe(true);
  });

  it("isPermissionDenied returns false for other codes", () => {
    expect(
      isPermissionDenied(new StigmerError("internal", "x", Code.Internal)),
    ).toBe(false);
  });

  it("isRetryable returns true for internal", () => {
    expect(isRetryable(new StigmerError("internal", "x", Code.Internal))).toBe(true);
  });

  it("isRetryable returns true for unavailable", () => {
    expect(isRetryable(new StigmerError("unavailable", "x", Code.Unavailable))).toBe(
      true,
    );
  });

  it("isRetryable returns false for not-found", () => {
    expect(isRetryable(new StigmerError("not-found", "x", Code.NotFound))).toBe(false);
  });

  it("isRetryable returns false for non-StigmerError", () => {
    expect(isRetryable(new Error("server error"))).toBe(false);
  });
});
