/**
 * The agent's tool scope compiled for the Cursor hook (`hook-scope.ts`, over
 * `ToolScope.mcpTable` / `subAgentTypeTable` in `shared/tool-lists.ts`).
 *
 * The hook only looks names up in these tables, so the one property that
 * matters is equality: for every list shape here, a table lookup answers what
 * `ToolScope` answers, for named, discovered, undiscovered and unknown
 * servers, tools and sub-agent types alike. Also pinned: platform servers
 * stay in scope, the table carries only Cursor's own built-ins, refusal keys
 * agree across Cursor's two taxonomies, and an agent with no lists compiles
 * to the inert scope.
 */

import { describe, expect, it } from "vitest";
import {
  CURSOR_HOOK_TOOL_COVERS,
  CURSOR_SDK_TOOL_COVERS,
  ToolScope,
  type McpScopeTable,
  type SubAgentTypeTable,
  type ToolLists,
} from "../../../shared/tool-lists.js";
import { compileHookToolScope, scopeKey, TOOL_NAME_PLACEHOLDER, UNRESTRICTED_HOOK_SCOPE } from "../hook-scope.js";

/** The hook's lookup, as the generated script performs it. */
function lookupMcp(table: McpScopeTable, server: string, tool: string): boolean {
  const s = Object.prototype.hasOwnProperty.call(table.servers, server) ? table.servers[server] : undefined;
  if (!s) return table.otherServers;
  return Object.prototype.hasOwnProperty.call(s.tools, tool) ? s.tools[tool] : s.otherTools;
}

function lookupType(table: SubAgentTypeTable, type: string): boolean {
  const t = type.toLowerCase();
  return Object.prototype.hasOwnProperty.call(table.types, t) ? table.types[t] : table.otherTypes;
}

const LISTS: Record<string, ToolLists> = {
  none: { tools: [], disallowedTools: [] },
  allowServer: { tools: ["Read", "mcp__github"], disallowedTools: [] },
  allowTool: { tools: ["mcp__github__list_prs", "mcp__undiscovered__ping"], disallowedTools: [] },
  allowFamily: { tools: ["mcp__*"], disallowedTools: ["mcp__github__merge_pr"] },
  denyServer: { tools: [], disallowedTools: ["mcp__slack"] },
  denyAll: { tools: [], disallowedTools: ["mcp__*"] },
  allowWildcard: { tools: ["mcp__github__*", "Agent(researcher, Explore)"], disallowedTools: [] },
  agentBare: { tools: ["Agent"], disallowedTools: [] },
  agentDenied: { tools: [], disallowedTools: ["Agent"] },
  proto: { tools: ["mcp____proto__", "mcp__constructor__toString"], disallowedTools: [] },
};

const KNOWN = new Map<string, readonly string[]>([
  ["github", ["list_prs", "merge_pr"]],
  ["slack", ["post"]],
  ["undiscovered", []],
]);

const SERVERS = ["github", "slack", "undiscovered", "elsewhere", "__proto__", "constructor"];
const TOOLS = ["list_prs", "merge_pr", "post", "ping", "brand_new", "__proto__", "toString"];
const TYPES = ["researcher", "Explore", "writer", "generalPurpose", "constructor"];

describe("ToolScope tables equal ToolScope's own answers", () => {
  for (const [name, lists] of Object.entries(LISTS)) {
    it(`mcpTable — ${name}`, () => {
      const scope = ToolScope.of('Agent "a"', lists);
      const table = scope.mcpTable(KNOWN);
      for (const server of SERVERS) {
        for (const tool of TOOLS) {
          expect(lookupMcp(table, server, tool), `${server}/${tool}`).toBe(scope.allowsMcpTool(server, tool));
        }
      }
    });

    it(`subAgentTypeTable — ${name}`, () => {
      const scope = ToolScope.of('Agent "a"', lists);
      const table = scope.subAgentTypeTable(["researcher", "writer"]);
      for (const type of TYPES) expect(lookupType(table, type), type).toBe(scope.allowsSubAgentType(type));
    });
  }

  it("a sub-agent layer's own Agent(…) type list is ignored, as in Claude", () => {
    const scope = ToolScope.of('Agent "a"', { tools: ["Agent(researcher)"], disallowedTools: [] }).narrow('Sub-agent "s"', {
      tools: ["Agent(writer)"],
      disallowedTools: [],
    });
    const table = scope.subAgentTypeTable([]);
    for (const type of TYPES) expect(lookupType(table, type), type).toBe(scope.allowsSubAgentType(type));
  });
});

