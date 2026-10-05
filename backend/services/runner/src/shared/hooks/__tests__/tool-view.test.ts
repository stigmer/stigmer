/**
 * Pins how hooks see a native call, in both formats (`tool-view.ts`):
 *  - every tool the native engine binds has exactly one Claude Code view, and
 *    a view's inverse restores the call (view-then-inverse is the identity),
 *    in either format;
 *  - Cursor's view names a call as Cursor's own engine sends it to a hook
 *    (a create and an edit are `Write`, a glob and a listing are `Grep` with
 *    an empty pattern), a rewrite is laid over the call's own arguments as
 *    Cursor lays it, and a rewrite this engine cannot take is refused;
 *  - paths become real and absolute, names change only where Claude's
 *    differ, extra arguments ride along;
 *  - MCP tools are named `mcp__<server>__<tool>`, a plugin's own server as
 *    Claude names it, and the platform's own servers are never shown;
 *  - `tool_response` takes Claude's shape where it can be derived.
 */

import { describe, expect, it } from "vitest";
import { EXCLUDED_BUILTIN_TOOLS } from "../../../activities/execute-deep-agent/deepagents-profiles.js";
import { normalizeWorkspacePathArg } from "../../../middleware/path-normalization.js";
import { NATIVE_TOOL_COVERS } from "../../tool-lists.js";
import type { HookFormatName } from "../hook-set.js";
import { claudeToolResponse, NATIVE_VIEWED_TOOLS, NativeToolViews } from "../tool-view.js";

const ROOT = "/work/repo";
const SERVERS = new Map([
  ["create_issue", "github"],
  ["run_check", "safety-checks"],
  ["send_message", "channel"],
]);
const views = new NativeToolViews({
  workspaceRoot: ROOT,
  toVirtualPath: (path) => normalizeWorkspacePathArg(path, ROOT),
  toolServerMap: SERVERS,
  pluginServers: new Map([["safety-checks", { plugin: "safety", server: "checks" }]]),
  platformServerSlugs: new Set(["channel"]),
});

/** A hook's rewrite of a call to `name`, back in the engine's shape (or why not). */
function back(name: string, input: Record<string, unknown>, format: HookFormatName = "claude-code"): Record<string, unknown> | string {
  return views.argsFrom({ name, args: {}, serverSlug: SERVERS.get(name) ?? "" }, format, input);
}

/** One representative call per bound native tool. */
const CALLS: Record<string, Record<string, unknown>> = {
  execute: { command: "git push origin main", intent: "Push the branch" },
  read_file: { file_path: "/src/a.ts", offset: 10, limit: 20 },
  write_file: { file_path: "/notes.md", content: "hi" },
  edit_file: { file_path: "/src/a.ts", old_string: "a", new_string: "b", replace_all: true },
  glob: { pattern: "**/*.ts", path: "/src" },
  grep: { pattern: "TODO", path: "/", glob: "*.ts", output_mode: "content" },
  ls: { path: "/src" },
  task: { description: "Find the bug", subagent_type: "explore" },
  write_todos: { todos: [{ content: "a", status: "pending" }] },
  web_fetch: { url: "https://example.com", max_length: 1000, start_index: 0 },
};

