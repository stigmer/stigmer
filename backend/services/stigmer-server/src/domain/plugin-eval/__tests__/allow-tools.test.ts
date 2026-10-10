/**
 * Pins stigmerAllowTools (allow-tools.ts): Claude Code's plugin MCP names
 * of the eval's own plugin become Stigmer's server slugs, by the plugin's
 * name or slug, with a tool, a wildcard or neither; every other entry is
 * kept as written; an entry naming another plugin is refused.
 */
import { describe, expect, it } from "vitest";

import { stigmerAllowTools } from "../allow-tools.js";

const plugin = { name: "Thermos", slug: "thermos" };

describe("stigmerAllowTools", () => {
  it("rewrites the plugin's own MCP names to the server slugs install gives", () => {
    const outcome = stigmerAllowTools(
      ["mcp__plugin_thermos_github__*", "mcp__plugin_Thermos_Issue.Tracker__create_issue", "mcp__plugin_thermos_files"],
      plugin,
    );
    expect(outcome).toEqual({
      ok: true,
      tools: ["mcp__github__*", "mcp__issue-tracker__create_issue", "mcp__files"],
    });
  });

  it("keeps Claude tools, specifiers and Stigmer MCP names as written", () => {
    const tools = ["Write", "Bash(npm test *)", "mcp__github__*", "mcp__*"];
    expect(stigmerAllowTools(tools, plugin)).toEqual({ ok: true, tools });
  });

  it("refuses an entry naming another plugin", () => {
    expect(stigmerAllowTools(["mcp__plugin_other_github__*"], plugin)).toEqual({
      ok: false,
      entry: "mcp__plugin_other_github__*",
      plugin: "other",
    });
  });
});
