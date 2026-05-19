/**
 * Cursor-specific MCP config mapping.
 *
 * Converts harness-agnostic ResolvedMcpServer into the Cursor SDK's
 * McpServerConfig shape for Agent.create(). The resolution logic lives
 * in shared/mcp-resolver.ts; this module only handles the final transform.
 */

import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";

export type { ResolvedMcpServer, McpResolutionResult } from "../../shared/mcp-resolver.js";
export {
  resolveMcpServers,
  extractMcpServerSlugs,
  PlaceholderResolutionError,
} from "../../shared/mcp-resolver.js";

/**
 * Cursor SDK MCP server config shape (matches @cursor/sdk McpServerConfig).
 * Defined here to avoid tight coupling to the SDK's internal types.
 */
export type CursorMcpServerConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type?: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

/**
 * Transform resolved MCP servers into the Cursor SDK's mcpServers config
 * for Agent.create().
 */
export function toCursorMcpConfig(
  servers: ResolvedMcpServer[],
): Record<string, CursorMcpServerConfig> {
  const result: Record<string, CursorMcpServerConfig> = {};

  for (const server of servers) {
    if (server.connectionType === "stdio") {
      if (!server.command) continue;
      result[server.slug] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
      };
    } else {
      if (!server.url) continue;
      result[server.slug] = {
        type: server.connectionType,
        url: server.url,
        headers: server.headers,
      };
    }
  }

  return result;
}
