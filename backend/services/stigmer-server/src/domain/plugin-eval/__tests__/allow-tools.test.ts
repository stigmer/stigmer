/**
 * Pins checkAllowTools (allow-tools.ts): every entry is kept as written,
 * since a turn names a plugin's MCP tools as Claude Code does
 * (`mcp__plugin_<plugin>_<server>__<tool>`); an entry naming one of the
 * eval's own plugin's servers passes, by the segment `toolServerSegment`
 * builds from the plugin's name, with a tool, a wildcard or neither; an
 * entry naming a server segment the plugin does not have (another
 * plugin's, or a server it lacks) is refused with the entry and the
 * segment; Claude tools, specifiers and non-plugin MCP names are never
 * read.
 */
import { describe, expect, it } from "vitest";

import { checkAllowTools } from "../allow-tools.js";

const plugin = { name: "Thermos", servers: ["github", "issue.tracker", "files"] };

describe("checkAllowTools", () => {
  it("keeps the plugin's own server names as written, by tool, wildcard or server", () => {
    const tools = [
      "mcp__plugin_Thermos_github__*",
      "mcp__plugin_Thermos_issue_tracker__create_issue",
      "mcp__plugin_Thermos_files",
    ];
    expect(checkAllowTools(tools, plugin)).toEqual({ ok: true, tools });
  });

  it("keeps Claude tools, specifiers and non-plugin MCP names as written", () => {
    const tools = ["Write", "Bash(npm test *)", "mcp__github__*", "mcp__*"];
    expect(checkAllowTools(tools, plugin)).toEqual({ ok: true, tools });
  });

  it("refuses an entry naming another plugin's server", () => {
    expect(
      checkAllowTools(["Read", "mcp__plugin_other_github__*"], plugin),
    ).toEqual({
      ok: false,
      entry: "mcp__plugin_other_github__*",
      server: "plugin_other_github",
    });
  });

  it("refuses a server the plugin does not have, and compares the segment whole", () => {
    // The plugin's name as written (`Thermos`) builds the segment; a
    // lowercased name is another plugin's.
    expect(checkAllowTools(["mcp__plugin_thermos_github"], plugin)).toEqual({
      ok: false,
      entry: "mcp__plugin_thermos_github",
      server: "plugin_thermos_github",
    });
    expect(checkAllowTools(["mcp__plugin_Thermos_jira__search"], plugin)).toEqual({
      ok: false,
      entry: "mcp__plugin_Thermos_jira__search",
      server: "plugin_Thermos_jira",
    });
  });

  it("refuses every plugin server entry when the plugin has none", () => {
    expect(
      checkAllowTools(["mcp__plugin_Thermos_github__*"], { name: "Thermos", servers: [] }),
    ).toMatchObject({ ok: false, server: "plugin_Thermos_github" });
  });
});