describe("compileHookToolScope", () => {
  const servers = [
    { slug: "github", discoveredToolNames: ["list_prs", "merge_pr"] },
    { slug: "stigmer-memory", discoveredToolNames: ["remember"] },
  ];

  it("compiles an agent with no lists to the inert scope", () => {
    expect(
      compileHookToolScope({
        scope: ToolScope.unrestricted(),
        servers,
        platformServerSlugs: new Set(["stigmer-memory"]),
        readRoot: "/platform",
        subAgentTypes: ["researcher"],
      }),
    ).toEqual(UNRESTRICTED_HOOK_SCOPE);
  });

  it("answers each hook built-in by its own name, keeps the platform's servers in scope, and carries the refusal template", () => {
    const scope = ToolScope.of('Agent "support"', { tools: ["Read", "mcp__github__list_prs"], disallowedTools: [] });
    const compiled = compileHookToolScope({
      scope,
      servers,
      platformServerSlugs: new Set(["stigmer-memory"]),
      readRoot: "/platform",
      subAgentTypes: [],
    });
    expect(compiled.restricted).toBe(true);
    expect(compiled.builtins.Read.allowed).toBe(true);
    expect(compiled.builtins.Shell.allowed).toBe(false);
    expect(compiled.builtins.Write.allowed).toBe(false);
    expect(Object.keys(compiled.builtins).sort(), "only Cursor's own built-ins").toEqual([...CURSOR_HOOK_TOOL_COVERS.keys()].sort());
    expect(compiled.otherBuiltins, "an allow-list hides engine extras").toBe(false);
    expect(compiled.mcp.servers.github.tools).toEqual({ list_prs: true, merge_pr: false });
    expect(compiled.mcp.servers["stigmer-memory"]).toEqual({ tools: {}, otherTools: true });
    expect(compiled.readRoot).toBe("/platform");
    expect(compiled.refusal).toContain(`${TOOL_NAME_PLACEHOLDER} is not available to this agent`);
    expect(compiled.refusal).toContain('Agent "support": tools [Read, mcp__github__list_prs]');
  });

  it("a deny-list leaves engine extras alone", () => {
    const compiled = compileHookToolScope({
      scope: ToolScope.of('Agent "a"', { tools: [], disallowedTools: ["Bash"] }),
      servers: [],
      platformServerSlugs: new Set(),
      readRoot: "",
      subAgentTypes: [],
    });
    expect(compiled.otherBuiltins).toBe(true);
    expect(compiled.builtins.Shell.allowed).toBe(false);
    expect(compiled.builtins.Read.allowed).toBe(true);
  });
});

describe("scopeKey agrees across Cursor's hook and stream taxonomies", () => {
  const PAIRS: Array<[hook: string, stream: string]> = [
    ["Shell", "shell"],
    ["Read", "read"],
    ["Write", "edit"],
    ["StrReplace", "edit"],
    ["Delete", "delete"],
    ["Glob", "glob"],
    ["Grep", "grep"],
    ["SemanticSearch", "semSearch"],
    ["Task", "task"],
    ["WebFetch", "webFetch"],
    ["WebSearch", "webSearch"],
    ["updateTodos", "updateTodos"],
  ];
  for (const [hook, stream] of PAIRS) {
    it(`${hook} ≡ ${stream}`, () => {
      expect(scopeKey(hook, CURSOR_HOOK_TOOL_COVERS)).toBe(scopeKey(stream, CURSOR_SDK_TOOL_COVERS));
    });
  }
});
