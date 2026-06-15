import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDebug } from "../runtime.js";
import { classify } from "./classify.js";
import { ExitCode } from "./exit-codes.js";
import { formatError, handle } from "./handle.js";
import { UsageError } from "./usage-error.js";

afterEach(() => {
  setDebug(false);
  vi.restoreAllMocks();
});

describe("classify — gRPC code to exit code", () => {
  // Drives both error sources: a raw ConnectError (direct transport usage) and
  // an SDK StigmerError (typed client usage). Both must classify identically.
  const cases: ReadonlyArray<{ code: number; exit: number; messageContains?: string }> = [
    { code: Code.Unavailable, exit: ExitCode.Connection },
    { code: Code.DeadlineExceeded, exit: ExitCode.Connection },
    { code: Code.ResourceExhausted, exit: ExitCode.Connection },
    { code: Code.NotFound, exit: ExitCode.NotFound },
    { code: Code.InvalidArgument, exit: ExitCode.Usage },
    { code: Code.FailedPrecondition, exit: ExitCode.Usage, messageContains: "Precondition failed" },
    { code: Code.AlreadyExists, exit: ExitCode.Usage, messageContains: "Already exists" },
    { code: Code.Unauthenticated, exit: ExitCode.Auth },
    { code: Code.PermissionDenied, exit: ExitCode.Auth, messageContains: "Permission denied" },
    { code: Code.Internal, exit: ExitCode.General },
    { code: Code.Aborted, exit: ExitCode.General, messageContains: "Operation aborted" },
    { code: Code.Canceled, exit: ExitCode.General },
    { code: Code.Unimplemented, exit: ExitCode.General, messageContains: "Unimplemented" },
    { code: Code.OutOfRange, exit: ExitCode.General, messageContains: "OutOfRange" },
    { code: Code.DataLoss, exit: ExitCode.General, messageContains: "DataLoss" },
  ];

  for (const { code, exit, messageContains } of cases) {
    it(`maps ConnectError ${Code[code]} -> exit ${exit}`, () => {
      const result = classify(new ConnectError("boom", code));
      expect(result?.exitCode).toBe(exit);
      expect(result?.code).toBe(code);
      if (messageContains) expect(result?.message).toContain(messageContains);
    });

    it(`maps StigmerError ${Code[code]} -> exit ${exit}`, () => {
      const result = classify(new StigmerError("unknown", "boom", code));
      expect(result?.exitCode).toBe(exit);
    });
  }

  it("preserves the server message verbatim for NotFound", () => {
    const result = classify(new ConnectError("agent 'foo' not found", Code.NotFound));
    expect(result?.message).toBe("agent 'foo' not found");
  });

  it("attaches remediation hints for auth failures", () => {
    const result = classify(new ConnectError("nope", Code.Unauthenticated));
    expect(result?.hints).toEqual(["Please sign in:", "  stigmer auth login"]);
  });
});

describe("classify — non-RPC and edge cases", () => {
  it("returns null for null/undefined", () => {
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
  });

  it("classifies a plain Error as a general failure", () => {
    const result = classify(new Error("disk full"));
    expect(result?.exitCode).toBe(ExitCode.General);
    expect(result?.message).toBe("disk full");
    expect(result?.code).toBeUndefined();
  });

  it("unwraps a wrapped RPC error via the cause chain", () => {
    const inner = new ConnectError("not found", Code.NotFound);
    const wrapped = new Error("while fetching agent", { cause: inner });
    const result = classify(wrapped);
    expect(result?.exitCode).toBe(ExitCode.NotFound);
  });

  it("maps a local UsageError to the usage exit code", () => {
    const result = classify(new UsageError("invalid --output value"));
    expect(result?.exitCode).toBe(ExitCode.Usage);
    expect(result?.message).toBe("invalid --output value");
  });
});

describe("classify — local abort vs remote cancel", () => {
  it("treats a local AbortError as a clean exit 0 with no message", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const result = classify(abort);
    expect(result?.exitCode).toBe(ExitCode.Success);
    expect(result?.message).toBe("");
  });

  it("treats an aborted RPC (Canceled wrapping AbortError) as exit 0", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const cancelled = new ConnectError("canceled", Code.Canceled, undefined, undefined, abort);
    const result = classify(cancelled);
    expect(result?.exitCode).toBe(ExitCode.Success);
  });

  it("treats a remote Canceled (no local abort) as exit 1", () => {
    const result = classify(new ConnectError("server canceled", Code.Canceled));
    expect(result?.exitCode).toBe(ExitCode.General);
    expect(result?.message).toBe("Operation cancelled");
  });
});

describe("formatError", () => {
  it("renders message and hints", () => {
    const out = formatError(
      { exitCode: ExitCode.Auth, message: "Not authenticated", hints: ["Please sign in:", "  stigmer auth login"] },
      false,
    );
    expect(out).toBe("Error: Not authenticated\n\nPlease sign in:\n  stigmer auth login\n");
  });

  it("returns empty string for a silent (empty message) error", () => {
    expect(formatError({ exitCode: ExitCode.Success, message: "" }, false)).toBe("");
  });

  it("appends the raw chain and numeric code in debug mode", () => {
    const cause = new ConnectError("boom", Code.NotFound);
    const out = formatError(
      { exitCode: ExitCode.NotFound, message: "missing", cause, code: Code.NotFound },
      true,
    );
    expect(out).toContain("--- debug ---");
    expect(out).toContain(`gRPC code: NotFound (${Code.NotFound})`);
  });

  it("omits the debug block when debug mode is off", () => {
    const cause = new Error("boom");
    const out = formatError({ exitCode: ExitCode.General, message: "x", cause }, false);
    expect(out).not.toContain("--- debug ---");
  });
});

describe("handle", () => {
  it("exits with the mapped code and writes to stderr", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(() => handle(new ConnectError("agent missing", Code.NotFound))).toThrow("__exit__:5");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Error: agent missing"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NotFound);
  });

  it("exits 0 silently for a local abort", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(() => handle(abort)).toThrow("__exit__:0");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("exits 0 when there is no error", () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    expect(() => handle(null)).toThrow("__exit__:0");
  });
});
