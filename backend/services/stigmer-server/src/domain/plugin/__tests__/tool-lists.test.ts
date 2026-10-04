/**
 * Pins the tool-list rewrite and check: a plugin's own servers from
 * Claude's `mcp__plugin_<plugin>_<server>` prefix to the materialised
 * slug (whole server, `__*`, `__<tool>`, matched on the prefix's boundary,
 * names normalised by Claude's character rule), plugin-scoped agent types
 * in `Agent(...)` and `Task(...)` to bare names, everything else byte for
 * byte, and the check run by the shared validator against the contract's
 * own rule.
 */
import { describe, expect, it } from "vitest";

import type { PluginMcpServer } from "@stigmer/plugin-package";

import {
  checkToolList,
  isStorableEntry,
  rewriteToolListEntry,
} from "../materialize/tool-lists.js";
import type { ToolListScope } from "../materialize/tool-lists.js";

const server = (name: string): PluginMcpServer => ({
  name,
  transport: "stdio",
  command: "npx",
  args: [],
  env: [],
});

const SCOPE: ToolListScope = {
  pluginName: "acme.tools",
  servers: [server("db"), server("db_tools"), server("My Server")],
  agentNames: new Set(["explore", "verify"]),
};

describe("rewriteToolListEntry", () => {
  it.each([
    ["mcp__plugin_acme_tools_db", "mcp__db"],
    ["mcp__plugin_acme_tools_db__*", "mcp__db__*"],
    ["mcp__plugin_acme_tools_db__query", "mcp__db__query"],
    ["mcp__plugin_acme_tools_db_tools__query", "mcp__dbtools__query"],
    ["mcp__plugin_acme_tools_My_Server__list", "mcp__my-server__list"],
    ["Agent(acme.tools:explore, acme.tools:verify)", "Agent(explore, verify)"],
    ["Task(acme.tools:explore)", "Task(explore)"],
  ])("rewrites %s to %s", (entry, expected) => {
    expect(rewriteToolListEntry(entry, SCOPE)).toBe(expected);
  });

  it.each([
    "mcp__plugin_acme_tools_dbx__query",
    "mcp__plugin_other_db__query",
    "mcp__db__query",
    "Agent(other:explore)",
    "Agent(acme.tools:unknown,explore)",
    "Workflow(acme.tools:scan)",
    "Bash(git push:*)",
  ])("keeps %s byte for byte", (entry) => {
    expect(rewriteToolListEntry(entry, SCOPE)).toBe(entry);
  });
});

describe("isStorableEntry", () => {
  it.each([
    "Read",
    "LS",
    "Bash(git push:*)",
    "mcp__github__*",
    "mcp__dbtools__query",
    "mcp__*",
    "Agent(explore, verify)",
  ])("accepts %s", (entry) => {
    expect(isStorableEntry(entry, "tools")).toBe(true);
    expect(isStorableEntry(entry, "disallowedTools")).toBe(true);
  });

  it.each([
    "mcp__claude_ai_Slack__post",
    "mcp__plugin_db_tools__query",
    "read_file",
    "mcp__",
    "Agent(a(b))",
  ])("refuses %s", (entry) => {
    expect(isStorableEntry(entry, "tools")).toBe(false);
  });
});

describe("checkToolList", () => {
  it("keeps what can be stored, drops the rest, and says when a non-empty list emptied", () => {
    expect(
      checkToolList(["Read", "mcp__claude_ai_Slack__post"], "tools", SCOPE),
    ).toEqual({
      entries: ["Read"],
      dropped: ["mcp__claude_ai_Slack__post"],
      emptied: false,
    });
    expect(checkToolList(["read_file"], "tools", SCOPE).emptied).toBe(true);
    expect(checkToolList([], "tools", SCOPE)).toEqual({
      entries: [],
      dropped: [],
      emptied: false,
    });
  });
});
