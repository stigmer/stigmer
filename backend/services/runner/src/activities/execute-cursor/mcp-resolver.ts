/**
 * Resolves Stigmer McpServerUsage references into Cursor SDK McpServerConfig
 * and loads tool approval policies from each MCP server resource.
 *
 * Stigmer sessions reference MCP servers by slug via McpServerUsage. Each
 * usage points to an McpServer resource that has connection config (stdio
 * or HTTP) and tool approval policies (system-generated + manual overrides).
 *
 * This module fetches those resources and produces:
 * 1. Cursor SDK McpServerConfig for Agent.create()
 * 2. Tool approval policies for the HITL hook script
 *
 * Secrets (env vars, headers) come from the merged execution context,
 * same pipeline as the Python agent-runner's config_transformer.py.
 */

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { StigmerClient } from "../../client/stigmer-client.js";
import {
  assertTransportAllowed,
  McpTransportError,
  type McpTransportPosture,
} from "../../shared/mcp-transport-guard.js";
import {
  resolveHeaders,
  resolvePlaceholders,
  filterEnvToDeclaredKeys,
  PlaceholderResolutionError,
} from "./placeholder-resolver.js";
import { effectiveEnabledTools } from "../../shared/mcp-enabled-tools.js";

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
 * Resolved MCP server with connection config and approval policies.
 *
 * Extends the basic connection info with the full policy data needed
 * for HITL enforcement. Loaded in a single fetch per server to avoid
 * extra round-trips.
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
  /** System-generated approval policies from the connect flow's LLM classifier. */
  toolApprovals: ToolApprovalPolicy[];
  /** Manual overrides set by the MCP server owner. */
  pinnedToolApprovals: ToolApprovalPolicy[];
  /** True when the server has never been connected (no tool discovery yet). */
  discoveredCapabilitiesEmpty: boolean;
  /**
   * The EFFECTIVE tool allow-list for this server (issue #350): the usage's
   * enabled_tools, falling back to the server's default_enabled_tools when
   * the usage's list is empty (see shared/mcp-enabled-tools.ts). Absent when
   * unrestricted. The Cursor SDK config cannot hide tools, so this harness
   * enforces it in the HITL hook: the restricted map is written into the
   * approval state (mcpServerEnabledTools) and non-enabled calls are denied
   * with the non-pausing "disabled" kind (see hook-script.ts).
   */
  enabledTools?: string[];
}

/**
 * Result of resolving MCP servers: Cursor SDK config for Agent.create()
 * and the full resolved server list for policy evaluation.
 */
export interface McpResolutionResult {
  cursorConfig: Record<string, CursorMcpServerConfig>;
  resolvedServers: ResolvedMcpServer[];
}

/**
 * Fetch McpServer resources for each merged usage and resolve into
 * Cursor SDK config format plus approval policies.
 *
 * Replicates the Python agent-runner's pattern:
 * 1. For each McpServerUsage, use the ref to fetch the full McpServer resource
 * 2. Extract connection config (stdio or http) from McpServerSpec
 * 3. Extract approval policies from McpServerStatus + McpServerSpec
 * 4. Transform into Cursor SDK's mcpServers config
 *
 * @param transportPosture Whether stdio servers may run here (derive via
 *        resolveMcpTransportPosture(config.mode)). A stdio server under a
 *        forbidding posture throws {@link McpTransportError} and fails the
 *        whole resolution — never degraded to a skipped server.
 */
export async function resolveMcpServers(
  client: StigmerClient,
  usages: McpServerUsage[],
  envVars: Record<string, string>,
  transportPosture: McpTransportPosture,
): Promise<McpResolutionResult> {
  const resolved: ResolvedMcpServer[] = [];

  for (const usage of usages) {
    const ref = usage.mcpServerRef;
    if (!ref?.slug) continue;

    try {
      const mcpServer = await client.getMcpServerByReference(ref);
      const serverEnv = filterEnvToDeclaredKeys(
        mcpServer.spec?.env,
        envVars,
        ref.slug,
      );
      const server = mcpServerToResolved(mcpServer, ref.slug, serverEnv, usage.enabledTools);
      if (server) {
        assertTransportAllowed(server.slug, server.connectionType, transportPosture);
        resolved.push(server);
      }
    } catch (err) {
      if (err instanceof McpTransportError) {
        // Policy rejection, not a resolution hiccup: swallowing it here
        // would mean the agent silently loses tools. Fail the execution.
        throw err;
      }
      if (err instanceof PlaceholderResolutionError) {
        console.error(
          `MCP server ${ref.org}/${ref.slug}: ${err.message}`,
        );
      } else {
        console.warn(
          `Failed to resolve MCP server ${ref.org}/${ref.slug}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return {
    cursorConfig: toCursorMcpConfig(resolved),
    resolvedServers: resolved,
  };
}

/**
 * Convert a fetched McpServer resource into our intermediate format,
 * including approval policies and discovery state.
 */
function mcpServerToResolved(
  server: McpServer,
  slug: string,
  envVars: Record<string, string>,
  usageEnabledTools?: readonly string[],
): ResolvedMcpServer | null {
  const spec = server.spec;
  if (!spec) return null;

  const status = server.status;
  const toolApprovals = status?.toolApprovals ?? [];
  const pinnedToolApprovals = spec.pinnedToolApprovals ?? [];
  const discoveredCapabilitiesEmpty = !status?.discoveredCapabilities
    || (status.discoveredCapabilities.tools.length === 0
      && status.discoveredCapabilities.resourceTemplates.length === 0);

  const base = {
    toolApprovals,
    pinnedToolApprovals,
    discoveredCapabilitiesEmpty,
    enabledTools: effectiveEnabledTools(usageEnabledTools, spec.defaultEnabledTools),
  };

  switch (spec.serverType.case) {
    case "stdio": {
      const stdio = spec.serverType.value;
      if (!stdio.command) return null;
      const resolvedArgs = stdio.args.length > 0
        ? stdio.args.map((arg, i) =>
            resolvePlaceholders(arg, envVars, `stdio arg[${i}]`),
          )
        : undefined;
      return {
        slug,
        connectionType: "stdio",
        command: stdio.command,
        args: resolvedArgs,
        env: Object.keys(envVars).length > 0 ? { ...envVars } : undefined,
        cwd: stdio.workingDir || undefined,
        ...base,
      };
    }
    case "http": {
      const http = spec.serverType.value;
      if (!http.url) return null;
      const rawHeaders = Object.keys(http.headers).length > 0 ? http.headers : undefined;
      const resolved = rawHeaders
        ? resolveHeaders(Object.fromEntries(Object.entries(rawHeaders)), envVars)
        : undefined;
      return {
        slug,
        connectionType: "http",
        url: http.url,
        headers: resolved,
        ...base,
      };
    }
    default:
      return null;
  }
}

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

/**
 * Extract MCP server slugs from session-level McpServerUsage references.
 */
export function extractMcpServerSlugs(usages: McpServerUsage[]): string[] {
  return usages
    .map((u) => u.mcpServerRef?.slug)
    .filter((s): s is string => !!s);
}

/**
 * Validate that resolved MCP servers have their required env vars populated.
 * Returns a list of warnings for servers with empty/missing env.
 * Used as a pre-flight check before agent.send() to surface config issues early.
 */
export function validateMcpServerEnv(
  servers: ResolvedMcpServer[],
  usages: McpServerUsage[],
  envVars: Record<string, string>,
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

export { PlaceholderResolutionError } from "./placeholder-resolver.js";
