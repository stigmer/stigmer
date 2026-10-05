/**
 * Pins Claude Code's view of a native call (`tool-view.ts`):
 *  - every tool the native engine binds has exactly one view, and a view's
 *    inverse restores the call (view-then-inverse is the identity);
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
import { claudeToolResponse, NATIVE_VIEWED_TOOLS, NativeToolViews } from "../tool-view.js";

const ROOT = "/work/repo";
const views = new NativeToolViews({
  workspaceRoot: ROOT,
  toVirtualPath: (path) => normalizeWorkspacePathArg(path, ROOT),
  toolServerMap: new Map([
    ["create_issue", "github"],
    ["run_check", "safety-checks"],
    ["send_message", "channel"],
  ]),
  pluginServers: new Map([["safety-checks", { plugin: "safety", server: "checks" }]]),
  platformServerSlugs: new Set(["channel"]),
});

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
    expect([...NATIVE_VIEWED_TOOLS].sort()).toEqual([...bound].sort());
  });

  it.each(bound)("%s: its view's inverse restores the call", (name) => {
    const args = CALLS[name];
    expect(args, `a representative ${name} call`).toBeDefined();
    const view = views.viewOf(name, args!);
    expect(view).toBeDefined();
    expect(views.nativeArgsOf(name, view!.toolInput)).toEqual(args);
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
    expect(views.nativeArgsOf("read_file", { file_path: "docs/x.md" })).toEqual({ file_path: "/docs/x.md" });
    expect(views.nativeArgsOf("read_file", { file_path: "./docs/../x.md" })).toEqual({ file_path: "/x.md" });
    expect(views.nativeArgsOf("write_file", { file_path: "/work/repo/docs/x.md", content: "y" })).toEqual({
      file_path: "/docs/x.md",
      content: "y",
    });
    expect(views.nativeArgsOf("task", { prompt: "New task", description: "old", subagent_type: "explore" })).toEqual({
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
    expect(views.nativeArgsOf("create_issue", { title: "y" })).toEqual({ title: "y" });
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
