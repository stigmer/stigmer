/**
 * Connect backfill for MCP servers without discovered capabilities.
 *
 * When an MCP server has empty discovered_capabilities, triggers the
 * connect RPC to discover tools and classify approval policies via
 * the LLM classifier. The connect RPC starts a Temporal workflow
 * (discover + classify) and blocks until completion (~30 seconds).
 *
 * Backfill trigger: discovered_capabilities is empty or absent.
 *
 * Non-fatal: if connect fails for any server (permissions, timeout,
 * unreachable), the original servers are kept and execution continues
 * with empty policies. All tools from that server will require
 * approval by default (fail-closed).
 *
 * This module is harness-agnostic — both ExecuteCursor and
 * ExecuteDeepAgent use the same backfill logic. Each harness maps
 * the returned ResolvedMcpServer[] into its SDK-specific format.
 */

import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { resolveMcpServers } from "./mcp-resolver.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

const CONNECT_TIMEOUT_MS = 60_000;

/**
 * When true, skip connect backfill entirely. The runner discovers
 * tools directly via stdio/HTTP when it connects MCP servers, so
 * the backfill (which routes through the Java service's Temporal
 * workflow) is only needed for LLM-based approval classification.
 * Offline tests set this because no worker polls the stigmer_runner
 * queue that the Connect workflow dispatches to.
 */
const SKIP_BACKFILL = process.env.SKIP_MCP_CONNECT_BACKFILL === "true";

/**
 * Check whether an MCP server needs a connect backfill.
 *
 * Returns true if the server has never been discovered (empty
 * capabilities). Exported for testing.
 */
export function needsBackfill(server: ResolvedMcpServer): boolean {
  if (SKIP_BACKFILL) return false;
  return server.discoveredCapabilitiesEmpty;
}

/**
 * Run connect backfill for MCP servers that need it, then re-resolve
 * to pick up the newly populated approval policies.
 *
 * Triggers the connect RPC synchronously for each server with empty
 * discovered_capabilities. The RPC starts a Temporal workflow
 * (discover + classify) and returns the updated McpServer.
 *
 * After at least one successful backfill, re-resolves ALL servers
 * to pick up fresh policies. If no backfills succeed, returns the
 * original servers unchanged.
 */
export async function backfillMcpServersIfNeeded(
  client: StigmerClient,
  currentServers: ResolvedMcpServer[],
  usages: McpServerUsage[],
  envVars: Record<string, string>,
  org: string,
  onHeartbeat?: () => void,
  secretKeys?: ReadonlySet<string>,
): Promise<ResolvedMcpServer[]> {
  const serversNeedingBackfill = currentServers.filter(needsBackfill);

  if (serversNeedingBackfill.length === 0) {
    return currentServers;
  }

  console.log(
    `[connect-backfill] Backfill needed for ${serversNeedingBackfill.length} MCP server(s): ` +
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

      const runtimeEnv = extractRuntimeEnvForServer(fullServer, envVars, secretKeys);

      console.log(
        `[connect-backfill] Triggering connect for "${server.slug}" (${serverId})`,
      );
      onHeartbeat?.();

      const updated = await Promise.race([
        client.connectMcpServer(serverId, org, runtimeEnv),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `Connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`,
            )),
            CONNECT_TIMEOUT_MS,
          ),
        ),
      ]);

      const toolCount = updated.status?.discoveredCapabilities?.tools.length ?? 0;
      const approvalCount = updated.status?.toolApprovals?.length ?? 0;
      console.log(
        `[connect-backfill] "${server.slug}" — ` +
        `discovered ${toolCount} tool(s), classified ${approvalCount} approval policy(ies)`,
      );
      anyBackfilled = true;
      onHeartbeat?.();
    } catch (err) {
      console.warn(
        `[connect-backfill] Failed for "${server.slug}": ` +
        `${err instanceof Error ? err.message : err}. ` +
        `Continuing with empty approval policies for this server.`,
      );
    }
  }

  if (!anyBackfilled) {
    return currentServers;
  }

  const refreshed = await resolveMcpServers(client, usages, envVars);
  return refreshed.resolvedServers;
}

/**
 * Extract the MCP server's required env vars from the execution
 * environment. Returns only the keys declared in spec.env that are
 * present in the merged environment.
 *
 * isSecret is derived from the MCP server's env declaration first,
 * then from the execution-level secretKeys set, defaulting to false.
 */
export function extractRuntimeEnvForServer(
  server: { spec?: { env?: Record<string, unknown> } },
  mergedEnv: Record<string, string>,
  secretKeys?: ReadonlySet<string>,
): Record<string, { value: string; isSecret: boolean }> | undefined {
  const envDecls = server.spec?.env;
  if (!envDecls || Object.keys(envDecls).length === 0) return undefined;

  const runtime: Record<string, { value: string; isSecret: boolean }> = {};
  for (const key of Object.keys(envDecls)) {
    if (key in mergedEnv) {
      const decl = envDecls[key] as { isSecret?: boolean } | undefined;
      const isSecret = decl?.isSecret ?? secretKeys?.has(key) ?? false;
      runtime[key] = { value: mergedEnv[key], isSecret };
    }
  }

  return Object.keys(runtime).length > 0 ? runtime : undefined;
}
