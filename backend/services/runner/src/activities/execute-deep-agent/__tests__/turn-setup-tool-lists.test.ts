/**
 * Pins the native turn's check of an agent's tool lists (`turn-setup.ts`):
 *  - what "the turn has it" means (`turnToolInventory`): the built-ins it
 *    binds, in Claude's names, and each connected server's live tools — the
 *    platform's own servers left out, since no list can name them;
 *  - whose lists are checked (`checkTurnToolLists`): the agent's, against
 *    its own servers' tools only, and each plugin and saved subagent's that
 *    the agent's `Agent(type, …)` admits — one it keeps from compiling can
 *    never run, so its lists never refuse the turn;
 *  - that a plugin subagent's lists are judged against its agent's lists
 *    alone: a turn's narrower lists never refuse the turn over it, and still
 *    narrow what it may use;
 *  - that a saved subagent's own lists are judged against its own servers
 *    alone, never the parent's lists or the parent's servers.
 */

import { describe, expect, it, vi } from "vitest";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { mainToolScope } from "../../../harness/turn-context.js";
import type { TurnSubagent } from "../../../harness/types.js";
import type { PluginSubagent, ResolvedBlueprint } from "../../../shared/blueprint-resolver.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { pluginSubagentScope, savedSubagentScope } from "../../../shared/subagents.js";
import { ToolListResolutionError, ToolScope } from "../../../shared/tool-lists.js";
import { checkTurnToolLists, turnToolInventory, type DeepAgentTools } from "../turn-setup.js";

const tool = (name: string) => ({ name }) as unknown as DynamicStructuredTool;

function tools(servers: Record<string, string[]>): DeepAgentTools {
  const serverToolMap = new Map(Object.entries(servers).map(([slug, names]) => [slug, names.map(tool)]));
  return { connection: undefined, mcpTools: [...serverToolMap.values()].flat(), serverToolMap, toolServerMap: new Map() };
}

describe("turnToolInventory", () => {
  it("names the bound built-ins in Claude's names", () => {
    const inventory = turnToolInventory(["read_file", "ls", "execute"], tools({}), new Set());
    expect([...inventory.claudeTools].sort()).toEqual(["Bash", "Glob", "Read"]);
    expect(inventory.anyMcp).toBe(false);
  });

  it("names each connected server and its live tools", () => {
    const inventory = turnToolInventory([], tools({ github: ["search", "delete_repo"] }), new Set());
    expect(inventory.anyMcp).toBe(true);
    expect(inventory.hasMcp("github", null)).toBe(true);
    expect(inventory.hasMcp("github", "search")).toBe(true);
    expect(inventory.hasMcp("github", "nope")).toBe(false);
    expect(inventory.hasMcp("gitlab", null)).toBe(false);
  });

  it("names only the servers a graph binds, when told which", () => {
    const inventory = turnToolInventory([], tools({ github: ["search"], plugin_changelog_api: ["write"] }), new Set(), [{ slug: "plugin_changelog_api" }]);
    expect(inventory.hasMcp("plugin_changelog_api", "write")).toBe(true);
    expect(inventory.hasMcp("github", null)).toBe(false);
  });

  it("leaves the platform's servers out: no list can name them", () => {
    const inventory = turnToolInventory([], tools({ "stigmer-channels": ["send"] }), new Set(["stigmer-channels"]));
    expect(inventory.anyMcp).toBe(false);
    expect(inventory.hasMcp("stigmer-channels", "send")).toBe(false);
  });
});

const pluginAgent = (name: string, agentTools: string[]): PluginSubagent => ({
  name,
  description: "",
  instructions: "",
  tools: agentTools,
  disallowedTools: [],
  model: "",
});

const server = (slug: string): ResolvedMcpServer => ({ slug, connectionType: "http", url: `https://${slug}.example/mcp`, pluginOrigin: null });

function savedSubagent(name: string, agentTools: string[], servers: ResolvedMcpServer[]): TurnSubagent {
  return {
    name,
    description: "",
    instructions: "",
    model: undefined,
    toolScope: savedSubagentScope(name, create(AgentSpecSchema, { tools: agentTools }), undefined),
    servers,
    skills: [],
    hooks: [],
    values: {},
    bringsOwn: { plugins: servers.length > 0, hooks: false, lists: agentTools.length > 0 },
  };
}

type CheckInput = Parameters<typeof checkTurnToolLists>[0];

function inputOf(parts: { pluginAgents?: PluginSubagent[]; subagents?: TurnSubagent[]; servers?: ResolvedMcpServer[]; agent?: ResolvedBlueprint["agent"] }): CheckInput {
  return {
    mcp: { platformServerSlugs: new Set<string>(), servers: parts.servers ?? [] },
    blueprint: { agent: parts.agent, pluginAgents: parts.pluginAgents ?? [] },
    subagents: parts.subagents ?? [],
  } as unknown as CheckInput;
}

