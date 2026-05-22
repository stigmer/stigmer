/**
 * Resolves Stigmer McpServerUsage references into an intermediate
 * ResolvedMcpServer format that is harness-agnostic.
 *
 * Both ExecuteCursor and ExecuteDeepAgent need MCP server connection info
 * and tool approval policies. This module provides the common resolution
 * logic; each harness maps ResolvedMcpServer into its SDK-specific format.
 */

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  resolveHeaders,
  resolvePlaceholders,
  filterEnvToDeclaredKeys,
  PlaceholderResolutionError,
} from "./placeholder-resolver.js";

/**
 * Harness-agnostic intermediate representation of a resolved MCP server.
 * Contains connection info and approval policies. Each harness maps this
 * into its SDK-specific format (e.g., Cursor McpServerConfig, LangGraph
 * MultiServerMCPClient config).
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
  toolApprovals: ToolApprovalPolicy[];
  pinnedToolApprovals: ToolApprovalPolicy[];
  discoveredCapabilitiesEmpty: boolean;
}

export interface McpResolutionResult {
  resolvedServers: ResolvedMcpServer[];
}

/**
 * Fetch McpServer resources and resolve into intermediate format.
 */
export async function resolveMcpServers(
  client: StigmerClient,
  usages: McpServerUsage[],
  envVars: Record<string, string> = {},
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
      const server = mcpServerToResolved(mcpServer, ref.slug, serverEnv);
      if (server) resolved.push(server);
    } catch (err) {
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

  return { resolvedServers: resolved };
}

export function mcpServerToResolved(
  server: McpServer,
  slug: string,
  envVars: Record<string, string>,
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

export function extractMcpServerSlugs(usages: McpServerUsage[]): string[] {
  return usages
    .map((u) => u.mcpServerRef?.slug)
    .filter((s): s is string => !!s);
}

export { PlaceholderResolutionError } from "./placeholder-resolver.js";
