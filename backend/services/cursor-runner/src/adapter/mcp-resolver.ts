/**
 * Resolves Stigmer McpServerUsage references into Cursor SDK McpServerConfig.
 *
 * Stigmer sessions reference MCP servers by slug via McpServerUsage. Each
 * usage points to an McpServer resource that has connection config (stdio
 * or HTTP). This module fetches those resources and translates them into
 * the Cursor SDK's McpServerConfig format for Agent.create().
 *
 * Secrets (env vars, headers) come from the merged execution context,
 * same pipeline as the Python agent-runner's config_transformer.py.
 */

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb.js";

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
 * Resolved MCP server with its connection config. In a full implementation,
 * this would come from fetching the McpServer resource via gRPC. For now,
 * this interface defines the shape the resolver expects.
 */
export interface ResolvedMcpServer {
  slug: string;
  connectionType: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Transform resolved MCP servers into the Cursor SDK's mcpServers config
 * for Agent.create().
 *
 * @param servers - Pre-resolved MCP server configs (fetched from Stigmer)
 * @returns Record keyed by server slug, matching Cursor's mcpServers option
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

/**
 * Extract MCP server slugs from session-level McpServerUsage references.
 * These slugs are used to fetch the full McpServer resources from the server.
 */
export function extractMcpServerSlugs(usages: McpServerUsage[]): string[] {
  return usages
    .map((u) => u.mcpServerRef?.slug)
    .filter((s): s is string => !!s);
}