describe("checkTurnToolLists", () => {
  const unresolvable = pluginAgent("kit:reviewer", ["NoSuchTool"]);

  function check(agentTools: string[]): () => void {
    const scope = ToolScope.of('Agent "a"', { tools: agentTools, disallowedTools: [] });
    return () => checkTurnToolLists(inputOf({ pluginAgents: [unresolvable] }), tools({}), scope, true);
  }

  it("does not refuse the turn over a plugin subagent the agent's Agent(type, …) keeps from compiling", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(check(["Read", "Agent(explore)"])).not.toThrow();
  });

  it("still refuses the turn over an admitted plugin subagent whose tools name nothing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(check(["Read", "Agent(kit:reviewer)"])).toThrow(ToolListResolutionError);
    expect(check(["Read", "Agent(kit:reviewer)"])).toThrow(/Sub-agent "kit:reviewer"/);
  });

  it("judges the main agent's lists against its own servers, never a server only a subagent has", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scope = ToolScope.of('Agent "a"', { tools: ["mcp__plugin_changelog_api"], disallowedTools: [] });
    const connected = tools({ github: ["search"], plugin_changelog_api: ["write"] });
    const input = inputOf({ servers: [server("github")], subagents: [savedSubagent("release-notes", [], [server("plugin_changelog_api")])] });
    expect(() => checkTurnToolLists(input, connected, scope, true)).toThrow(/Agent "a"/);
  });
});

describe("checkTurnToolLists for a saved subagent", () => {
  const connected = tools({ github: ["search"], plugin_changelog_api: ["write"] });

  it("judges its own lists against its own servers: a tool of its own plugin resolves", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = inputOf({
      servers: [server("github")],
      subagents: [savedSubagent("release-notes", ["mcp__plugin_changelog_api__write"], [server("plugin_changelog_api")])],
    });
    expect(() => checkTurnToolLists(input, connected, ToolScope.unrestricted(), true)).not.toThrow();
  });

  it("refuses the turn when its list names only the parent's server, which its graph does not bind", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = inputOf({ servers: [server("github")], subagents: [savedSubagent("release-notes", ["mcp__github__search"], [])] });
    expect(() => checkTurnToolLists(input, connected, ToolScope.unrestricted(), true)).toThrow(/Subagent "release-notes"/);
  });

  it("is judged without the parent's lists: a tool the parent denies still resolves for it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parent = ToolScope.of('Agent "a"', { tools: ["Read", "Agent"], disallowedTools: ["Bash"] });
    const input = inputOf({ subagents: [savedSubagent("release-notes", ["Bash"], [])] });
    expect(() => checkTurnToolLists(input, tools({}), parent, true)).not.toThrow();
  });

  it("is not checked when the agent's Agent(type, …) keeps it from compiling", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parent = ToolScope.of('Agent "a"', { tools: ["Read", "Agent(explore)"], disallowedTools: [] });
    const input = inputOf({ subagents: [savedSubagent("release-notes", ["NoSuchTool"], [])] });
    expect(() => checkTurnToolLists(input, tools({}), parent, true)).not.toThrow();
  });
});

describe("checkTurnToolLists with a turn layer", () => {
  const writer = pluginAgent("kit:writer", ["Bash", "Write"]);

  function turn(agentTools: string[] | undefined, turnTools: string[]): { check: () => void; parentScope: ToolScope } {
    const agent = agentTools === undefined ? undefined : { id: "agt", versionHash: "", spec: create(AgentSpecSchema, { tools: agentTools }) };
    const blueprint = { agent, pluginAgents: [writer] } as unknown as ResolvedBlueprint;
    const parentScope = mainToolScope(blueprint, create(RunSpecSchema, { tools: turnTools }));
    const input = inputOf({ agent, pluginAgents: [writer] });
    return { check: () => checkTurnToolLists(input, tools({}), parentScope, true), parentScope };
  }

  it.each([
    ["the assistant", undefined],
    ["an agent with lists", ["Read", "Bash", "Write", "Agent"]],
  ])("starts the turn when a plugin subagent of %s lists only tools the turn narrows away, and it still has none of them", (_, agentTools) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const turnTools of [["Read"], ["Read", "Agent"]]) {
      const { check, parentScope } = turn(agentTools, turnTools);
      expect(check).not.toThrow();
      const runtime = pluginSubagentScope(parentScope, writer);
      expect(runtime.allowsClaudeTool("Bash")).toBe(false);
      expect(runtime.allowsClaudeTool("Write")).toBe(false);
    }
  });

  it("still refuses the turn over a plugin subagent whose list resolves to nothing under its agent's own lists", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(turn(["Read", "Agent"], ["Read", "Agent"]).check).toThrow(/Sub-agent "kit:writer"/);
  });
});
