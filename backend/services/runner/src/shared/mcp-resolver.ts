/**
 * Resolves Stigmer McpServerUsage references into an intermediate
 * ResolvedMcpServer format.
 *
 * Consumers: the deep-agent harness (execute-deep-agent/setup.ts), the
 * connect backfill (shared/connect-backfill.ts), and the discovery
 * activity (activities/discover-mcp-server.ts, via mcpServerToResolved).
 * NOTE: the Cursor harness does NOT use this module — it has its own
 * near-duplicate resolver at activities/execute-cursor/mcp-resolver.ts.
 * A behavioral change here (like the transport guard) must be mirrored
 * there until the two are consolidated.
 */

import type { McpServerUsage, ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  assertTransportAllowed,
  McpTransportError,
  type McpTransportPosture,
} from "./mcp-transport-guard.js";
import {
  resolveHeaders,
  resolvePlaceholders,
  filterEnvToDeclaredKeys,
  PlaceholderResolutionError,
} from "./placeholder-resolver.js";
import { effectiveEnabledTools } from "./mcp-enabled-tools.js";

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
  /**
   * The EFFECTIVE tool allow-list for this server (issue #350): the usage's
   * enabled_tools, falling back to the server's default_enabled_tools when
   * the usage's list is empty (see shared/mcp-enabled-tools.ts). Absent when
   * unrestricted — which keeps synthesized attachment servers (built without
   * a usage) and the discovery path unfiltered by construction. Enforced at
   * connect time by connectMcpServers (shared/mcp-manager.ts).
   */
  enabledTools?: string[];
  /**
   * Layer-3 per-agent approval overrides from the usage that resolved this
   * server (issue #349): riding the resolved server is what SCOPES an
   * override to its own server — a flat cross-server list is how an
   * override once leaked onto (or silently un-gated) a same-named tool on
   * another server. Deliberately REQUIRED, not optional: empty means "no
   * overrides", and every construction site — including the near-duplicate
   * Cursor resolver and the synthesized attachments, which have no usage
   * and therefore no layer 3 — must say so explicitly, so a forgotten
   * mirror cannot compile. Consumed by mergeApprovalPolicies
   * (shared/approval-policy.ts).
   */
  toolApprovalOverrides: ToolApprovalOverride[];
}

export interface McpResolutionResult {
  resolvedServers: ResolvedMcpServer[];
}

/**
 * Fetch McpServer resources and resolve into intermediate format.
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
      const server = mcpServerToResolved(
        mcpServer,
        ref.slug,
        serverEnv,
        usage.enabledTools,
        usage.toolApprovalOverrides ?? [],
      );
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

  return { resolvedServers: resolved };
}

export function mcpServerToResolved(
  server: McpServer,
  slug: string,
  envVars: Record<string, string>,
  usageEnabledTools?: readonly string[],
  usageToolApprovalOverrides: ToolApprovalOverride[] = [],
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
    // Callers without a usage (the discovery activity) pass nothing, so the
    // default_enabled_tools fallback still applies but a per-agent
    // restriction cannot: discovery must see the server's full toolset.
    enabledTools: effectiveEnabledTools(usageEnabledTools, spec.defaultEnabledTools),
    // Same no-usage rule for layer 3: discovery has no agent context, so no
    // per-agent overrides exist — defaulting to [] keeps that structural.
    toolApprovalOverrides: usageToolApprovalOverrides,
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

/**
 * Merge MCP server usages from agent (base) and session (overlay).
 *
 * Replicates session_context_merge.py::merge_mcp_server_usages():
 * - Agent-level usages are the base set
 * - Session-level usages extend or override by mcp_server_ref.slug
 * - If both reference the same slug, session-level takes precedence —
 *   the WHOLE usage, including enabled_tools and approval overrides
 *
 * Shared by both harnesses (blueprint-resolver.ts for Cursor,
 * execute-deep-agent/setup.ts for the native harness) so a duplicate slug
 * resolves identically everywhere: exactly one usage per server, whose
 * enabled_tools is the one the enforcement filter honors.
 */
export function mergeMcpServerUsages(
  agentUsages: McpServerUsage[],
  sessionUsages: McpServerUsage[],
): McpServerUsage[] {
  const bySlug = new Map<string, McpServerUsage>();

  for (const usage of agentUsages) {
    const slug = usage.mcpServerRef?.slug;
    if (slug) bySlug.set(slug, usage);
  }

  for (const usage of sessionUsages) {
    const slug = usage.mcpServerRef?.slug;
    if (slug) bySlug.set(slug, usage);
  }

  return [...bySlug.values()];
}

export { PlaceholderResolutionError } from "./placeholder-resolver.js";
