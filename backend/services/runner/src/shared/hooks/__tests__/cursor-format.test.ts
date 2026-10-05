/**
 * Pins Cursor's hook format as this runner runs it (`formats/cursor.ts`):
 *  - the events a call fires and what each event's matcher is tested against;
 *  - Cursor's matcher rule (`""` and `*` take everything, else an unanchored
 *    regular expression; one that does not compile takes nothing);
 *  - stdin per event, and the environment and command substitution;
 *  - the answers: exit 2, `permission`, Claude Code's shape accepted, and the
 *    failure rules (`fail_closed`, output that is not JSON).
 */

import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_DEFAULT_TIMEOUT_SECONDS,
  cursorCommand,
  cursorEnv,
  cursorMatches,
  cursorPostEvents,
  cursorPreEvents,
  cursorStdin,
  parseCursorPost,
  parseCursorPre,
} from "../formats/cursor.js";
import type { FormatContext } from "../formats/common.js";
import type { HookRunResult } from "../run.js";
import type { CursorToolView } from "../tool-view.js";

const ctx: FormatContext = {
  sessionId: "ses_1",
  executionId: "aex_1",
  model: "composer-2.5",
  workspaceRoot: "/w",
  permissionMode: "default",
  baseEnv: { PATH: "/bin" },
};
const SHELL: CursorToolView = { toolName: "Shell", toolInput: { command: "rm -rf x", cwd: "/w" }, command: "rm -rf x" };
const MCP: CursorToolView = { toolName: "MCP:search", toolInput: { q: "a" }, mcp: { tool: "search", server: "github" } };
const READ: CursorToolView = { toolName: "Read", toolInput: { file_path: "/w/a" } };

const ran = (result: Partial<HookRunResult>): HookRunResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...result });

describe("the events a call fires", () => {
  it("fires preToolUse for every call, plus beforeShellExecution or beforeMCPExecution", () => {
    expect(cursorPreEvents(READ)).toEqual([{ event: "preToolUse", target: "Read" }]);
    expect(cursorPreEvents(SHELL)).toEqual([
      { event: "preToolUse", target: "Shell" },
      { event: "beforeShellExecution", target: "rm -rf x" },
    ]);
    expect(cursorPreEvents(MCP)).toEqual([
      { event: "preToolUse", target: "MCP:search" },
      { event: "beforeMCPExecution", target: "MCP:search" },
    ]);
  });

  it("fires postToolUse after every call, plus afterMCPExecution after an MCP call", () => {
    expect(cursorPostEvents(SHELL)).toEqual([{ event: "postToolUse", target: "Shell" }]);
    expect(cursorPostEvents(MCP).map((e) => e.event)).toEqual(["postToolUse", "afterMCPExecution"]);
  });
});

describe("Cursor's matcher rule", () => {
  it("takes everything for an empty matcher or *, else tests an unanchored regular expression", () => {
    expect([cursorMatches("", "Shell"), cursorMatches("*", "Shell")]).toEqual([true, true]);
    expect([cursorMatches("Shell", "Shell"), cursorMatches("^rm ", "rm -rf x"), cursorMatches("^ls", "rm -rf x")]).toEqual([true, true, false]);
    expect(cursorMatches("MCP:sea", "MCP:search"), "unanchored").toBe(true);
  });

  it("takes nothing for a matcher that does not compile", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cursorMatches("(", "Shell")).toBe(false);
    warn.mockRestore();
  });
});

describe("stdin per event", () => {
  const common = {
    conversation_id: "ses_1",
    session_id: "ses_1",
    generation_id: "aex_1",
    model: "composer-2.5",
    workspace_roots: ["/w"],
    transcript_path: null,
  };

  it("carries Cursor's common fields and each event's own", () => {
    expect(cursorStdin("preToolUse", SHELL, "call_1", ctx)).toEqual({
      ...common,
      hook_event_name: "preToolUse",
      tool_name: "Shell",
      tool_input: SHELL.toolInput,
      tool_use_id: "call_1",
      cwd: "/w",
    });
    expect(cursorStdin("beforeShellExecution", SHELL, "call_1", ctx)).toEqual({
      ...common,
      hook_event_name: "beforeShellExecution",
      command: "rm -rf x",
      cwd: "/w",
    });
    expect(cursorStdin("beforeMCPExecution", MCP, "call_1", ctx)).toEqual({
      ...common,
      hook_event_name: "beforeMCPExecution",
      tool_name: "search",
      tool_input: '{"q":"a"}',
      mcp_server_name: "github",
    });
  });

  it("hands a post event the result as JSON strings", () => {
    expect(cursorStdin("postToolUse", SHELL, "call_1", ctx, "out")).toMatchObject({ tool_output: '{"output":"out"}', tool_use_id: "call_1" });
    expect(cursorStdin("postToolUse", MCP, "call_1", ctx, "found")).toMatchObject({
      tool_output: '{"content":[{"type":"text","text":"found"}],"isError":false}',
    });
    expect(cursorStdin("afterMCPExecution", MCP, "call_1", ctx, "found")).toMatchObject({
      tool_name: "search",
      mcp_server_name: "github",
      result_json: '{"content":[{"type":"text","text":"found"}],"isError":false}',
    });
  });
});

