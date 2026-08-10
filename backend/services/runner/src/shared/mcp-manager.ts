/**
 * MCP connection manager for the deep agent execution path.
 *
 * Wraps @langchain/mcp-adapters MultiServerMCPClient with:
 * - Conversion from ResolvedMcpServer[] to the SDK's Connection config
 * - Proper async cleanup via close()
 * - Tool filtering based on discovered capabilities
 *
 * Transport policy (stdio is local-runner-only) is enforced upstream at
 * resolution time by shared/mcp-transport-guard.ts — servers reaching
 * this manager have already passed it.
 *
 * Stdio env contract (oss#256): a subprocess receives exactly the
 * variables declared in the server's spec.env (resolved upstream by
 * filterEnvToDeclaredKeys) plus the MCP SDK's minimal base environment
 * (HOME, LOGNAME, PATH, SHELL, TERM, USER — getDefaultEnvironment in
 * @modelcontextprotocol/sdk, merged under whatever we pass). The
 * runner's own process env is never passed: it carries runner-internal
 * credentials (STIGMER_TOKEN, STIGMER_RUNNER_HITL_SECRET,
 * CURSOR_API_KEY, LLM provider keys) that no third-party MCP subprocess
 * may see. A declared-empty env and an undeclared env are deliberately
 * equivalent — both yield the SDK base environment.
 *
 * The Cursor execution path does NOT use this manager — it passes MCP
 * configs directly to the Cursor SDK via toCursorMcpConfig(). This
 * manager serves LangGraph-based deep agent executions, and discovery
 * (activities/discover-mcp-server.ts) builds its spawn config through
 * toMcpClientConfig too.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Connection } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * Convert harness-agnostic ResolvedMcpServer[] into the
 * MultiServerMCPClient connection config format.
 */
export function toMcpClientConfig(
  servers: ResolvedMcpServer[],
): Record<string, Connection> {
  const config: Record<string, Connection> = {};

  for (const server of servers) {
    if (server.connectionType === "stdio") {
      if (!server.command) continue;
      if (!server.env || Object.keys(server.env).length === 0) {
        console.log(
          `[MCP] Server '${server.slug}' declares no env — its subprocess ` +
          `starts with the minimal base environment only. Declare variables ` +
          `in the McpServer's spec.env to pass them.`,
        );
      }
      config[server.slug] = {
        transport: "stdio",
        command: server.command,
        args: server.args ?? [],
        env: server.env,
        cwd: server.cwd,
      };
    } else if (server.connectionType === "http" || server.connectionType === "sse") {
      if (!server.url) continue;
      config[server.slug] = {
        transport: "http",
        url: server.url,
        headers: server.headers,
      };
    }
  }

  return config;
}

export interface McpConnectionResult {
  client: MultiServerMCPClient;
  tools: DynamicStructuredTool[];
  serverToolMap: Record<string, DynamicStructuredTool[]>;
}

/**
 * Create and initialize MCP connections from resolved server specs.
 *
 * The caller is responsible for calling result.client.close() when
 * done — typically in a finally block or via a cleanup handler.
 */
export async function connectMcpServers(
  servers: ResolvedMcpServer[],
): Promise<McpConnectionResult> {
  const connectionConfig = toMcpClientConfig(servers);

  if (Object.keys(connectionConfig).length === 0) {
    const client = new MultiServerMCPClient({});
    return { client, tools: [], serverToolMap: {} };
  }

  const client = new MultiServerMCPClient(connectionConfig);
  const serverToolMap = await client.initializeConnections();

  const tools: DynamicStructuredTool[] = [];
  for (const serverTools of Object.values(serverToolMap)) {
    tools.push(...serverTools);
  }

  console.log(
    `[MCP] Connected ${Object.keys(serverToolMap).length} server(s), ` +
    `${tools.length} tool(s) total: ${Object.entries(serverToolMap)
      .map(([name, t]) => `${name}(${t.length})`)
      .join(", ")}`,
  );

  return { client, tools, serverToolMap };
}
