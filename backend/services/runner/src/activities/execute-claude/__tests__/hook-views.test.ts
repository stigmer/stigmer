/**
 * Pins how hooks see a Claude call, in both formats (`hook-views.ts`):
 *  - to a Claude Code hook a call is itself, the host's shell `Bash`, an MCP
 *    tool `mcp__<server>__<tool>` with its server as the native views show
 *    it, the platform's servers never shown;
 *  - to a Cursor hook a call is what Cursor's own engine sends a hook (a
 *    command `Shell` with its directory, a create and an edit `Write`, a
 *    search `Grep` with `file_path`, a glob `Grep` with an empty pattern),
 *    and a tool Cursor has no name for has no view;
 *  - every view's inverse restores the call, in either format, and a
 *    rewrite this engine cannot take is answered with why.
 *
 * Why it matters: a hook written for Claude Code or for Cursor must match
 * a Claude call as it would on its own engine, or its policy silently does
 * not apply; and a rewrite taken back wrong would run a call nobody wrote.
 */

import { describe, expect, it } from "vitest";

import type { HookFormatName } from "../../../shared/hooks/hook-set.js";
import { hookServerNamesOf } from "../../../shared/hooks/tool-view.js";
import { CLAUDE_VIEWED_TOOLS, ClaudeToolViews } from "../hook-views.js";

const ROOT = "/work/repo";
const views = new ClaudeToolViews({
  workspaceRoot: ROOT,
  serverNames: hookServerNamesOf([
    { slug: "plugin_safety_checks", connectionType: "http", home: { kind: "plugin", pluginId: "plg_s", plugin: "safety", server: "checks" } },
    { slug: "zendesk", connectionType: "http", home: { kind: "agent", agentId: "agt_helper", subagent: null, server: "zendesk" } },
  ]),
  platformServerSlugs: new Set(["channel"]),
});

/** One representative call per tool a view exists for. */
const CALLS: Record<string, Record<string, unknown>> = {
  Read: { file_path: `${ROOT}/src/a.ts`, offset: 10, limit: 20 },
  Write: { file_path: `${ROOT}/notes.md`, content: "hi" },
  Edit: { file_path: `${ROOT}/src/a.ts`, old_string: "a", new_string: "b", replace_all: true },
  NotebookEdit: { notebook_path: `${ROOT}/n.ipynb`, new_source: "x" },
  Glob: { pattern: "**/*.ts", path: `${ROOT}/src` },
  Grep: { pattern: "TODO", path: ROOT, glob: "*.ts", output_mode: "content" },
  Bash: { command: "git push origin main", description: "Push", timeout: 60_000 },
  TodoWrite: { todos: [{ content: "a", status: "pending", activeForm: "a" }] },
  Agent: { description: "Find the bug", prompt: "look", subagent_type: "explore" },
  Skill: { skill: "agent:review" },
  ToolSearch: { query: "select:mcp__zendesk__search" },
  StructuredOutput: { answer: 42 },
};

const call = (name: string, args: Record<string, unknown> = CALLS[name]!, serverSlug = "") => ({ name, args, serverSlug });

describe("the Claude views", () => {
  it.each(CLAUDE_VIEWED_TOOLS["claude-code"])("%s: a Claude Code hook sees the call itself, and its inverse restores it", (name) => {
    const view = views.viewsOf(call(name))["claude-code"];
    expect(view).toEqual({ toolName: name, toolInput: CALLS[name] });
    expect(views.argsFrom(call(name), "claude-code", view!.toolInput)).toEqual(CALLS[name]);
  });

  it.each(CLAUDE_VIEWED_TOOLS.cursor)("%s: a Cursor hook's view, taken back with nothing changed, restores the call", (name) => {
    const view = views.viewsOf(call(name)).cursor;
    expect(view).toBeDefined();
    expect(views.argsFrom(call(name), "cursor", view!.toolInput)).toEqual(CALLS[name]);
  });

  it("names each call to a Cursor hook as Cursor's own engine does", () => {
    expect(views.viewsOf(call("Bash")).cursor).toEqual({ toolName: "Shell", toolInput: { ...CALLS.Bash, cwd: ROOT }, command: "git push origin main" });
    expect(views.viewsOf(call("Edit")).cursor?.toolName).toBe("Write");
    expect(views.viewsOf(call("Grep")).cursor).toEqual({ toolName: "Grep", toolInput: { pattern: "TODO", file_path: ROOT, glob: "*.ts", output_mode: "content" } });
    expect(views.viewsOf(call("Glob")).cursor).toEqual({ toolName: "Grep", toolInput: { pattern: "", glob: "**/*.ts", file_path: `${ROOT}/src`, output_mode: "files_with_matches" } });
    expect(views.viewsOf(call("Glob", { pattern: "*.md" })).cursor?.toolInput.file_path, "a glob with no path searches the workspace").toBe(ROOT);
    expect(views.viewsOf(call("Grep", { pattern: "x" })).cursor?.toolInput, "a search with no path names none").toEqual({ pattern: "x" });
    for (const name of ["NotebookEdit", "TodoWrite", "Agent", "Skill", "ToolSearch", "StructuredOutput"]) {
      expect(views.viewsOf(call(name)).cursor, name).toBeUndefined();
    }
    expect(views.viewsOf(call("WebFetch", { url: "x" })), "a tool no format names reaches no hook").toEqual({});
  });

  it("shows an MCP tool by Claude Code's name with its server, a plugin's as the plugin's, and never the platform's", () => {
    expect(views.viewsOf(call("run_check", { a: 1 }, "plugin_safety_checks"))).toEqual({
      "claude-code": { toolName: "mcp__plugin_safety_checks__run_check", toolInput: { a: 1 }, mcpServer: { name: "plugin:safety:checks", source: "plugin" } },
      cursor: { toolName: "MCP:run_check", toolInput: { a: 1 }, mcp: { tool: "run_check", server: "plugin_safety_checks" } },
    });
    expect(views.viewsOf(call("search", {}, "zendesk"))["claude-code"]?.mcpServer).toEqual({ name: "zendesk", source: "agent" });
    expect(views.viewsOf(call("send", {}, "channel"))).toEqual({});
  });

  it("takes a rewrite back: Claude Code's replaces the input, Cursor's is laid over the call", () => {
    const mcp = call("search", { q: "a", limit: 5 }, "zendesk");
    expect(views.argsFrom(mcp, "claude-code", { q: "b" })).toEqual({ q: "b" });
    expect(views.argsFrom(mcp, "cursor", { q: "b" })).toEqual({ q: "b", limit: 5 });
    expect(views.argsFrom(call("Bash"), "cursor", { command: "git push --dry-run" })).toEqual({ ...CALLS.Bash, command: "git push --dry-run" });
    expect(views.argsFrom(call("Grep"), "cursor", { file_path: `${ROOT}/lib` })).toEqual({ ...CALLS.Grep, path: `${ROOT}/lib` });
  });

  it.each<[string, HookFormatName, Record<string, unknown>, RegExp]>([
    ["Edit", "cursor", { content: "whole file" }, /rewrote content, which this harness's Edit does not take/],
    ["Write", "cursor", { old_string: "a", new_string: "b" }, /rewrote old_string, new_string, which this harness's Write does not take/],
    ["Bash", "cursor", { cwd: "/elsewhere" }, /moved the command to another directory/],
    ["Glob", "cursor", { pattern: "TODO" }, /a file listing a search pattern/],
  ])("refuses a rewrite of %s this engine cannot take, saying why", (name, format, rewrite, why) => {
    expect(views.argsFrom(call(name), format, rewrite)).toMatch(why);
  });
});