describe("the native views", () => {
  const bound = [...NATIVE_TOOL_COVERS.keys()].filter((name) => !EXCLUDED_BUILTIN_TOOLS.includes(name));

  it("cover exactly the tools the native engine binds", () => {
    expect([...NATIVE_VIEWED_TOOLS["claude-code"]].sort()).toEqual([...bound].sort());
  });

  it.each(bound)("%s: its view's inverse restores the call", (name) => {
    const args = CALLS[name];
    expect(args, `a representative ${name} call`).toBeDefined();
    const view = views.viewOf(name, args!);
    expect(view).toBeDefined();
    expect(back(name, view!.toolInput)).toEqual(args);
  });

  it("names each call as Claude does, with real absolute paths", () => {
    expect(views.viewOf("execute", CALLS["execute"]!)).toEqual({
      toolName: "Bash",
      toolInput: { command: "git push origin main", intent: "Push the branch" },
    });
    expect(views.viewOf("read_file", CALLS["read_file"]!)?.toolInput).toEqual({ file_path: "/work/repo/src/a.ts", offset: 10, limit: 20 });
    expect(views.viewOf("grep", CALLS["grep"]!)?.toolInput["path"]).toBe(ROOT);
    expect(views.viewOf("ls", CALLS["ls"]!)).toEqual({ toolName: "Glob", toolInput: { pattern: "*", path: "/work/repo/src" } });
    expect(views.viewOf("task", CALLS["task"]!)).toEqual({
      toolName: "Agent",
      toolInput: { prompt: "Find the bug", description: "Find the bug", subagent_type: "explore" },
    });
    expect(views.viewOf("write_todos", CALLS["write_todos"]!)?.toolName).toBe("TodoWrite");
    expect(views.viewOf("web_fetch", CALLS["web_fetch"]!)?.toolName).toBe("WebFetch");
  });

  it("maps a hook's rewritten path, real or relative, back to the engine's", () => {
    expect(back("read_file", { file_path: "docs/x.md" })).toEqual({ file_path: "/docs/x.md" });
    expect(back("read_file", { file_path: "./docs/../x.md" })).toEqual({ file_path: "/x.md" });
    expect(back("write_file", { file_path: "/work/repo/docs/x.md", content: "y" })).toEqual({
      file_path: "/docs/x.md",
      content: "y",
    });
    expect(back("task", { prompt: "New task", description: "old", subagent_type: "explore" })).toEqual({
      description: "New task",
      subagent_type: "explore",
    });
  });

  it("leaves a path that is not absolute as written", () => {
    expect(views.viewOf("read_file", { file_path: "../outside" })?.toolInput["file_path"]).toBe("../outside");
  });
});

describe("MCP and platform tools", () => {
  it("names an organisation's server's tool as managed", () => {
    expect(views.viewOf("create_issue", { title: "x" })).toEqual({
      toolName: "mcp__github__create_issue",
      toolInput: { title: "x" },
      mcpServer: { name: "github", source: "managed" },
    });
  });

  it("names a plugin's own server as Claude Code does", () => {
    expect(views.viewOf("run_check", {})).toEqual({
      toolName: "mcp__plugin_safety_checks__run_check",
      toolInput: {},
      mcpServer: { name: "plugin:safety:checks", source: "plugin" },
    });
  });

  it("shows no hook the platform's own tools, or a tool it has no name for", () => {
    expect(views.viewOf("send_message", {})).toBeUndefined();
    expect(views.viewOf("think", { thought: "x" })).toBeUndefined();
  });

  it("passes an MCP tool's rewritten input through", () => {
    expect(back("create_issue", { title: "y" })).toEqual({ title: "y" });
  });
});

