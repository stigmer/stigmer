/**
 * Pins the tool-list resolver (`shared/tool-lists.ts`), the one reading of an
 * agent's `tools` and `disallowed_tools` both engines enforce:
 *  - parsing: Claude's names, a specifier that governs the whole tool, the
 *    `Task` alias, `Agent(type, …)`, and the four MCP forms;
 *  - resolution: deny first, an empty `tools` means every tool, an
 *    allow-list is exact, a sub-agent narrows and never widens;
 *  - `Agent(type, …)`: case-insensitive, and ignored in a sub-agent's layer;
 *  - engine tools: the covering rule ("any allowed and none denied"), engine
 *    extras hidden only by an allow-list, `think` the platform's;
 *  - the run-time check: an entry naming nothing is logged, a list resolving
 *    to nothing (or fully denied by its own deny-list) throws;
 *  - the Cursor SDK options keep `read` and `mcp`.
 */

import { describe, it, expect } from "vitest";
import {
  CURSOR_SDK_EXTRA_TOOLS,
  CURSOR_SDK_TOOL_COVERS,
  NATIVE_TOOL_COVERS,
  ToolListResolutionError,
  ToolScope,
  checkToolListResolution,
  claudeToolsOf,
  cursorSdkToolOptions,
  outOfScopeMessage,
  parseToolListEntry,
  type ClaudeTool,
  type ToolLists,
  type TurnToolInventory,
} from "../tool-lists.js";

const AGENT = 'Agent "a"';
const lists = (tools: string[], disallowedTools: string[] = []): ToolLists => ({ tools, disallowedTools });
const scopeOf = (tools: string[], disallowedTools: string[] = []): ToolScope => ToolScope.of(AGENT, lists(tools, disallowedTools));

/** An inventory with the given Claude tools and MCP servers (server → its tools). */
function inventory(claudeTools: ClaudeTool[], servers: Record<string, string[]> = {}): TurnToolInventory {
  return {
    claudeTools: new Set(claudeTools),
    hasMcp: (server, tool) => server in servers && (tool === null || servers[server].includes(tool)),
    anyMcp: Object.keys(servers).length > 0,
  };
}

const ALL_BUILTINS: ClaudeTool[] = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "WebFetch", "TodoWrite"];

describe("parseToolListEntry", () => {
  it("parses a Claude tool name", () => {
    expect(parseToolListEntry("Read")).toEqual({ kind: "builtin", raw: "Read", tool: "Read", agentTypes: null });
  });

  it("accepts a specifier and lets it govern the whole tool", () => {
    expect(parseToolListEntry("Bash(git push *)")).toEqual({
      kind: "builtin",
      raw: "Bash(git push *)",
      tool: "Bash",
      agentTypes: null,
    });
    expect(scopeOf([], ["Bash(git push *)"]).allowsClaudeTool("Bash"), "a specifier still removes the whole tool").toBe(false);
  });

  it("reads Task as Claude's older spelling of Agent", () => {
    expect(parseToolListEntry("Task")).toMatchObject({ kind: "builtin", tool: "Agent" });
    expect(scopeOf(["Task"]).allowsClaudeTool("Agent")).toBe(true);
  });

  it("parses Agent's type list, trimmed and lower-cased", () => {
    expect(parseToolListEntry("Agent(Explore, Shell)")).toMatchObject({
      kind: "builtin",
      tool: "Agent",
      agentTypes: ["explore", "shell"],
    });
  });

  it("parses the four MCP forms", () => {
    expect(parseToolListEntry("mcp__*")).toMatchObject({ kind: "mcp", server: null, tool: null });
    expect(parseToolListEntry("mcp__github")).toMatchObject({ kind: "mcp", server: "github", tool: null });
    expect(parseToolListEntry("mcp__github__*")).toMatchObject({ kind: "mcp", server: "github", tool: null });
    expect(parseToolListEntry("mcp__github__create_issue")).toMatchObject({
      kind: "mcp",
      server: "github",
      tool: "create_issue",
    });
  });

  it("marks an unknown name, and an MCP entry with no slug or no tool, as unknown", () => {
    expect(parseToolListEntry("NoSuchTool").kind).toBe("unknown");
    expect(parseToolListEntry("mcp__").kind).toBe("unknown");
    expect(parseToolListEntry("mcp____x").kind).toBe("unknown");
    expect(parseToolListEntry("mcp__github__").kind).toBe("unknown");
  });
});

