/**
 * Connect backfill for MCP servers without discovered capabilities.
 *
 * Thin wrapper around the shared connect-backfill module that preserves
 * the cursor-specific McpResolutionResult interface (which includes
 * cursorConfig). The core backfill logic lives in shared/connect-backfill.ts.
 *
 * Non-fatal: if connect fails for any server, the original servers are
 * kept and execution continues with empty policies (fail-closed).
 */

import type { McpResolutionResult } from "./mcp-resolver.js";
import { toCursorMcpConfig } from "./mcp-resolver.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { backfillMcpServersIfNeeded as sharedBackfill } from "../../shared/connect-backfill.js";

/**
 * Run connect backfill and return an updated cursor-specific
 * McpResolutionResult with rebuilt cursorConfig.
 */
export async function backfillMcpServersIfNeeded(
  client: StigmerClient,
  currentResult: McpResolutionResult,
  usages: McpServerUsage[],
  envVars: Record<string, string>,
  org: string,
  onHeartbeat?: () => void,
  secretKeys?: ReadonlySet<string>,
): Promise<McpResolutionResult> {
  const updatedServers = await sharedBackfill(
    client,
    currentResult.resolvedServers,
    usages,
    envVars,
    org,
    onHeartbeat,
    secretKeys,
  );

  if (updatedServers === currentResult.resolvedServers) {
    return currentResult;
  }

  return {
    cursorConfig: toCursorMcpConfig(updatedServers),
    resolvedServers: updatedServers,
  };
}