describe("Cursor's view of a native call", () => {
  const cursorOf = (name: string): ReturnType<NativeToolViews["viewsOf"]>["cursor"] =>
    views.viewsOf({ name, args: CALLS[name]!, serverSlug: SERVERS.get(name) ?? "" }).cursor;

  it.each(NATIVE_VIEWED_TOOLS.cursor.filter((name) => name !== "execute"))("%s: its view's inverse restores the call", (name) => {
    const view = cursorOf(name);
    expect(view).toBeDefined();
    expect(back(name, view!.toolInput, "cursor")).toEqual(CALLS[name]);
  });

  it("names each call as Cursor's engine does", () => {
    expect(cursorOf("execute")).toEqual({
      toolName: "Shell",
      toolInput: { command: "git push origin main", intent: "Push the branch", cwd: ROOT },
      command: "git push origin main",
    });
    expect(cursorOf("write_file")?.toolName).toBe("Write");
    expect(cursorOf("edit_file")).toEqual({
      toolName: "Write",
      toolInput: { file_path: "/work/repo/src/a.ts", old_string: "a", new_string: "b", replace_all: true },
    });
    expect(cursorOf("grep")?.toolInput).toEqual({ pattern: "TODO", file_path: ROOT, glob: "*.ts", output_mode: "content" });
    expect(cursorOf("glob")).toEqual({
      toolName: "Grep",
      toolInput: { pattern: "", glob: "**/*.ts", file_path: "/work/repo/src", output_mode: "files_with_matches" },
    });
    expect(cursorOf("ls")?.toolInput).toEqual({ pattern: "", glob: "*", file_path: "/work/repo/src", output_mode: "files_with_matches" });
  });

  it("shows Cursor's hooks no delegation or todo list, as Cursor's engine does, and the always-bound web fetch as WebFetch", () => {
    expect([cursorOf("task"), cursorOf("write_todos")]).toEqual([undefined, undefined]);
    expect(cursorOf("web_fetch"), "Cursor's engine hides it from a hook that would take it; here it is bound, so the hook sees it").toEqual({
      toolName: "WebFetch",
      toolInput: CALLS["web_fetch"],
    });
  });

  it("names an MCP call as Cursor does on each event", () => {
    expect(views.viewsOf({ name: "create_issue", args: { title: "x" }, serverSlug: "github" }).cursor).toEqual({
      toolName: "MCP:create_issue",
      toolInput: { title: "x" },
      mcp: { tool: "create_issue", server: "github" },
    });
    expect(views.viewsOf({ name: "send_message", args: {}, serverSlug: "channel" })).toEqual({});
  });

  it("shows a grep with no path as one, and takes it back without one", () => {
    const view = views.viewsOf({ name: "grep", args: { pattern: "x" }, serverSlug: "" }).cursor;
    expect(view?.toolInput).toEqual({ pattern: "x" });
    expect(back("grep", view!.toolInput, "cursor")).toEqual({ pattern: "x" });
  });

  it("takes back a shell rewrite in the workspace, and refuses one that moves the command", () => {
    expect(back("execute", { command: "ls", cwd: ROOT }, "cursor")).toEqual({ command: "ls" });
    const partial = (name: string, rewrite: Record<string, unknown>) =>
      views.argsFrom({ name, args: CALLS[name]!, serverSlug: "" }, "cursor", rewrite);
    expect(partial("edit_file", { file_path: `${ROOT}/src/b.ts` }), "a Cursor rewrite names only what it changes").toEqual({ ...CALLS["edit_file"], file_path: "/src/b.ts" });
    expect(partial("execute", { command: "ls" })).toEqual({ ...CALLS["execute"], command: "ls" });
    const issue = { title: "a", body: "b" };
    expect(views.argsFrom({ name: "create_issue", args: issue, serverSlug: "github" }, "cursor", { title: "c" }), "an MCP call's too").toEqual({ title: "c", body: "b" });
    expect(views.argsFrom({ name: "create_issue", args: issue, serverSlug: "github" }, "claude-code", { title: "c" })).toEqual({ title: "c" });
    expect(views.argsFrom({ name: "edit_file", args: CALLS["edit_file"]!, serverSlug: "" }, "claude-code", { file_path: `${ROOT}/src/b.ts` }), "Claude Code's replaces the input").toEqual({ file_path: "/src/b.ts" });
    expect(back("execute", { command: "ls", cwd: "/elsewhere" }, "cursor")).toMatch(/another directory/);
    expect(back("glob", { pattern: "x", glob: "*.md", file_path: ROOT }, "cursor")).toMatch(/search pattern/);
    expect(back("ls", { pattern: "", glob: "*.md", file_path: ROOT }, "cursor")).toMatch(/takes no glob|cannot take/);
  });
});

describe("claudeToolResponse", () => {
  it("shapes each tool's result as Claude does where it can", () => {
    expect(claudeToolResponse({ toolName: "Bash", toolInput: {} }, "out")).toEqual({
      stdout: "out",
      stderr: "",
      interrupted: false,
      isImage: false,
    });
    expect(claudeToolResponse({ toolName: "Write", toolInput: { file_path: "/w/a" } }, "ok")).toEqual({ filePath: "/w/a", output: "ok" });
    expect(claudeToolResponse({ toolName: "mcp__s__t", toolInput: {}, mcpServer: { name: "s", source: "managed" } }, "r")).toEqual([
      { type: "text", text: "r" },
    ]);
    expect(claudeToolResponse({ toolName: "Glob", toolInput: {} }, "a\nb")).toBe("a\nb");
  });
});
