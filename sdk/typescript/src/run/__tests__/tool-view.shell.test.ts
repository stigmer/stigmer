// Covers shell normalization's `command` capture and result-shape handling: a
// terminal view models the whole session (prompt + output), so the command is
// echoed from args onto the view across every result shape — a Stigmer
// subagent's structured {stdout,stderr,exitCode} JSON, the exit-marker form, the
// runner shell's exit line, and plain text. The cross-language fixture
// (result-views.json) asserts the happy path; these cover the branch matrix and
// the missing-command edge.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { toolUseOf } from "./tool-use.js";
import { normalizeToolResult } from "../tool-view";

function shellCall(args: Record<string, unknown>, result: string) {
  return toolUseOf({
    id: "tc-shell",
    name: "shell",
    status: "completed",
    args: args as JsonObject,
    result,
  });
}

describe("normalizeToolResult — shell command capture", () => {
  it("captures the command on the plain (no-marker) branch", () => {
    const view = normalizeToolResult(shellCall({ command: "echo hi" }, "hi\n"));
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("echo hi");
    expect(view.stdout).toBe("hi\n");
  });

  it("captures the command on the exit-marker branch (success and failure)", () => {
    const ok = normalizeToolResult(
      shellCall({ command: "ls -la" }, "total 8\n[Command succeeded]"),
    );
    expect(ok.type).toBe("terminal");
    if (ok.type !== "terminal") return;
    expect(ok.command).toBe("ls -la");
    expect(ok.exitCode).toBe(0);

    const bad = normalizeToolResult(
      shellCall({ command: "false" }, "boom\n[Command failed with exit code 2]"),
    );
    expect(bad.type).toBe("terminal");
    if (bad.type !== "terminal") return;
    expect(bad.command).toBe("false");
    expect(bad.exitCode).toBe(2);
  });

  it("captures the command on the structured JSON branch", () => {
    const view = normalizeToolResult(
      shellCall(
        { command: "npm test" },
        JSON.stringify({ stdout: "ok", stderr: "", exitCode: 0 }),
      ),
    );
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("npm test");
    expect(view.stdout).toBe("ok");
  });

  it("leaves command undefined when args carry no command", () => {
    const view = normalizeToolResult(shellCall({}, "orphan output\n"));
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBeUndefined();
    expect(view.stdout).toBe("orphan output\n");
  });

  it("reads the runner shell's exit line after a failure, and a plain answer as exit 0", () => {
    const failed = normalizeToolResult(shellCall({ command: "exit 3" }, "[stderr] broken\n\nExit code: 3"));
    expect(failed.type === "terminal" ? [failed.stdout, failed.exitCode] : failed.type).toEqual(["[stderr] broken", 3]);
    const ok = normalizeToolResult(shellCall({ command: "printf one" }, "one\n"));
    expect(ok.type === "terminal" ? [ok.stdout, ok.exitCode] : ok.type).toEqual(["one\n", 0]);
  });
});

describe("normalizeToolResult — a failed command is still a command", () => {
  function failedShell(args: Record<string, unknown>, error: string) {
    return toolUseOf({ id: "tc-shell", name: "execute", status: "failed", args: args as JsonObject, error });
  }

  it("keeps the command, the output and the exit code the output names", () => {
    expect(normalizeToolResult(failedShell({ command: "npm test" }, "1 failed\n[Command failed with exit code 1]"))).toEqual({
      type: "terminal",
      command: "npm test",
      stdout: "1 failed",
      stderr: "",
      exitCode: 1,
    });
    expect(normalizeToolResult(failedShell({ command: "make" }, "[stderr] no rule\n\nExit code: 2"))).toMatchObject({ type: "terminal", exitCode: 2 });
  });

  it("names no exit code where the output names none, rather than reading it as 0", () => {
    const view = normalizeToolResult(failedShell({ command: "sleep 999" }, "the command timed out"));
    expect(view).toEqual({ type: "terminal", command: "sleep 999", stdout: "the command timed out", stderr: "" });
  });

  it("keeps any other kind's error as an error", () => {
    const view = normalizeToolResult(toolUseOf({ id: "tc-read", name: "read_file", status: "failed", args: { path: "a.md" }, error: "ENOENT" }));
    expect(view).toEqual({ type: "error", message: "ENOENT" });
  });
});
