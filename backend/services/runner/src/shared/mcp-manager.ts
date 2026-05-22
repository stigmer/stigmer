/**
 * MCP connection manager for the deep agent execution path.
 *
 * Wraps @langchain/mcp-adapters MultiServerMCPClient with:
 * - Conversion from ResolvedMcpServer[] to the SDK's Connection config
 * - Proper async cleanup via close()
 * - Cloud compatibility validation (warn on non-installable stdio commands)
 * - Tool filtering based on discovered capabilities
 *
 * The Cursor execution path does NOT use this manager — it passes MCP
 * configs directly to the Cursor SDK via toCursorMcpConfig(). This
 * manager is exclusively for LangGraph-based deep agent executions.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Connection } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

const CLOUD_SAFE_COMMANDS = new Set(["npx", "node", "uvx", "python", "python3"]);

/**
 * Classifies a stdio command's compatibility with cloud execution.
 * Returns true for commands that are installable/available in typical
 * cloud environments (npx, node, uvx, python).
 */
export function isCloudCompatibleCommand(command: string): boolean {
  const base = command.split("/").pop() ?? command;
  return CLOUD_SAFE_COMMANDS.has(base);
}

/**
 * Log warnings for MCP servers that may not work in cloud mode.
 * Does not filter or reject — just provides operator visibility.
 */
export function warnCloudIncompatibleServers(
  servers: ResolvedMcpServer[],
  isCloudMode: boolean,
): void {
  if (!isCloudMode) return;

  for (const server of servers) {
    if (server.connectionType === "stdio" && server.command) {
      if (!isCloudCompatibleCommand(server.command)) {
        console.warn(
          `[MCP] Server '${server.slug}' uses stdio command '${server.command}' ` +
          `which may not be available in cloud execution environments. ` +
          `Consider using an HTTP MCP server or an npx-installable package.`,
        );
      }
    }
  }
}

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
      config[server.slug] = {
        transport: "stdio",
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? processEnvAsStrings(),
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
  options?: { isCloudMode?: boolean },
): Promise<McpConnectionResult> {
  if (options?.isCloudMode) {
    warnCloudIncompatibleServers(servers, true);
  }

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

/**
 * Snapshot of process.env as a string-only record (no undefined values).
 * Used as a fallback when an MCP server has no declared env — the
 * subprocess inherits the runner's full environment, matching standard
 * Unix child-process behavior.
 *
 * Without this, @modelcontextprotocol/sdk only passes a restricted
 * whitelist (HOME, PATH, USER, etc.) which drops platform variables
 * like STIGMER_SERVER_ADDRESS.
 */
function processEnvAsStrings(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
