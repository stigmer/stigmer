/**
 * Pins the tools listing workflows (workflows/list-plugin-tools.ts), both
 * registered under pinned names: each runs the listing activity once, passes
 * the plugin, the server's name, the attempt and its token through (absent
 * becomes null), and returns the wire shape the server reads — each tool's
 * name, description and camelCase `destructiveHint`, and nothing else. The
 * activity is mocked: its own behaviour is pinned in
 * `activities/__tests__/list-plugin-tools.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ListPluginToolsInput, ListPluginToolsOutput } from "../../activities/list-plugin-tools.js";
import { listPluginTools, listPluginToolsLegacy } from "../list-plugin-tools.js";
import type { ListPluginToolsWorkflowInput } from "../types.js";

const temporal = vi.hoisted(() => ({
  activity: vi.fn<(input: ListPluginToolsInput) => Promise<ListPluginToolsOutput>>(),
}));

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: vi.fn(() => ({ DiscoverMcpServerCapabilities: temporal.activity })),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const workflows = [
  ["stigmer/mcp-server/connect", listPluginTools],
  ["stigmer/mcp-server/discover", listPluginToolsLegacy],
] as const;

beforeEach(() => {
  temporal.activity.mockReset();
});

describe.each(workflows)("the %s workflow", (_name, workflow) => {
  it("runs the listing once with the input's ids and token, and returns each tool's name, description and destructiveHint only", async () => {
    // A field the activity might add later must not leak onto the wire.
    const extra = { name: "delete_repo", description: "Delete a repo", destructiveHint: true, inputSchema: { type: "object" } };
    temporal.activity.mockResolvedValue({
      tools: [{ name: "search", description: "Search code", destructiveHint: false }, extra],
    });
    const input: ListPluginToolsWorkflowInput = {
      plugin_id: "plg-1",
      server: "github",
      execution_context_id: "att-1",
      execution_context_token: "scoped-token",
    };

    const result = await workflow(input);

    expect(temporal.activity).toHaveBeenCalledTimes(1);
    expect(temporal.activity).toHaveBeenCalledWith({
      pluginId: "plg-1",
      server: "github",
      executionContextId: "att-1",
      executionContextToken: "scoped-token",
    });
    expect(result).toEqual({
      tools: [
        { name: "search", description: "Search code", destructiveHint: false },
        { name: "delete_repo", description: "Delete a repo", destructiveHint: true },
      ],
    });
    for (const tool of result.tools) expect(Object.keys(tool).sort()).toEqual(["description", "destructiveHint", "name"]);
  });

  it("passes an absent attempt and token as null", async () => {
    temporal.activity.mockResolvedValue({ tools: [] });
    await workflow({ plugin_id: "plg-1", server: "github" });
    expect(temporal.activity).toHaveBeenCalledWith({
      pluginId: "plg-1",
      server: "github",
      executionContextId: null,
      executionContextToken: null,
    });
  });

  it("propagates the listing's failure", async () => {
    temporal.activity.mockRejectedValue(new Error("MCP server 'plugin_x_github' did not complete MCP initialization"));
    await expect(workflow({ plugin_id: "plg-1", server: "github" })).rejects.toThrow("did not complete MCP initialization");
  });
});
