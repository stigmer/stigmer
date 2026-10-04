/**
 * Pins what the native turn counts as "the turn has it" when it checks an
 * agent's tool lists (`turn-setup.ts` `turnToolInventory`): the built-ins it
 * binds, in Claude's names, and each connected server's live tools — the
 * platform's own servers left out, since no list can name them.
 */

import { describe, expect, it } from "vitest";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { turnToolInventory, type DeepAgentTools } from "../turn-setup.js";

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
