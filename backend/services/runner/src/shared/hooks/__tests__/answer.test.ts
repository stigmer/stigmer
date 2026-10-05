/**
 * Pins how a hook run's result is read, Claude Code's rule: exit 2 blocks
 * with stderr, JSON on stdout decides on any exit code, and anything else
 * (a plain exit 0, another code, a timeout, a command that did not start,
 * JSON that does not parse) makes no decision; text is capped.
 */

import { describe, expect, it } from "vitest";
import { HOOK_TEXT_CAP, parsePostToolUse, parsePreToolUse } from "../answer.js";
import type { HookRunResult } from "../run.js";

const ran = (overrides: Partial<HookRunResult>): HookRunResult => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...overrides,
});
const json = (value: unknown): string => JSON.stringify(value);

describe("parsePreToolUse", () => {
  it("exit 2 denies with stderr as the reason", () => {
    expect(parsePreToolUse(ran({ exitCode: 2, stderr: " no rm -rf \n" }))).toEqual({ decision: "deny", reason: "no rm -rf" });
    expect(parsePreToolUse(ran({ exitCode: 2 })).reason).toBe("A hook blocked this call.");
  });

  it("reads hookSpecificOutput on any exit code", () => {
    const stdout = json({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "pushing needs a person",
        updatedInput: { command: "git push --dry-run" },
        additionalContext: "the branch is protected",
      },
    });
    expect(parsePreToolUse(ran({ exitCode: 1, stdout }))).toEqual({
      decision: "ask",
      reason: "pushing needs a person",
      updatedInput: { command: "git push --dry-run" },
      additionalContext: "the branch is protected",
    });
  });

  it.each(["allow", "deny", "ask", "defer"] as const)("reads permissionDecision %s", (decision) => {
    expect(parsePreToolUse(ran({ stdout: json({ hookSpecificOutput: { permissionDecision: decision } }) })).decision).toBe(decision);
  });

  it("reads the deprecated top-level decision", () => {
    expect(parsePreToolUse(ran({ stdout: json({ decision: "approve" }) })).decision).toBe("allow");
    expect(parsePreToolUse(ran({ stdout: json({ decision: "block", reason: "no" }) }))).toEqual({ decision: "deny", reason: "no" });
  });

  it("makes no decision on a plain exit 0, unknown JSON or a decision it does not know", () => {
    expect(parsePreToolUse(ran({ stdout: "all good" }))).toEqual({});
    expect(parsePreToolUse(ran({ stdout: json({ hookSpecificOutput: { permissionDecision: "maybe" } }) }))).toEqual({});
    expect(parsePreToolUse(ran({ stdout: "{not json}" }))).toEqual({});
    expect(parsePreToolUse(ran({ stdout: "[1]" }))).toEqual({});
  });

  it("records a failure as an error with no decision", () => {
    expect(parsePreToolUse(ran({ exitCode: 1, stderr: "boom" })).error).toBe("the command exited 1: boom");
    expect(parsePreToolUse(ran({ exitCode: null, timedOut: true })).error).toBe("the command timed out");
    expect(parsePreToolUse(ran({ exitCode: null, spawnError: "ENOENT" })).error).toBe("the command did not start: ENOENT");
    expect(parsePreToolUse(ran({ exitCode: null })).error).toBe("the command was stopped");
  });

  it("caps the text a hook hands the model", () => {
    const long = "x".repeat(HOOK_TEXT_CAP + 50);
    const answer = parsePreToolUse(ran({ stdout: json({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: long } }) }));
    expect(answer.reason).toHaveLength(HOOK_TEXT_CAP);
  });

  it("ignores updatedToolOutput and continue:false", () => {
    const stdout = json({ continue: false, hookSpecificOutput: { permissionDecision: "allow", updatedToolOutput: "x" } });
    expect(parsePreToolUse(ran({ stdout }))).toEqual({ decision: "allow" });
  });
});

describe("parsePostToolUse", () => {
  it("reads a block with its reason, and context", () => {
    const stdout = json({
      decision: "block",
      reason: "the output names a secret",
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "redact it" },
    });
    expect(parsePostToolUse(ran({ stdout }))).toEqual({ blockReason: "the output names a secret", additionalContext: "redact it" });
  });

  it("exit 2 feeds stderr back", () => {
    expect(parsePostToolUse(ran({ exitCode: 2, stderr: "lint failed" }))).toEqual({ blockReason: "lint failed" });
    expect(parsePostToolUse(ran({ exitCode: 2 })).blockReason).toBe("A hook flagged this result.");
  });

  it("a block with no reason still says so", () => {
    expect(parsePostToolUse(ran({ stdout: json({ decision: "block" }) })).blockReason).toBe("A hook flagged this result.");
  });

  it("makes nothing of a plain exit, and records a failure", () => {
    expect(parsePostToolUse(ran({}))).toEqual({});
    expect(parsePostToolUse(ran({ exitCode: 3 })).error).toBe("the command exited 3");
    expect(parsePostToolUse(ran({ exitCode: null, timedOut: true })).error).toBe("the command timed out");
  });
});
