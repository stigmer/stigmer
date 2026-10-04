/**
 * Pins the native turn's check of an agent's tool lists (`turn-setup.ts`):
 *  - what "the turn has it" means (`turnToolInventory`): the built-ins it
 *    binds, in Claude's names, and each connected server's live tools — the
 *    platform's own servers left out, since no list can name them;
 *  - whose lists are checked (`checkTurnToolLists`): the agent's, and each
 *    declared sub-agent's that the agent's `Agent(type, …)` admits — one it
 *    keeps from compiling can never run, so its lists never refuse the turn.
 */

import { describe, expect, it, vi } from "vitest";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
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

  it("leaves the platform's servers out: no list can name them", () => {
    const inventory = turnToolInventory([], tools({ "stigmer-channels": ["send"] }), new Set(["stigmer-channels"]));
    expect(inventory.anyMcp).toBe(false);
    expect(inventory.hasMcp("stigmer-channels", "send")).toBe(false);
  });
});

describe("checkTurnToolLists", () => {
  const unresolvable = create(SubAgentSchema, { name: "reviewer", tools: ["NoSuchTool"] });

  function check(agentTools: string[]): () => void {
    const input = {
      mcp: { platformServerSlugs: new Set<string>() },
      blueprint: { subAgents: [unresolvable] },
    } as unknown as Parameters<typeof checkTurnToolLists>[0];
    const scope = ToolScope.of('Agent "a"', { tools: agentTools, disallowedTools: [] });
    return () => checkTurnToolLists(input, tools({}), scope, true);
  }

  it("does not refuse the turn over a sub-agent the agent's Agent(type, …) keeps from compiling", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(check(["Read", "Agent(explore)"])).not.toThrow();
  });

  it("still refuses the turn over an admitted sub-agent whose tools name nothing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(check(["Read", "Agent(reviewer)"])).toThrow(ToolListResolutionError);
    expect(check(["Read", "Agent(reviewer)"])).toThrow(/Sub-agent "reviewer"/);
  });
});