describe("ToolScope resolution", () => {
  it("an agent with no lists is unrestricted and needs no enforcement", () => {
    const scope = ToolScope.of(AGENT, lists([]));
    expect(scope.restricted).toBe(false);
    for (const t of ALL_BUILTINS) expect(scope.allowsClaudeTool(t), t).toBe(true);
    expect(scope.allowsMcpTool("github", "x")).toBe(true);
  });

  it("an empty tools list means every tool; disallowed_tools removes only what it names", () => {
    const scope = scopeOf([], ["Bash", "mcp__github__delete_repo"]);
    expect(scope.restricted).toBe(true);
    expect(scope.hasAllowList).toBe(false);
    expect(scope.allowsClaudeTool("Bash")).toBe(false);
    expect(scope.allowsClaudeTool("Write")).toBe(true);
    expect(scope.allowsMcpTool("github", "delete_repo")).toBe(false);
    expect(scope.allowsMcpTool("github", "search")).toBe(true);
  });

  it("an allow-list is exact: only what it names", () => {
    const scope = scopeOf(["Read", "Grep"]);
    expect(scope.allowsClaudeTool("Read")).toBe(true);
    expect(scope.allowsClaudeTool("Grep")).toBe(true);
    for (const t of ["Bash", "Write", "Edit", "Glob", "Agent", "WebFetch", "TodoWrite"] as const) {
      expect(scope.allowsClaudeTool(t), t).toBe(false);
    }
    expect(scope.allowsMcpTool("github", "search"), "no MCP entry, no MCP tool").toBe(false);
  });

  it("applies disallowed_tools first, then tools against what remains", () => {
    const scope = scopeOf(["Bash", "Read"], ["Bash"]);
    expect(scope.allowsClaudeTool("Bash")).toBe(false);
    expect(scope.allowsClaudeTool("Read")).toBe(true);
  });

  it("matches the MCP forms at their levels", () => {
    expect(scopeOf(["mcp__*"]).allowsMcpTool("any", "tool")).toBe(true);
    const server = scopeOf(["mcp__github"]);
    expect(server.allowsMcpTool("github", "a")).toBe(true);
    expect(server.allowsMcpTool("gitlab", "a")).toBe(false);
    expect(scopeOf(["mcp__github__*"]).allowsMcpTool("github", "a")).toBe(true);
    const tool = scopeOf(["mcp__github__search"]);
    expect(tool.allowsMcpTool("github", "search")).toBe(true);
    expect(tool.allowsMcpTool("github", "delete")).toBe(false);
    expect(scopeOf([], ["mcp__*"]).allowsMcpTool("github", "search"), "deny the whole family").toBe(false);
    expect(scopeOf([], ["mcp__github"]).allowsMcpTool("github", "search")).toBe(false);
    expect(scopeOf([], ["mcp__github"]).allowsMcpTool("gitlab", "search")).toBe(true);
  });

  it("answers whether some tool of a server can be in scope, a tool-level entry included", () => {
    expect(scopeOf(["mcp__github__search"]).allowsMcpFamily("github")).toBe(true);
    expect(scopeOf(["mcp__github__search"]).allowsMcpFamily("gitlab")).toBe(false);
    expect(scopeOf(["Read"]).allowsMcpFamily(null)).toBe(false);
    expect(scopeOf(["mcp__github"]).allowsMcpFamily(null)).toBe(true);
    expect(scopeOf([], ["mcp__github__delete"]).allowsMcpFamily("github"), "a tool-level deny leaves the rest").toBe(true);
    expect(scopeOf([], ["mcp__github"]).allowsMcpFamily("github")).toBe(false);
    expect(scopeOf([], ["mcp__*"]).allowsMcpFamily(null)).toBe(false);
  });

  it("a sub-agent narrows its parent and never widens it", () => {
    const parent = scopeOf(["Read", "Bash", "mcp__github"]);
    const narrowed = parent.narrow('Sub-agent "s"', lists(["Read"]));
    expect(narrowed.allowsClaudeTool("Read")).toBe(true);
    expect(narrowed.allowsClaudeTool("Bash")).toBe(false);
    expect(narrowed.allowsMcpTool("github", "x")).toBe(false);

    const widening = parent.narrow('Sub-agent "w"', lists(["Read", "Write", "mcp__*"]));
    expect(widening.allowsClaudeTool("Write"), "the parent excludes Write").toBe(false);
    expect(widening.allowsMcpTool("gitlab", "x"), "the parent excludes gitlab").toBe(false);
    expect(widening.allowsMcpTool("github", "x")).toBe(true);

    const denying = parent.narrow('Sub-agent "d"', lists([], ["Bash"]));
    expect(denying.allowsClaudeTool("Bash")).toBe(false);
    expect(denying.allowsClaudeTool("Read")).toBe(true);
  });

  it("a sub-agent with no lists is its parent's scope", () => {
    const parent = scopeOf(["Read"]);
    expect(parent.narrow('Sub-agent "s"', lists([]))).toBe(parent);
  });

  it("describes the lists in force, owner by owner, and names the newest owner", () => {
    const scope = scopeOf(["Read"], ["Bash"]).narrow('Sub-agent "s"', lists(["Read"]));
    expect(scope.describe()).toBe('Agent "a": tools [Read], disallowed_tools [Bash]; Sub-agent "s": tools [Read]');
    expect(scope.owner).toBe('Sub-agent "s"');
    expect(outOfScopeMessage("execute", scope)).toContain("execute is not available");
    expect(outOfScopeMessage("execute", scope)).toContain(scope.describe());
  });
});

