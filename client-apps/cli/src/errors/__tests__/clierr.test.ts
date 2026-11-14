import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { StigmerError } from "@stigmer/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDebug, setServerHelpProbe } from "../../runtime.js";
import { classify } from "../classify.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import { formatError, handle, isServerAnswer, serverHelpFor } from "../handle.js";
import { UsageError } from "../usage-error.js";
import { CliExitError } from "../cli-exit-error.js";

afterEach(() => {
  setDebug(false);
  setServerHelpProbe(undefined);
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

describe("classify — an organization that has used its plan's agent hours", () => {
  const sentence =
    "Your organization has used the 10 agent hours its Free plan includes this month. New work can start again on 1 November.";

  function refusal(plan: string): ConnectError {
    return new ConnectError(sentence, Code.FailedPrecondition, undefined, [
      {
        desc: ErrorInfoSchema,
        value: create(ErrorInfoSchema, {
          reason: "AGENT_HOURS_USED_UP",
          domain: "stigmer.ai",
          metadata: { org: "acme", plan, included_hours: "10", resets_at: "2026-11-01T00:00:00.000Z" },
        }),
      },
    ]);
  }

  it("prints the server's sentence as is and points to the command that shows the hours", () => {
    expect(classify(refusal("Free"))).toEqual(
      expect.objectContaining({
        exitCode: ExitCode.Usage,
        message: sentence,
        hints: ["See the organization's agent hours:", "  stigmer usage hours"],
      }),
    );
  });

  it("does the same when the SDK wraps the refusal", () => {
    const wrapped = new StigmerError("failed-precondition", sentence, Code.FailedPrecondition, {
      cause: refusal("Free"),
    });
    expect(classify(wrapped)?.hints).toEqual(["See the organization's agent hours:", "  stigmer usage hours"]);
  });

  it("gives a child organization, whose refusal names no plan, no hint", () => {
    const result = classify(refusal(""));
    expect(result?.message).toBe(sentence);
    expect(result?.hints).toBeUndefined();
  });

  it("leaves every other FailedPrecondition as it was", () => {
    expect(classify(new ConnectError("nope", Code.FailedPrecondition))?.message).toBe("Precondition failed: nope");
  });
});

describe("classify — a key created before sign-in was turned on (stigmer/stigmer#1169)", () => {
  const sentence =
    "this API key was created before sign-in was turned on and no longer authenticates anyone; sign in and create a new key";

  function refusal(): ConnectError {
    return new ConnectError(sentence, Code.Unauthenticated, undefined, [
      {
        desc: ErrorInfoSchema,
        value: create(ErrorInfoSchema, {
          reason: "API_KEY_CREATED_BEFORE_SIGN_IN",
          domain: "stigmer.ai",
        }),
      },
    ]);
  }

  const expected = {
    exitCode: ExitCode.Auth,
    message: sentence,
    hints: [
      "Sign in, then create a new key:",
      "  stigmer auth login",
      "  stigmer apikey create --name <name>",
    ],
  };

  it("prints the server's sentence and the two commands that fix it", () => {
    expect(classify(refusal())).toMatchObject(expected);
  });

  it("does the same when the SDK wraps the refusal", () => {
    const wrapped = new StigmerError("unauthenticated", sentence, Code.Unauthenticated, {
      cause: refusal(),
    });
    expect(classify(wrapped)).toMatchObject(expected);
  });

  it("leaves every other Unauthenticated as it was", () => {
    expect(classify(new ConnectError("invalid token", Code.Unauthenticated))).toMatchObject({
      message: "Not authenticated",
      hints: ["Please sign in:", "  stigmer auth login"],
    });
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

  it("ends with the server's help line, after the hints", () => {
    const out = formatError(
      { exitCode: ExitCode.NotFound, message: "agent missing", hints: ["List them: stigmer list agent"] },
      false,
      { url: "https://help.acme.example", label: "Ask IT" },
    );
    expect(out).toBe("Error: agent missing\n\nList them: stigmer list agent\n\nStuck? Ask IT: https://help.acme.example\n");
  });

  it("prints no help line for a silent error", () => {
    expect(formatError({ exitCode: ExitCode.Success, message: "" }, false, { url: "https://h.example", label: "Help" })).toBe("");
  });
});

describe("CLI-19 a command the server refused ends with the server's help line", () => {
  const HELP = { url: "https://help.acme.example", label: "Ask IT" };
  const refusal = classify(new ConnectError("agent missing", Code.NotFound));
  const unreachable = classify(new ConnectError("fetch failed", Code.Unavailable, undefined, undefined, new Error("connect ECONNREFUSED 127.0.0.1:7234")));
  const busy = classify(new ConnectError("the server is busy", Code.Unavailable));
  const timedOut = classify(new ConnectError("deadline", Code.DeadlineExceeded));
  const local = classify(new UsageError("unknown flag"));

  it("counts a refusal and a server's own Unavailable as the server's answer", () => {
    expect(refusal !== null && isServerAnswer(refusal)).toBe(true);
    expect(busy !== null && isServerAnswer(busy)).toBe(true);
  });

  it("never counts an unreachable server, a timeout or a local refusal", () => {
    for (const error of [unreachable, timedOut, local]) {
      expect(error !== null && isServerAnswer(error)).toBe(false);
    }
  });

  it("asks the server for its link after a refusal", async () => {
    setServerHelpProbe(() => Promise.resolve(HELP));
    expect(await serverHelpFor(refusal!)).toEqual(HELP);
  });

  it("asks nothing when the server could not be reached, or on a local refusal", async () => {
    const probe = vi.fn(() => Promise.resolve(HELP));
    setServerHelpProbe(probe);
    expect(await serverHelpFor(unreachable!)).toBeUndefined();
    expect(await serverHelpFor(local!)).toBeUndefined();
    expect(await serverHelpFor(timedOut!)).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it("prints without the line when no client was made, the server set none, or asking fails", async () => {
    expect(await serverHelpFor(refusal!)).toBeUndefined();
    setServerHelpProbe(() => Promise.resolve(undefined));
    expect(await serverHelpFor(refusal!)).toBeUndefined();
    setServerHelpProbe(() => Promise.reject(new Error("down")));
    expect(await serverHelpFor(refusal!)).toBeUndefined();
  });

  it("does not wait past its bound for a slow server", async () => {
    setServerHelpProbe(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await serverHelpFor(refusal!, 50)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("counts a refusal a command says in its own words, when it passes the refusal as its cause", async () => {
    const reworded = classify(
      new CliExitError('no agent "nope" in acme', ExitCode.NotFound, ["See them: stigmer list agents"], {
        cause: new ConnectError("agent not found", Code.NotFound),
      }),
    );
    expect(reworded?.code).toBe(Code.NotFound);
    expect(reworded !== null && isServerAnswer(reworded)).toBe(true);
    setServerHelpProbe(() => Promise.resolve(HELP));
    expect(await serverHelpFor(reworded!)).toEqual(HELP);
    // A local refusal carries no cause and stays the CLI's own.
    expect(isServerAnswer(classify(new CliExitError("organization not set", ExitCode.Usage))!)).toBe(false);
  });

  it("prints the server's words and address with no control or escape sequence", () => {
    const out = formatError({ exitCode: ExitCode.NotFound, message: "x" }, false, {
      url: "https://help.acme.example/\u001b]52;c;cHduZWQ=\u0007",
      label: "Ask\u001b[2K IT",
    });
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
    expect(out).toContain("Stuck? Ask [2K IT: https://help.acme.example/ ]52;c;cHduZWQ=");
  });

  it("handle prints the line as the failure's last line", async () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    setServerHelpProbe(() => Promise.resolve(HELP));
    await expect(handle(new ConnectError("agent missing", Code.NotFound))).rejects.toThrow("__exit__:5");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringMatching(/Stuck\? Ask IT: https:\/\/help\.acme\.example\n$/));
  });
});

describe("handle", () => {
  it("exits with the mapped code and writes to stderr", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await expect(handle(new ConnectError("agent missing", Code.NotFound))).rejects.toThrow("__exit__:5");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Error: agent missing"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NotFound);
  });

  it("exits 0 silently for a local abort", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(handle(abort)).rejects.toThrow("__exit__:0");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("exits 0 when there is no error", async () => {
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    await expect(handle(null)).rejects.toThrow("__exit__:0");
  });
});
