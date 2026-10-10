/**
 * Connect backfill for MCP servers never discovered.
 *
 * The approval default asks before an MCP tool only when its server marks
 * it destructive, and that mark (`DiscoveredTool.destructive_hint`) is
 * recorded by discovery. A server attached before anyone connected it has
 * no discovered capabilities, so nothing would ask for any of its tools.
 * This module runs that discovery once, at turn start: the connect RPC
 * starts the connect workflow (discovery only) and blocks until it
 * completes, then the servers are re-resolved so the turn sees the marks.
 *
 * A server the run's fetch gave values to is connected naming the run
 * (`run_id`), with no values: the server uses the run's planned values for
 * that server, which discovery fetches from their vaults as the turn did,
 * so a key the run took from a shared vault reaches discovery without the
 * runner sending it back. The call presents the credential the turn's
 * fetch used (a desktop runner's exchanged token, the activity's run
 * credential, or the ambient one when it is already bound to this work),
 * the one the server accepts `run_id` from. A server the fetch gave nothing names no run: it needs no
 * values, and its connect asks nothing of the run's credential.
 *
 * Backfill trigger: discovered_capabilities is empty or absent. A server
 * discovered at least once is never re-discovered here; reconnecting it
 * is the owner's act.
 *
 * Non-fatal: if connect fails for any server (permissions, timeout,
 * unreachable), the original servers are kept and execution continues
 * with that server's destructive set empty, so none of its tools asks.
 * The server-side connect is the place that surfaces the failure.
 *
 * This module is harness-agnostic — both ExecuteCursor and
 * ExecuteDeepAgent use the same backfill logic. Each harness maps
 * the returned ResolvedMcpServer[] into its SDK-specific format.
 */

import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { resolveMcpServers } from "./mcp-resolver.js";
import type { McpTransportPosture } from "./mcp-transport-guard.js";
import type { PlatformEndpoints } from "./platform-server-address.js";
import type { ToolValueGroup } from "./run-values.js";
import { withTimeout } from "./with-timeout.js";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";

const CONNECT_TIMEOUT_MS = 60_000;

/**
 * When true, skip connect backfill entirely. The engine binds whatever
 * tools a server lists live when it connects, so the backfill (which
 * routes through the server's connect workflow) only records the
 * destructive marks the approval default reads. Offline tests set this
 * because no worker polls the stigmer_runner queue that the connect
 * workflow dispatches to.
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
 * to pick up the newly recorded destructive marks.
 *
 * Triggers the connect RPC synchronously for each server with empty
 * discovered_capabilities. The RPC starts the connect workflow
 * (discovery) and returns the updated McpServer.
 *
 * After at least one successful backfill, re-resolves ALL servers
 * to pick up the fresh discovery. If no backfills succeed, returns the
 * original servers unchanged.
 */
export async function backfillMcpServersIfNeeded(
  client: StigmerClient,
  currentServers: ResolvedMcpServer[],
  usages: McpServerUsage[],
  tools: ReadonlyMap<string, ToolValueGroup>,
  platformValues: Readonly<Record<string, string>>,
  org: string,
  runId: string,
  transportPosture: McpTransportPosture,
  platformEndpoints: PlatformEndpoints,
  onHeartbeat?: () => void,
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

      console.log(
        `[connect-backfill] Triggering connect for "${server.slug}" (${serverId})`,
      );
      onHeartbeat?.();

      // Bounded through the shared helper so the timer is cleared when the
      // connect wins; a bare `setTimeout` in a `Promise.race` stays armed and
      // holds the event loop open for the full bound (stigmer#1008).
      const updated = await withTimeout(
        CONNECT_TIMEOUT_MS,
        `Connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`,
        async () =>
          client.connectMcpServer(
            serverId,
            org,
            tools.has(serverId)
              ? {
                  runId,
                  // The credential the turn's fetch used: a desktop
                  // runner's exchanged token, a run credential, or none
                  // when the ambient one is already bound to this work.
                  scopedToken: await client.acquireScopedRunnerToken({ agentExecutionId: runId }),
                }
              : undefined,
          ),
      );

      const toolCount = updated.status?.discoveredCapabilities?.tools.length ?? 0;
      const destructiveCount =
        updated.status?.discoveredCapabilities?.tools.filter((t) => t.destructiveHint).length ?? 0;
      console.log(
        `[connect-backfill] "${server.slug}" — ` +
        `discovered ${toolCount} tool(s), ${destructiveCount} marked destructive`,
      );
      anyBackfilled = true;
      onHeartbeat?.();
    } catch (err) {
      console.warn(
        `[connect-backfill] Failed for "${server.slug}": ` +
        `${err instanceof Error ? err.message : err}. ` +
        `Continuing with no destructive marks for this server.`,
      );
    }
  }

  if (!anyBackfilled) {
    return currentServers;
  }

  // Same posture as the initial resolution: every server here already
  // passed the transport guard once, so re-resolving cannot newly reject.
  const refreshed = await resolveMcpServers(
    client, usages, tools, platformValues, transportPosture, platformEndpoints,
  );
  return refreshed.resolvedServers;
}