describe("environment and command", () => {
  const plugin = { plugin: "guard", root: "/p", data: "/d", options: new Map<string, string>() };
  const own = { plugin: "", root: "", data: "", options: new Map<string, string>() };

  it("sets Cursor's and Claude Code's path variables, a plugin's root only for a plugin", () => {
    expect(cursorEnv(plugin, ctx)).toEqual({
      PATH: "/bin",
      CURSOR_PROJECT_DIR: "/w",
      CLAUDE_PROJECT_DIR: "/w",
      CURSOR_PLUGIN_ROOT: "/p",
      CLAUDE_PLUGIN_ROOT: "/p",
      PLUGIN_ROOT: "/p",
      PYTHONDONTWRITEBYTECODE: "1",
    });
    expect(cursorEnv(own, ctx)).toEqual({ PATH: "/bin", CURSOR_PROJECT_DIR: "/w", CLAUDE_PROJECT_DIR: "/w" });
  });

  it("substitutes the path variables in the command, which always runs in a shell", () => {
    const handler = { command: "${CURSOR_PLUGIN_ROOT}/hooks/x ${CURSOR_PROJECT_DIR} ${CLAUDE_PLUGIN_ROOT}", failClosed: false };
    expect(cursorCommand(plugin, handler as never, ctx)).toEqual({ command: "/p/hooks/x /w /p", args: null });
    expect(CURSOR_DEFAULT_TIMEOUT_SECONDS).toBe(60);
  });
});

describe("a pre-execution answer", () => {
  const open = { failClosed: false };
  const closed = { failClosed: true };

  it("reads permission, the model's message first, the rewrite and the context", () => {
    expect(parseCursorPre(ran({ stdout: '{"permission":"deny","agent_message":"no","user_message":"nope"}' }), open)).toEqual({ decision: "deny", reason: "no" });
    expect(parseCursorPre(ran({ stdout: '{"permission":"ask","user_message":"why"}' }), open)).toEqual({ decision: "ask", reason: "why" });
    expect(parseCursorPre(ran({ stdout: '{"permission":"allow","updated_input":{"command":"ls"},"additional_context":"fyi"}' }), open)).toEqual({
      decision: "allow",
      updatedInput: { command: "ls" },
      additionalContext: "fyi",
    });
  });

  it("denies on exit 2 with what the hook printed, stdout first", () => {
    expect(parseCursorPre(ran({ exitCode: 2, stdout: "from stdout", stderr: "from stderr" }), open)).toEqual({ decision: "deny", reason: "from stdout" });
    expect(parseCursorPre(ran({ exitCode: 2, stderr: "from stderr" }), open)).toEqual({ decision: "deny", reason: "from stderr" });
    expect(parseCursorPre(ran({ exitCode: 2, stdout: '{"agent_message":"json reason"}' }), open)).toEqual({ decision: "deny", reason: "json reason" });
    expect(parseCursorPre(ran({ exitCode: 2 }), open).reason).toBe("A hook blocked this call.");
  });

  it("reads Claude Code's shape too, and decides nothing for an object with no permission", () => {
    expect(parseCursorPre(ran({ stdout: '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"c"}}' }), open)).toEqual({
      decision: "deny",
      reason: "c",
    });
    expect(parseCursorPre(ran({ stdout: '{"additional_context":"only context"}' }), open)).toEqual({ additionalContext: "only context" });
    expect(parseCursorPre(ran({ stdout: '{"continue":true}' }), open)).toEqual({});
  });

  it("refuses output that is not JSON, fail-closed or not", () => {
    expect(parseCursorPre(ran({ stdout: "nope" }), open)).toMatchObject({ decision: "deny", error: "the answer is not JSON" });
    expect(parseCursorPre(ran({ stdout: "{nope}" }), open)).toMatchObject({ decision: "deny", error: "the answer is not JSON" });
  });

  it("decides nothing on a failure unless the hook fails closed, which refuses", () => {
    const failures: Array<[Partial<HookRunResult>, string]> = [
      [{ exitCode: 1, stderr: "boom" }, "the command exited 1: boom"],
      [{ timedOut: true, exitCode: null }, "the command timed out"],
      [{ exitCode: null }, "the command was stopped"],
      [{ spawnError: "ENOENT", exitCode: null }, "the command did not start: ENOENT"],
      [{ stdout: "  " }, "the command printed no answer"],
    ];
    for (const [result, error] of failures) {
      expect(parseCursorPre(ran(result), open)).toEqual({ error });
      const refused = parseCursorPre(ran(result), closed);
      expect(refused.decision).toBe("deny");
      expect(refused.reason).toContain(error);
    }
  });
});

describe("a post-execution answer", () => {
  it("hands back the context, and decides and blocks nothing", () => {
    expect(parseCursorPost(ran({ stdout: '{"additional_context":"note"}' }))).toEqual({ additionalContext: "note" });
    expect(parseCursorPost(ran({ stdout: "{}" }))).toEqual({});
    expect(parseCursorPost(ran({ exitCode: 2, stderr: "x" }))).toEqual({});
    expect(parseCursorPost(ran({ exitCode: 3 }))).toEqual({ error: "the command exited 3" });
    expect(parseCursorPost(ran({ timedOut: true, exitCode: null }))).toEqual({ error: "the command timed out" });
  });
});
