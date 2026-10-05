/**
 * Pins how an agent's hooks see a call on the Cursor engine (`hook-views.ts`)
 * and the tools the turn hides for them (`hook-tool-hiding.ts`):
 *  - Cursor's view is the payload as Cursor sent it; Claude Code's names each
 *    call as `@cursor/sdk` 1.0.31 sends it (a create or an edit is `Write`,
 *    also matched as `Edit`; a listing is `Glob`; a deletion is a `Write` of
 *    nothing), and a tool Claude has no name for reaches no Claude hook;
 *  - a rewrite is taken back to the payload and allowed only where Cursor's
 *    engine applies it; a new content, an MCP rewrite, or a view built from
 *    another tool is refused with a sentence;
 *  - a row's name is the stream's;
 *  - web fetch and web search are hidden when any PreToolUse hook would take
 *    them, the sub-agent tool only when a matcher names it.
 */

import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { describe, expect, it, vi } from "vitest";
import { HookSet, type HookFormatName } from "../../../shared/hooks/hook-set.js";
import { toolsHiddenByHooks, withToolsHidden } from "../hook-tool-hiding.js";
import { CursorEngineToolViews, rowNameOf } from "../hook-views.js";

const views = new CursorEngineToolViews({
  workspaceRoot: "/w",
  pluginServers: new Map([["safety-checks", { plugin: "safety", server: "checks" }]]),
  platformServerSlugs: new Set(["channel"]),
});
const call = (name: string, args: Record<string, unknown>, serverSlug = "") => ({ name, args, serverSlug });

