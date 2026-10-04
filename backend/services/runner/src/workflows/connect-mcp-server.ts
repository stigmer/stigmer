/**
 * Temporal workflows for the MCP server connect flow.
 *
 * ConnectMcpServerWorkflow ("stigmer/mcp-server/connect"):
 *   One step — discover the server's tools and resource templates — and a
 *   result the server persists as `McpServerStatus.discovered_capabilities`.
 *   Each tool carries `destructiveHint`, the one thing the approval default
 *   reads from a server (true only for an explicit MCP annotation
 *   `destructiveHint: true`; see activities/discover-mcp-server.ts). The
 *   result carries no approval decisions: nothing here judges a tool.
 *
 * DiscoverMcpServerWorkflow ("stigmer/mcp-server/discover"):
 *   Legacy single-stage wrapper, kept registered under its pinned name so a
 *   caller still starting it gets the same discovery result.
 *
 * SANDBOX RULES: This file runs inside the Temporal deterministic V8
 * isolate. No Node.js built-ins (crypto, fs, net), no non-deterministic
 * operations, no side-effecting imports. Only @temporalio/workflow APIs,
 * type-only imports, and pure JS/TS logic.
 */

import { proxyActivities } from "@temporalio/workflow";

import type {
  createDiscoverMcpServerActivities,
  DiscoverMcpServerOutput,
} from "../activities/discover-mcp-server.js";

import type {
  ConnectMcpServerWorkflowInput,
  ConnectMcpServerWorkflowOutput,
  DiscoverMcpServerWorkflowOutput,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Activity Proxies
// ─────────────────────────────────────────────────────────────────────────────

type DiscoverActivities = ReturnType<typeof createDiscoverMcpServerActivities>;

// Discovery's bounds ladder (issue #239): the activity heartbeats every 15s,
// so heartbeatTimeout is pure LIVENESS (dead worker/pod detection) — it no
// longer kills slow-but-alive discoveries. The activity bounds its own WORK
// with a transport-aware init timeout (30s HTTP / 270s stdio) that fails with
// an actionable, endpoint-naming error; startToCloseTimeout is the hard cap
// above both. Keep the ordering: work bound < hard cap, heartbeat interval
// (15s) < heartbeatTimeout.
const discover = proxyActivities<DiscoverActivities>({
  startToCloseTimeout: "600s",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
});

function runDiscovery(input: ConnectMcpServerWorkflowInput): Promise<DiscoverMcpServerOutput> {
  return discover.DiscoverMcpServerCapabilities({
    mcpServerId: input.mcp_server_id,
    executionContextId: input.execution_context_id ?? null,
    executionContextToken: input.execution_context_token ?? null,
    invokerIdentityAccountId: input.invoker_identity_account_id ?? null,
  });
}

/** The discovery result in the wire's shape (see workflows/types.ts for the key casing). */
function toWire(discovery: DiscoverMcpServerOutput): ConnectMcpServerWorkflowOutput {
  return {
    tools: discovery.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? null,
      destructiveHint: t.destructiveHint,
    })),
    resource_templates: discovery.resourceTemplates.map((rt) => ({
      uri_template: rt.uriTemplate,
      name: rt.name,
      description: rt.description,
      mime_type: rt.mimeType,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectMcpServerWorkflow — primary connect flow
// ─────────────────────────────────────────────────────────────────────────────

export async function connectMcpServer(
  input: ConnectMcpServerWorkflowInput,
): Promise<ConnectMcpServerWorkflowOutput> {
  return toWire(await runDiscovery(input));
}

// ─────────────────────────────────────────────────────────────────────────────
// DiscoverMcpServerWorkflow — legacy wrapper
// ─────────────────────────────────────────────────────────────────────────────

export async function discoverMcpServerLegacy(
  input: ConnectMcpServerWorkflowInput,
): Promise<DiscoverMcpServerWorkflowOutput> {
  return toWire(await runDiscovery(input));
}
