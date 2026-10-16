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

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { toolServerSegment } from "../../shared/plugin-servers.js";

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
 * Call it ONCE, after the last mutation of the resolved-server list (the
 * synthesized-attachment injection): the config is a projection of that list,
 * and building it early just creates a stale copy someone must remember to
 * rebuild. An agent's tool lists are not expressed here: the SDK's `mcp` tool
 * option is all-or-nothing and a server config has no tool filter, so MCP
 * narrowing by server and tool is the HITL hook's (`hook-scope.ts`).
 */
export function toCursorMcpConfig(
  servers: readonly ResolvedMcpServer[],
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
 * The names of every server the turn declared: the ones its agent writes
 * itself, then its plugins'. The platform's own servers are not declared.
 */
export function declaredServerSlugs(blueprint: {
  readonly agent: { readonly spec: Pick<AgentSpec, "mcpServers"> } | undefined;
  readonly plugins: readonly Plugin[];
}): string[] {
  return [
    ...(blueprint.agent?.spec.mcpServers ?? []).map((server) => server.name),
    ...blueprint.plugins.flatMap((plugin) =>
      (plugin.status?.mcpServers ?? []).map((entry) => toolServerSegment(plugin.metadata?.name ?? "", entry.name)),
    ),
  ];
}

/**
 * Validate that resolved MCP servers have their required env vars populated.
 * Returns a list of warnings for servers with empty/missing env, and for
 * each declared server (`declaredServerSlugs`) that did not resolve.
 * Used as a pre-flight check before agent.send() to surface config issues early.
 */
export function validateMcpServerEnv(
  servers: readonly ResolvedMcpServer[],
  slugs: readonly string[],
): string[] {
  const warnings: string[] = [];

  for (const slug of slugs) {
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