describe("Claude Code's view of a Cursor call", () => {
  it("names each built-in as Claude does", () => {
    expect(views.viewsOf(call("Shell", { command: "ls", cwd: "", timeout: 30000 }))["claude-code"]).toEqual({
      toolName: "Bash",
      toolInput: { command: "ls", timeout: 30000 },
    });
    expect(views.viewsOf(call("Read", { file_path: "/w/a" }))["claude-code"]).toEqual({ toolName: "Read", toolInput: { file_path: "/w/a" } });
    expect(views.viewsOf(call("Write", { file_path: "/w/a", content: "x" }))["claude-code"]).toEqual({
      toolName: "Write",
      toolInput: { file_path: "/w/a", content: "x" },
      aliases: ["Edit"],
    });
    expect(views.viewsOf(call("Delete", { file_path: "/w/.env" }))["claude-code"]).toEqual({
      toolName: "Write",
      toolInput: { file_path: "/w/.env", content: "" },
    });
    expect(views.viewsOf(call("Grep", { pattern: "", glob: "**/*.md", file_path: "/w", output_mode: "files_with_matches" }))["claude-code"]).toEqual({
      toolName: "Glob",
      toolInput: { pattern: "**/*.md", path: "/w" },
    });
    expect(views.viewsOf(call("Grep", { pattern: "TODO", file_path: "/w" }))["claude-code"]).toEqual({
      toolName: "Grep",
      toolInput: { pattern: "TODO", path: "/w" },
    });
  });

  it("gives a tool Claude has no name for no Claude view, and logs it once", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const typed = views.viewsOf(call("WriteShellStdin", { shell_id: 1, chars_length: 3 }));
    views.viewsOf(call("WriteShellStdin", { shell_id: 1, chars_length: 3 }));
    expect(typed["claude-code"]).toBeUndefined();
    expect(typed.cursor).toEqual({ toolName: "WriteShellStdin", toolInput: { shell_id: 1, chars_length: 3 } });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("names MCP tools by server, a plugin's own server as Claude Code does, and shows the platform's to no hook", () => {
    expect(views.viewsOf(call("search", { q: "a" }, "github"))).toEqual({
      "claude-code": { toolName: "mcp__github__search", toolInput: { q: "a" }, mcpServer: { name: "github", source: "managed" } },
      cursor: { toolName: "MCP:search", toolInput: { q: "a" }, mcp: { tool: "search", server: "github" } },
    });
    expect(views.viewsOf(call("run_check", {}, "safety-checks"))["claude-code"]?.toolName).toBe("mcp__plugin_safety_checks__run_check");
    expect(views.viewsOf(call("send", {}, "channel"))).toEqual({});
  });

  it("gives Cursor's hooks the payload, and a shell call its command", () => {
    expect(views.viewsOf(call("Shell", { command: "ls" })).cursor).toEqual({ toolName: "Shell", toolInput: { command: "ls" }, command: "ls" });
  });
});

describe("a rewrite on the Cursor engine", () => {
  const back = (name: string, args: Record<string, unknown>, format: HookFormatName, input: Record<string, unknown>, serverSlug = "") =>
    views.argsFrom(call(name, args, serverSlug), format, input);

  it("takes back what Cursor's engine applies, in either format", () => {
    expect(back("Shell", { command: "ls", cwd: "", timeout: 30000 }, "claude-code", { command: "ls -a" })).toEqual({ command: "ls -a", cwd: "", timeout: 30000 });
    expect(back("Shell", { command: "ls" }, "cursor", { command: "pwd", cwd: "/w/sub" })).toEqual({ command: "pwd", cwd: "/w/sub" });
    expect(back("Read", { file_path: "/w/a" }, "claude-code", { file_path: "b" }), "a relative path is the workspace's").toEqual({ file_path: "/w/b" });
    expect(back("Write", { file_path: "/w/a", content: "x" }, "claude-code", { file_path: "/w/b", content: "x" })).toEqual({ file_path: "/w/b", content: "x" });
    expect(back("Grep", { pattern: "", glob: "*.md", file_path: "/w" }, "claude-code", { pattern: "*.md", path: "/w/docs" })).toEqual({
      pattern: "",
      glob: "*.md",
      file_path: "/w/docs",
    });
    expect(back("Grep", { pattern: "a", file_path: "/w" }, "claude-code", { pattern: "b", path: "/w" })).toEqual({ pattern: "b", file_path: "/w" });
  });

  it("refuses what Cursor's engine would drop, naming it", () => {
    expect(back("Write", { file_path: "/w/a", content: "x" }, "claude-code", { file_path: "/w/a", content: "y" })).toBe(
      "Cursor's engine does not apply a rewrite of Write's content",
    );
    expect(back("Grep", { pattern: "", glob: "*.md", file_path: "/w" }, "claude-code", { pattern: "*.ts", path: "/w" })).toBe(
      "Cursor's engine does not apply a rewrite of Grep's glob",
    );
    expect(back("search", { q: "a" }, "claude-code", { q: "b" }, "github")).toBe("Cursor's engine applies no rewrite of an MCP call");
    expect(back("Delete", { file_path: "/w/a" }, "claude-code", { file_path: "/w/b", content: "" })).toMatch(/as another tool/);
    expect(back("WriteShellStdin", { shell_id: 1 }, "cursor", { shell_id: 2 })).toBe("Cursor's engine does not apply a rewrite of WriteShellStdin's shell_id");
  });
});

describe("a row's name", () => {
  it("is the stream's name for the tool", () => {
    expect(rowNameOf(call("Shell", {}))).toBe("shell");
    expect(rowNameOf(call("Write", {}))).toBe("edit");
    expect(rowNameOf(call("Grep", { pattern: "", glob: "*" }))).toBe("glob");
    expect(rowNameOf(call("Grep", { pattern: "x" }))).toBe("grep");
    expect(rowNameOf(call("search", {}, "github"))).toBe("search");
  });
});

describe("the tools a turn hides for its hooks", () => {
  const set = (format: HookFormatName, event: string, matcher: string) =>
    HookSet.of([{
      source: { plugin: "p", root: "", data: "", options: new Map() },
      format,
      groups: [create(HookGroupSchema, { event, matcher, handlers: [create(HookHandlerSchema, { command: "x" })] })],
    }]);

  it("hides web fetch and web search from any PreToolUse hook that takes them, match-all included", () => {
    expect(toolsHiddenByHooks(set("claude-code", "PreToolUse", "WebFetch"))).toEqual(["webFetch"]);
    expect(toolsHiddenByHooks(set("claude-code", "PreToolUse", ""))).toEqual(["webFetch", "webSearch"]);
    expect(toolsHiddenByHooks(set("cursor", "preToolUse", "Fetch"))).toEqual(["webFetch"]);
    expect(toolsHiddenByHooks(set("claude-code", "PreToolUse", "Bash"))).toEqual([]);
    expect(toolsHiddenByHooks(set("claude-code", "PostToolUse", ""))).toEqual([]);
  });

  it("hides the sub-agent tool only when a matcher names it", () => {
    expect(toolsHiddenByHooks(set("claude-code", "PreToolUse", "Agent"))).toEqual(["task"]);
    expect(toolsHiddenByHooks(set("cursor", "preToolUse", "^Task$"))).toEqual(["task"]);
    expect(toolsHiddenByHooks(set("cursor", "preToolUse", ".*"))).toEqual(["webFetch", "webSearch"]);
  });

  it("puts hidden tools on the deny-list, and takes them off an allow-list too", () => {
    expect(withToolsHidden({ tools: ["read", "webFetch", "shell"] }, ["webFetch"]), "the deny-list is what reaches sub-agents").toEqual({
      tools: ["read", "shell"],
      disallowedTools: ["webFetch"],
    });
    expect(withToolsHidden({ disallowedTools: ["shell"] }, ["webFetch"])).toEqual({ disallowedTools: ["shell", "webFetch"] });
    expect(withToolsHidden({}, ["webSearch"])).toEqual({ disallowedTools: ["webSearch"] });
    expect(withToolsHidden({ tools: ["read"] }, [])).toEqual({ tools: ["read"] });
  });
});
