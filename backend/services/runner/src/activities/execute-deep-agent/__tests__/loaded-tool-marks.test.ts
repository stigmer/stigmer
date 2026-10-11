/**
 * Pins how the native engine completes the turn's approval default from the
 * tools it loaded (`turn-setup.ts`): `listingOfLoadedTools` reads each
 * tool's own MCP annotation as `@langchain/mcp-adapters` keeps it on the
 * tool's `metadata`, marking a tool destructive only for an explicit
 * `destructiveHint: true`, lists every plugin server's tool names, never
 * reads the platform's own servers, and leaves nothing unlisted (a server
 * that did not connect has no tools to call); `readGateState` builds the
 * gate's default from that listing and the turn's leases, so a leased
 * server's destructive tool is cleared and the runtime's lease-only default
 * is not what the gate reads.
 */

import { describe, expect, it } from "vitest";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { resolveToolApproval } from "../../../shared/approval-policy.js";
import { listingOfLoadedTools, readGateState, type DeepAgentTools } from "../turn-setup.js";

/** A loaded MCP tool carrying `annotations` on its metadata, as the adapter loads one. */
function loaded(name: string, annotations?: Record<string, unknown>): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description: name,
    schema: z.object({}),
    func: async () => "",
    ...(annotations === undefined ? {} : { metadata: { annotations } }),
  });
}

const serverToolMap = new Map<string, readonly DynamicStructuredTool[]>([
  [
    "plugin_linear_api",
    [
      loaded("delete_issue", { destructiveHint: true }),
      loaded("spoofed", { destructiveHint: true, readOnlyHint: true }),
      loaded("search", { readOnlyHint: true }),
      loaded("truthy_string", { destructiveHint: "true" }),
      loaded("unannotated"),
    ],
  ],
  ["plugin_github_api", [loaded("merge_pr", { destructiveHint: true })]],
  ["stigmer-memory", [loaded("forget", { destructiveHint: true })]],
]);

describe("listingOfLoadedTools", () => {
  it("marks only an explicit destructiveHint: true, lists every plugin server, and never reads a platform server", () => {
    const listing = listingOfLoadedTools(serverToolMap, new Set(["stigmer-memory"]));

    expect(listing.listed).toEqual([
      { server: "plugin_linear_api", tools: ["delete_issue", "spoofed", "search", "truthy_string", "unannotated"] },
      { server: "plugin_github_api", tools: ["merge_pr"] },
    ]);
    expect(listing.destructive).toEqual([
      { server: "plugin_linear_api", tool: "delete_issue" },
      { server: "plugin_linear_api", tool: "spoofed" },
      { server: "plugin_github_api", tool: "merge_pr" },
    ]);
    expect(listing.unlisted, "a server that did not connect has no tools to call").toEqual([]);
  });
});

describe("readGateState", () => {
  it("builds the gate's default from the loaded tools' marks and the turn's leases", () => {
    const base = turnInputFixture();
    const input = turnInputFixture({
      mcp: {
        ...base.mcp,
        platformServerSlugs: new Set(["stigmer-memory"]),
        leases: { ...base.mcp.leases, servers: new Set(["plugin_github_api"]) },
      },
    });
    const tools: DeepAgentTools = {
      connection: undefined,
      mcpTools: [...serverToolMap.values()].flat(),
      serverToolMap,
      toolServerMap: new Map(),
    };

    const { mcpDefault } = readGateState(input, tools);

    expect([...mcpDefault.destructive].sort()).toEqual(
      ["plugin_github_api/merge_pr", "plugin_linear_api/delete_issue", "plugin_linear_api/spoofed"].sort(),
    );
    expect(mcpDefault.unlisted.size).toBe(0);
    expect(mcpDefault.leasedServers).toBe(input.mcp.leases.servers);
    const ask = (server: string, tool: string) => resolveToolApproval(tool, server, {}, mcpDefault, new Set()).requiresApproval;
    expect(ask("plugin_linear_api", "delete_issue")).toBe(true);
    expect(ask("plugin_linear_api", "search")).toBe(false);
    expect(ask("plugin_github_api", "merge_pr"), "a leased server's tools run").toBe(false);
    expect(ask("stigmer-memory", "forget"), "the platform's own tools never ask").toBe(false);
  });
});
