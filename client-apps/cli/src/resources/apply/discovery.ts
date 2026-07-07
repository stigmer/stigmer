// Post-apply MCP capability discovery.
//
// After a file apply, each newly-applied stdio MCP server is connected so its
// tools become available immediately (no daemon restart). This is best-effort:
// HTTP servers are skipped (the backend discovers those lazily), servers with
// unset secret env vars are skipped with a hint, and connect failures warn
// rather than fail the apply. Mirrors Go's discoverAppliedMcpServers + ConnectOne.

import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { buildRuntimeEnv } from "../mcp/runtime-env.js";

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

    const missing = missingSecretEnvVars(server);
    if (missing.length > 0) {
      sink?.(`Skipping discovery for ${name}: missing secret env var(s): ${missing.join(", ")}`);
      continue;
    }

    try {
      await client.mcpServer.connect(
        create(ConnectInputSchema, {
          mcpServerId: server.metadata?.id ?? "",
          org,
          runtimeEnv: buildRuntimeEnv(server),
        }),
      );
      sink?.(`Discovered capabilities for ${name}`);
    } catch (err) {
      sink?.(`Discovery failed for ${name}: ${(err as Error).message}`);
    }
  }
}

function missingSecretEnvVars(server: McpServer): string[] {
  const env = server.spec?.env ?? {};
  const missing: string[] = [];
  for (const [name, decl] of Object.entries(env)) {
    if (decl.isSecret && (process.env[name] ?? "") === "") missing.push(name);
  }
  return missing;
}