describe("Agent(type, …)", () => {
  it("restricts the main agent's sub-agent types, case-insensitively", () => {
    const scope = scopeOf(["Read", "Agent(Explore, reviewer)"]);
    expect(scope.allowsSubAgentType("explore")).toBe(true);
    expect(scope.allowsSubAgentType("EXPLORE")).toBe(true);
    expect(scope.allowsSubAgentType("Reviewer")).toBe(true);
    expect(scope.allowsSubAgentType("general-purpose")).toBe(false);
  });

  it("Agent with no type list, or no allow-list, allows every type", () => {
    expect(scopeOf(["Agent"]).allowsSubAgentType("anything")).toBe(true);
    expect(scopeOf(["Agent(explore)", "Agent"]).allowsSubAgentType("anything")).toBe(true);
    expect(scopeOf([], ["Bash"]).allowsSubAgentType("anything")).toBe(true);
    expect(ToolScope.unrestricted().allowsSubAgentType("anything")).toBe(true);
  });

  it("no type is allowed when the lists exclude Agent", () => {
    expect(scopeOf(["Read"]).allowsSubAgentType("explore")).toBe(false);
    expect(scopeOf([], ["Agent"]).allowsSubAgentType("explore")).toBe(false);
  });

  it("ignores a type list in a sub-agent's layer, even when the main agent has no lists", () => {
    const sub = ToolScope.unrestricted().narrow('Sub-agent "s"', lists(["Read", "Agent(explore)"]));
    expect(sub.allowsSubAgentType("general-purpose")).toBe(true);
    const underParent = scopeOf(["Agent(reviewer)", "Read"]).narrow('Sub-agent "s"', lists(["Agent(explore)", "Read"]));
    expect(underParent.allowsSubAgentType("reviewer"), "the main agent's list still decides").toBe(true);
    expect(underParent.allowsSubAgentType("explore")).toBe(false);
  });
});

describe("engine tools", () => {
  it("an engine tool covering several Claude tools is available when any is allowed and none denied", () => {
    const edit = CURSOR_SDK_TOOL_COVERS.get("edit")!;
    expect(edit).toEqual(["Write", "Edit"]);
    expect(scopeOf(["Edit"]).allowsCovering(edit), "one covered tool allowed").toBe(true);
    expect(scopeOf(["Edit"], ["Write"]).allowsCovering(edit), "one covered tool denied closes it").toBe(false);
    expect(scopeOf([], ["Write"]).allowsCovering(edit)).toBe(false);
    expect(scopeOf(["Read"]).allowsCovering(edit), "none allowed").toBe(false);
  });

  it("native names map to Claude's: ls counts as Glob, delete as Write", () => {
    const scope = scopeOf(["Glob"]);
    expect(scope.allowsEngineTool("ls", NATIVE_TOOL_COVERS)).toBe(true);
    expect(scope.allowsEngineTool("glob", NATIVE_TOOL_COVERS)).toBe(true);
    expect(scope.allowsEngineTool("grep", NATIVE_TOOL_COVERS)).toBe(false);
    expect(scopeOf([], ["Write"]).allowsEngineTool("delete", NATIVE_TOOL_COVERS)).toBe(false);
    expect(scopeOf(["WebFetch"]).allowsEngineTool("web_fetch", NATIVE_TOOL_COVERS)).toBe(true);
  });

  it("an engine extra is hidden only by an allow-list", () => {
    expect(scopeOf(["Read"]).allowsEngineTool("readLints", CURSOR_SDK_TOOL_COVERS)).toBe(false);
    expect(scopeOf([], ["Bash"]).allowsEngineTool("readLints", CURSOR_SDK_TOOL_COVERS)).toBe(true);
    expect(scopeOf(["Read"]).allowsCovering([])).toBe(false);
  });

  it("think is the platform's: in scope under any list", () => {
    expect(scopeOf(["Read"]).allowsEngineTool("think", NATIVE_TOOL_COVERS)).toBe(true);
    expect(scopeOf([], ["Bash", "Read"]).allowsEngineTool("think", NATIVE_TOOL_COVERS)).toBe(true);
  });

  it("claudeToolsOf reads the Claude tools an engine binds", () => {
    expect([...claudeToolsOf(["read_file", "ls", "execute", "think"], NATIVE_TOOL_COVERS)].sort()).toEqual([
      "Bash",
      "Glob",
      "Read",
    ]);
  });
});

