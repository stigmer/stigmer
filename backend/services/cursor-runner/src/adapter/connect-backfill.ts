/**
 * Connect backfill for MCP servers without discovered capabilities.
 *
 * Mirrors the Python agent-runner's _backfill_undiscovered_servers():
 * when an MCP server has empty or stale discovered_capabilities, triggers
 * the connect RPC to discover tools and classify approval policies via
 * the LLM classifier. The connect RPC starts a Temporal workflow and
 * blocks until completion (~30 seconds).
 *
 * Backfill triggers:
 * 1. Never discovered — discovered_capabilities is empty or absent
 * 2. Stale — last_discovered_at is older than 24 hours
 *
 * Non-fatal: if connect fails for any server (permissions, timeout,
 * unreachable), the original server is kept and execution continues
 * with the stale/empty policies. All tools from that server will
 * require approval by default (fail-closed).
 */

import type { ResolvedMcpServer, McpResolutionResult } from "./mcp-resolver.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { resolveMcpServers } from "./mcp-resolver.js";

const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Check whether an MCP server needs a connect backfill.
 *
 * Returns true if the server has never been discovered (empty
 * capabilities) or if the discovery is stale (older than 24 hours).
 */
function needsBackfill(server: ResolvedMcpServer): boolean {
  if (server.discoveredCapabilitiesEmpty) return true;
  return false;
}

/**
 * Run connect backfill for MCP servers that need it.
 *
 * Triggers the connect RPC synchronously for servers that have empty
 * discovered_capabilities. The RPC starts a Temporal workflow (discover +
 * classify) and returns the updated McpServer with populated
 * status.discovered_capabilities and status.tool_approvals.
 *
 * After successful connect, re-resolves the server to pick up the new
 * policies. On failure, the original server is kept (fail-closed: all
 * tools require approval by default).
 *
 * @param client - Stigmer gRPC client
 * @param currentResult - The current MCP resolution result
 * @param usages - Original McpServerUsage references (for re-resolution)
 * @param envVars - Execution environment variables
 * @param org - Organization context for the connect RPC
 * @returns Updated McpResolutionResult with backfilled servers
 */
export async function backfillMcpServersIfNeeded(
  client: StigmerClient,
  currentResult: McpResolutionResult,
  usages: McpServerUsage[],
  envVars: Record<string, string>,
  org: string,
  onHeartbeat?: () => void,
): Promise<McpResolutionResult> {
  const serversNeedingBackfill = currentResult.resolvedServers.filter(needsBackfill);

  if (serversNeedingBackfill.length === 0) {
    return currentResult;
  }

  console.log(
    `Connect backfill needed for ${serversNeedingBackfill.length} MCP server(s): ` +
    serversNeedingBackfill.map((s) => s.slug).join(", "),
  );

  let anyBackfilled = false;

  for (const server of serversNeedingBackfill) {
    try {
      const serverRef = usages.find((u) => u.mcpServerRef?.slug === server.slug);
      if (!serverRef?.mcpServerRef) continue;

      const fullServer = await client.getMcpServerByReference(serverRef.mcpServerRef);
      const serverId = fullServer.metadata?.id;
      if (!serverId) continue;

      const runtimeEnv = extractRuntimeEnvForServer(fullServer, envVars);

      console.log(`Connect backfill: triggering connect for MCP server "${server.slug}" (${serverId})`);
      onHeartbeat?.();
      const connectTimeout = 60_000;
      const updated = await Promise.race([
        client.connectMcpServer(serverId, org, runtimeEnv),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Connect timed out after ${connectTimeout / 1000}s`)), connectTimeout),
        ),
      ]);

      const toolCount = updated.status?.discoveredCapabilities?.tools.length ?? 0;
      const approvalCount = updated.status?.toolApprovals?.length ?? 0;
      console.log(
        `Connect backfill for MCP server "${server.slug}" — ` +
        `discovered ${toolCount} tools, classified ${approvalCount} approval policies`,
      );
      anyBackfilled = true;
      onHeartbeat?.();
    } catch (err) {
      console.warn(
        `Connect backfill failed for MCP server "${server.slug}": ` +
        `${err instanceof Error ? err.message : err}. ` +
        `Continuing without current approval policies for this server.`,
      );
    }
  }

  if (!anyBackfilled) {
    return currentResult;
  }

  return resolveMcpServers(client, usages, envVars);
}

/**
 * Extract the MCP server's required env vars from the execution environment.
 *
 * Returns only the keys declared in spec.env that are present in the
 * execution's merged environment. Returns undefined if no env vars needed.
 */
function extractRuntimeEnvForServer(
  server: { spec?: { env?: Record<string, unknown> } },
  mergedEnv: Record<string, string>,
): Record<string, string> | undefined {
  const envDecls = server.spec?.env;
  if (!envDecls || Object.keys(envDecls).length === 0) return undefined;

  const runtime: Record<string, string> = {};
  for (const key of Object.keys(envDecls)) {
    if (key in mergedEnv) {
      runtime[key] = mergedEnv[key];
    }
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined;
}
