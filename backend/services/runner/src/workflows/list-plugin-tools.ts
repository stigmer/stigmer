/**
 * Temporal workflows for a plugin's tools listing.
 *
 * "stigmer/mcp-server/connect": one step — list one plugin server's tools
 * now, with each tool's `destructiveHint` (true only for an explicit MCP
 * annotation; see shared/mcp-tool-listing.ts) — and the list as its
 * result, which the server hands to the person who asked. Nothing is
 * persisted; nothing here judges a tool.
 *
 * "stigmer/mcp-server/discover": the same listing under its older pinned
 * name, kept registered so a caller still starting it gets the same result.
 *
 * Both type names are pinned wire identifiers from before a server lived
 * inside a plugin.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyActivities } from "@temporalio/workflow";

import type {
  createListPluginToolsActivities,
  ListPluginToolsOutput,
} from "../activities/list-plugin-tools.js";

import type { ListPluginToolsWorkflowInput, ListPluginToolsWorkflowOutput } from "./types.js";

type ListActivities = ReturnType<typeof createListPluginToolsActivities>;

// The bounds ladder (issue #239): the activity heartbeats every 15s, so
// heartbeatTimeout is pure LIVENESS (dead worker detection) — it never
// kills a slow-but-alive listing. The activity bounds its own WORK with a
// transport-aware init timeout (30s HTTP / 270s stdio) that fails with an
// actionable, endpoint-naming error; startToCloseTimeout is the hard cap
// above both.
const list = proxyActivities<ListActivities>({
  startToCloseTimeout: "600s",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
});

function runListing(input: ListPluginToolsWorkflowInput): Promise<ListPluginToolsOutput> {
  return list.DiscoverMcpServerCapabilities({
    pluginId: input.plugin_id,
    server: input.server,
    executionContextId: input.execution_context_id ?? null,
    executionContextToken: input.execution_context_token ?? null,
  });
}

function toWire(listing: ListPluginToolsOutput): ListPluginToolsWorkflowOutput {
  return {
    tools: listing.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      destructiveHint: tool.destructiveHint,
    })),
  };
}

export async function listPluginTools(input: ListPluginToolsWorkflowInput): Promise<ListPluginToolsWorkflowOutput> {
  return toWire(await runListing(input));
}

export async function listPluginToolsLegacy(input: ListPluginToolsWorkflowInput): Promise<ListPluginToolsWorkflowOutput> {
  return toWire(await runListing(input));
}
