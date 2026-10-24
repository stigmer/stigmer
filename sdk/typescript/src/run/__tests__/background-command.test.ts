// Covers a command the agent ran in the background as the clients read it:
// its result view is its own output (what it printed so far while it runs,
// what it printed once it ended, with its exit code; an error for one that
// failed to start), never the start's answer; and each state in the words
// the terminal clients print ("Background command `npm test` exited with
// code 1").

import { describe, it, expect } from "vitest";
import type { BackgroundCommandView } from "@stigmer/session-log";
import { toolUseOf } from "./tool-use.js";
import { normalizeToolResult } from "../tool-view";
import { backgroundCommandText, backgroundEndingLine, backgroundEndingPhrase } from "../background-command";

function background(init: Partial<BackgroundCommandView> = {}): BackgroundCommandView {
  return {
    state: "running",
    timeoutSeconds: 300,
    exitCode: undefined,
    stoppedBy: undefined,
    stoppedByToolUseId: "",
    output: "",
    startedAt: "t0",
    endedAt: "",
    liveOutput: "",
    stopRequested: false,
    ...init,
  };
}

function start(view: BackgroundCommandView, command = "npm test") {
  return { ...toolUseOf({ name: "execute", args: { command, background: true }, result: "Started in the background (id bg-1)." }), background: view };
}

describe("normalizeToolResult — a background command", () => {
  it("is its output so far while it runs, never the start's answer", () => {
    expect(normalizeToolResult(start(background({ liveOutput: "PASS a\n" })))).toEqual({ type: "terminal", command: "npm test", stdout: "PASS a\n", stderr: "" });
  });

  it("is what it printed once it ended, with its exit code", () => {
    const view = normalizeToolResult(start(background({ state: "exited", exitCode: 1, output: "FAIL b\nExit code: 1" })));
    expect(view).toMatchObject({ type: "terminal", command: "npm test", exitCode: 1 });
    expect(view.type === "terminal" && view.stdout).toContain("FAIL b");
    expect(normalizeToolResult(start(background({ state: "stopped", stoppedBy: "person", output: "half" })))).toMatchObject({ type: "terminal", stdout: "half" });
  });

  it("is an error for one that failed to start", () => {
    expect(normalizeToolResult(start(background({ state: "failed_to_start", output: "spawn /bin/sh ENOENT" })))).toEqual({ type: "error", message: "spawn /bin/sh ENOENT" });
  });
});

describe("a background command in words", () => {
  it.each([
    [background(), "is running"],
    [background({ state: "exited", exitCode: 1 }), "exited with code 1"],
    [background({ state: "timed_out" }), "timed out after 300 seconds"],
    [background({ state: "failed_to_start" }), "failed to start"],
    [background({ state: "stopped", stoppedBy: "agent" }), "was stopped by the agent"],
    [background({ state: "stopped", stoppedBy: "person" }), "was stopped by the person"],
    [background({ state: "stopped", stoppedBy: "approval" }), "was stopped when the turn paused for approval"],
    [background({ state: "stopped", stoppedBy: "turn" }), "was stopped with the turn"],
  ])("%#: %s", (view, phrase) => {
    expect(backgroundEndingPhrase(view)).toBe(phrase);
  });

  it("names the command on one line, cut, and says nothing for a call that started none", () => {
    expect(backgroundEndingLine(start(background({ state: "exited", exitCode: 0 }), "npm   test\n  --watch"))).toBe("Background command `npm test --watch` exited with code 0");
    expect(backgroundCommandText({ input: { command: "x".repeat(100) } })).toBe(`${"x".repeat(80)}…`);
    expect(backgroundCommandText({ input: {} })).toBe("");
    expect(backgroundEndingLine({ input: {}, background: background() })).toBe("Background command is running");
    expect(backgroundEndingLine({ input: { command: "ls" }, background: undefined })).toBeUndefined();
  });
});
