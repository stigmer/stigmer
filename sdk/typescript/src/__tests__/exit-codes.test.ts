/**
 * Pins the shared exit-code table (../exit-codes.ts): a turn's outcome maps by
 * its phase (completed 0; failed, cancelled, terminated 1; a turn that has
 * not ended, because the wait stopped, 130), an error by its category
 * (unavailable 3, unauthenticated and denied 4, not found 5, a refused input
 * 2, anything else 1), and an error that carries its own code keeps it.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeOf } from "../exit-codes.js";
import { StigmerError } from "../errors.js";

describe("exitCodeOf", () => {
  it("reads a turn's outcome by its phase", () => {
    expect(exitCodeOf({ phase: "completed" })).toBe(0);
    for (const phase of ["failed", "cancelled", "terminated"] as const) expect(exitCodeOf({ phase })).toBe(1);
    for (const phase of ["pending", "running", "waiting", "paused"] as const) expect(exitCodeOf({ phase })).toBe(130);
  });

  it("reads an error by its category", () => {
    expect(exitCodeOf(new ConnectError("connect ECONNREFUSED 127.0.0.1:1", Code.Unavailable))).toBe(ExitCode.Connection);
    expect(exitCodeOf(new ConnectError("no", Code.Unauthenticated))).toBe(ExitCode.Auth);
    expect(exitCodeOf(new ConnectError("no", Code.PermissionDenied))).toBe(ExitCode.Auth);
    expect(exitCodeOf(new ConnectError("gone", Code.NotFound))).toBe(ExitCode.NotFound);
    expect(exitCodeOf(new ConnectError("bad", Code.InvalidArgument))).toBe(ExitCode.Usage);
    expect(exitCodeOf(new StigmerError("internal", "boom", 13))).toBe(ExitCode.General);
    expect(exitCodeOf(new Error("anything"))).toBe(ExitCode.General);
    expect(exitCodeOf("a string")).toBe(ExitCode.General);
  });

  it("keeps a code an error carries, and ignores one outside the table", () => {
    expect(exitCodeOf(Object.assign(new Error("refused"), { exitCode: 3 }))).toBe(3);
    expect(exitCodeOf(Object.assign(new Error("odd"), { exitCode: 42 }))).toBe(ExitCode.General);
    expect(exitCodeOf({ phase: "unheard-of" })).toBe(ExitCode.General);
  });
});
