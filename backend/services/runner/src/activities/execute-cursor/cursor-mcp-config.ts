/**
 * The Cursor harness's MCP output adapter: maps the shared resolver's
 * {@link ResolvedMcpServer} servers into the Cursor SDK's mcpServers config
 * for Agent.create(), plus the harness's env pre-flight check.
 *
 * Resolution itself lives in shared/mcp-resolver.ts (oss#387 consolidated the
 * near-duplicate resolver this file used to carry) — this module is the
 * symmetric twin of the deep-agent harness's toMcpClientConfig in
 * shared/mcp-manager.ts: both consume the identical intermediate, only the
 * final SDK serialization differs.
 */

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";

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
 *
 * Call it ONCE, after the last mutation of the resolved-server list (backfill,
 * synthesized-attachment injection): the config is a projection of that list,
 * and building it early just creates a stale copy someone must remember to
 * rebuild. The Cursor SDK config cannot hide tools, so enabledTools is NOT
 * expressed here — the HITL hook enforces it (see ResolvedMcpServer.enabledTools).
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
 * Validate that resolved MCP servers have their required env vars populated.
 * Returns a list of warnings for servers with empty/missing env.
 * Used as a pre-flight check before agent.send() to surface config issues early.
 */
export function validateMcpServerEnv(
  servers: ResolvedMcpServer[],
  usages: McpServerUsage[],
): string[] {
  const warnings: string[] = [];

  for (const usage of usages) {
    const slug = usage.mcpServerRef?.slug;
    if (!slug) continue;

    const resolved = servers.find((s) => s.slug === slug);
    if (!resolved) {
      warnings.push(`MCP server '${slug}': failed to resolve (server may not exist or is inaccessible)`);
      continue;
    }

    if (resolved.connectionType === "stdio" && resolved.env) {
      const emptyKeys = Object.entries(resolved.env)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (emptyKeys.length > 0) {
        warnings.push(
          `MCP server '${slug}': env vars [${emptyKeys.join(", ")}] are empty — ` +
          `server subprocess will likely fail to connect`,
        );
      }
    }
  }

  return warnings;
}
