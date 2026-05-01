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

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { StigmerClient } from "../client/stigmer-client.js";

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
 * Resolved MCP server with its connection config.
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
 * Fetch McpServer resources for each merged usage and resolve into
 * Cursor SDK config format.
 *
 * Replicates the Python agent-runner's pattern:
 * 1. For each McpServerUsage, use the ref to fetch the full McpServer resource
 * 2. Extract connection config (stdio or http) from McpServerSpec
 * 3. Transform into Cursor SDK's mcpServers config
 */
export async function resolveMcpServers(
  client: StigmerClient,
  usages: McpServerUsage[],
): Promise<Record<string, CursorMcpServerConfig>> {
  const resolved: ResolvedMcpServer[] = [];

  for (const usage of usages) {
    const ref = usage.mcpServerRef;
    if (!ref?.slug) continue;

    try {
      const mcpServer = await client.getMcpServerByReference(ref);
      const server = mcpServerToResolved(mcpServer, ref.slug);
      if (server) resolved.push(server);
    } catch (err) {
      console.warn(
        `Failed to resolve MCP server ${ref.org}/${ref.slug}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return toCursorMcpConfig(resolved);
}

/**
 * Convert a fetched McpServer resource into our intermediate format.
 */
function mcpServerToResolved(
  server: McpServer,
  slug: string,
): ResolvedMcpServer | null {
  const spec = server.spec;
  if (!spec) return null;

  switch (spec.serverType.case) {
    case "stdio": {
      const stdio = spec.serverType.value;
      if (!stdio.command) return null;
      return {
        slug,
        connectionType: "stdio",
        command: stdio.command,
        args: stdio.args.length > 0 ? stdio.args : undefined,
        cwd: stdio.workingDir || undefined,
      };
    }
    case "http": {
      const http = spec.serverType.value;
      if (!http.url) return null;
      const headers = Object.keys(http.headers).length > 0 ? http.headers : undefined;
      return {
        slug,
        connectionType: "http",
        url: http.url,
        headers,
      };
    }
    default:
      return null;
  }
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
