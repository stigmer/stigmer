/**
 * Pins how a hook run's result is read, Claude Code's rule: exit 2 blocks
 * with stderr, JSON on stdout decides on any exit code, and anything else
 * (a plain exit 0, another code, a timeout, a command that did not start,
 * JSON that does not parse) makes no decision; text is capped. A decision
 * with no reason takes the hook's `systemMessage`; a `systemMessage` alone
 * decides nothing and is logged.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("takes the systemMessage as the reason of a decision that gives none", () => {
    // hookify's block, as its rule engine writes it.
    const stdout = json({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
      systemMessage: "**[block-dangerous-rm]**\nDangerous rm command detected!",
    });
    expect(parsePreToolUse(ran({ stdout }))).toEqual({
      decision: "deny",
      reason: "**[block-dangerous-rm]**\nDangerous rm command detected!",
    });
    expect(parsePreToolUse(ran({ stdout: json({ decision: "block", systemMessage: "legacy" }) }))).toEqual({
      decision: "deny",
      reason: "legacy",
    });
  });

  it("keeps the model's reason over the systemMessage, and logs the systemMessage", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stdout = json({
      hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "for the model" },
      systemMessage: "for the person",
    });
    expect(parsePreToolUse(ran({ stdout })).reason).toBe("for the model");
    expect(parsePreToolUse(ran({ stdout: json({ decision: "block", reason: "legacy reason", systemMessage: "x" }) })).reason).toBe("legacy reason");
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "[hooks] a hook's systemMessage is not shown: its decision gives its own reason: for the person",
      "[hooks] a hook's systemMessage is not shown: its decision gives its own reason: x",
    ]);
  });

  it("takes the systemMessage over a blank reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stdout = json({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: " " }, systemMessage: "why" });
    expect(parsePreToolUse(ran({ stdout }))).toEqual({ decision: "deny", reason: "why" });
    expect(parsePreToolUse(ran({ stdout: json({ decision: "block", reason: "", systemMessage: "legacy why" }) })).reason).toBe("legacy why");
    expect(parsePostToolUse(ran({ stdout: json({ decision: "block", reason: "", systemMessage: "post why" }) })).blockReason).toBe("post why");
    expect(warn).not.toHaveBeenCalled();
  });

  it("caps a systemMessage taken as the reason", () => {
    const stdout = json({ hookSpecificOutput: { permissionDecision: "deny" }, systemMessage: "x".repeat(HOOK_TEXT_CAP + 50) });
    expect(parsePreToolUse(ran({ stdout })).reason).toHaveLength(HOOK_TEXT_CAP);
  });

  it("decides nothing on a systemMessage alone, and logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // hookify's warn rule.
    expect(parsePreToolUse(ran({ stdout: json({ systemMessage: "console.log found" }) }))).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      "[hooks] a hook's systemMessage is not shown: a warning with no decision reaches no one here: console.log found",
    );
  });

  it("does not log a systemMessage it took as the reason", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parsePreToolUse(ran({ stdout: json({ hookSpecificOutput: { permissionDecision: "deny" }, systemMessage: "why" }) }));
    expect(warn).not.toHaveBeenCalled();
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

  it("a block with no reason takes the systemMessage; alone, it is logged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parsePostToolUse(ran({ stdout: json({ decision: "block", systemMessage: "tests failed" }) })).blockReason).toBe("tests failed");
    expect(warn).not.toHaveBeenCalled();
    expect(parsePostToolUse(ran({ stdout: json({ systemMessage: "heads up" }) }))).toEqual({});
    expect(warn).toHaveBeenCalledWith("[hooks] a hook's systemMessage is not shown: a warning with no decision reaches no one here: heads up");
    expect(parsePostToolUse(ran({ stdout: json({ decision: "block", reason: "lint failed", systemMessage: "see the log" }) })).blockReason).toBe("lint failed");
    expect(warn).toHaveBeenLastCalledWith("[hooks] a hook's systemMessage is not shown: its decision gives its own reason: see the log");
  });

  it("makes nothing of a plain exit, and records a failure", () => {
    expect(parsePostToolUse(ran({}))).toEqual({});
    expect(parsePostToolUse(ran({ exitCode: 3 })).error).toBe("the command exited 3");
    expect(parsePostToolUse(ran({ exitCode: null, timedOut: true })).error).toBe("the command timed out");
  });
});