describe("checkToolListResolution", () => {
  const inv = inventory(ALL_BUILTINS, { github: ["search", "delete_repo"] });

  it("passes a list that names what the turn has", () => {
    const log: string[] = [];
    checkToolListResolution(scopeOf(["Read", "mcp__github__search"]), inv, (l) => log.push(l));
    expect(log).toEqual([]);
  });

  it("logs each entry naming nothing the turn has, once, and ignores it", () => {
    const log: string[] = [];
    checkToolListResolution(scopeOf(["Read", "NoSuchTool", "mcp__gitlab"], ["mcp__github__nope"]), inv, (l) => log.push(l));
    expect(log).toHaveLength(3);
    expect(log.join("\n")).toContain('"NoSuchTool"');
    expect(log.join("\n")).toContain('"mcp__gitlab"');
    expect(log.join("\n")).toContain('"mcp__github__nope"');
  });

  it("throws when a non-empty tools list resolves to nothing, naming the owner and its entries", () => {
    const run = (): void => checkToolListResolution(scopeOf(["NoSuchTool", "mcp__gitlab"]), inv, () => undefined);
    expect(run).toThrow(ToolListResolutionError);
    try {
      run();
    } catch (err) {
      const e = err as ToolListResolutionError;
      expect(e.owner).toBe(AGENT);
      expect(e.entries).toEqual(["NoSuchTool", "mcp__gitlab"]);
      expect(e.message).toContain(AGENT);
      expect(e.message).toContain("NoSuchTool, mcp__gitlab");
    }
  });

  it("throws when a list is fully denied by its own deny-list", () => {
    expect(() => checkToolListResolution(scopeOf(["Bash"], ["Bash"]), inv, () => undefined)).toThrow(
      ToolListResolutionError,
    );
  });

  it("an empty tools list never throws, whatever it denies", () => {
    expect(() => checkToolListResolution(scopeOf([], [...ALL_BUILTINS, "mcp__*"]), inv, () => undefined)).not.toThrow();
  });

  it("checks the newest layer: a sub-agent's list resolving only to tools its parent excludes throws", () => {
    const sub = scopeOf(["Read"]).narrow('Sub-agent "s"', lists(["Bash"]));
    expect(() => checkToolListResolution(sub, inv, () => undefined)).toThrow(/Sub-agent "s"/);
  });

  it("a sub-agent's server-level entry resolves through the parent's tool-level one", () => {
    const sub = scopeOf(["mcp__github__search"]).narrow('Sub-agent "s"', lists(["mcp__github"]));
    expect(() => checkToolListResolution(sub, inv, () => undefined)).not.toThrow();
  });

  it("mcp__* names something only when some server is attached", () => {
    expect(() => checkToolListResolution(scopeOf(["mcp__*"]), inventory(ALL_BUILTINS), () => undefined)).toThrow(
      ToolListResolutionError,
    );
    expect(() => checkToolListResolution(scopeOf(["mcp__*"]), inv, () => undefined)).not.toThrow();
  });
});

describe("cursorSdkToolOptions", () => {
  it("passes nothing for an unrestricted scope", () => {
    expect(cursorSdkToolOptions(ToolScope.unrestricted(), true)).toEqual({});
  });

  it("an allow-list keeps read and mcp, and leaves the engine extras out", () => {
    const { tools, disallowedTools } = cursorSdkToolOptions(scopeOf(["Grep", "mcp__github"]), true);
    expect(disallowedTools).toBeUndefined();
    expect(tools).toContain("read");
    expect(tools).toContain("mcp");
    expect(tools).toContain("grep");
    expect(tools).toContain("semSearch");
    expect(tools).not.toContain("shell");
    for (const extra of CURSOR_SDK_EXTRA_TOOLS) expect(tools, extra).not.toContain(extra);
  });

  it("keeps read even when the lists exclude Read, and mcp only when a server is attached", () => {
    expect(cursorSdkToolOptions(scopeOf(["Grep"]), false).tools).toEqual(["read", "grep", "semSearch"]);
    const deny = cursorSdkToolOptions(scopeOf([], ["Read", "Write"]), true);
    expect(deny.disallowedTools).not.toContain("read");
    expect(deny.disallowedTools).toEqual(expect.arrayContaining(["edit", "delete"]));
    expect(deny.tools).toBeUndefined();
  });
});
