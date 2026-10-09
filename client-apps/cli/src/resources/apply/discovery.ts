// Post-apply MCP capability discovery.
//
// After a file apply, each newly-applied stdio MCP server is connected so its
// tools become available immediately (no daemon restart). This is best-effort:
// HTTP servers are skipped (the backend discovers those lazily), and connect
// failures warn rather than fail the apply. The connect reads the caller's My
// vault on the server, never this machine's environment: a key it lacks is
// named in the warning, with the vault command that saves it.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { StigmerError, type Stigmer } from "@stigmer/sdk";

/** A sink for human progress/warning lines (discovery output is not parity). */
export type DiscoverySink = (line: string) => void;

/**
 * Connect each applied stdio MCP server to trigger capability discovery.
 *
 * `org` is the resolved apply organization. The backend requires it on every
 * ConnectInput, and it is guaranteed non-empty here: `applyMessage` injects org
 * into each resource and the backend rejects an org-less MCP server apply, so
 * any server that reached `servers` was applied under this org.
 */
export async function discoverAppliedMcpServers(
  client: Stigmer,
  servers: readonly McpServer[],
  org: string,
  sink?: DiscoverySink,
): Promise<void> {
  if (servers.length === 0) return;
  sink?.(`Discovering capabilities for ${servers.length} applied MCP server(s)...`);

  for (const server of servers) {
    const name = server.metadata?.name ?? "(unnamed)";

    // Only stdio servers are auto-connected here; HTTP servers are skipped.
    if (server.spec?.serverType?.case !== "stdio") continue;

    try {
      await client.mcpServer.connect(
        create(ConnectInputSchema, {
          mcpServerId: server.metadata?.id ?? "",
          org,
        }),
      );
      sink?.(`Discovered capabilities for ${name}`);
    } catch (err) {
      sink?.(`Discovery failed for ${name}: ${(err as Error).message}`);
      if (err instanceof StigmerError && err.connectCode === Code.FailedPrecondition) {
        sink?.(`Save a missing key with: stigmer vault set-secret <NAME> --mine, then run stigmer connect mcp-server ${server.metadata?.slug ?? name}`);
      }
    }
  }
}
