/**
 * Resolves Stigmer McpServerUsage references into an intermediate
 * ResolvedMcpServer format.
 *
 * THE single resolver for both harnesses (oss#387 retired the Cursor
 * harness's near-duplicate): the turn runtime's MCP phase
 * (harness/turn-context.ts, serving both adapters), the connect backfill
 * (shared/connect-backfill.ts), and the discovery activity
 * (activities/discover-mcp-server.ts, via mcpServerToResolved) all consume
 * it. Each harness maps the result into its SDK format at the last hop:
 * toMcpClientConfig (shared/mcp-manager.ts) for LangChain,
 * toCursorMcpConfig (execute-cursor/cursor-mcp-config.ts) for the Cursor
 * SDK — so a behavioral change here (like the transport guard) lands in
 * both execution paths by construction.
 *
 * The one platform key filled here is STIGMER_SERVER_ADDRESS
 * (platform-server-address.ts), before the declared-key filter so the filter
 * sees the key present; discovery applies the same fill itself because it
 * resolves a single server without a usage.
 */

import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
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
import { fillPlatformServerAddress, type PlatformEndpoints } from "./platform-server-address.js";

/**
 * Harness-agnostic intermediate representation of a resolved MCP server.
 * Contains connection info and the tools its server marks destructive. Each harness maps this
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
  discoveredCapabilitiesEmpty: boolean;
  /**
   * The tools its server marks destructive (`DiscoveredTool.destructive_hint`,
   * recorded at connect from the tool's MCP annotation): the MCP half of the
   * approval default (`buildMcpApprovalDefault`, shared/approval-policy.ts).
   * Deliberately REQUIRED, not optional: every construction site — the
   * synthesized attachments included, which mark nothing — must say so, so a
   * forgotten site cannot compile.
   */
  destructiveTools: readonly string[];
  /**
   * The tool names the server's last discovery reported, or `null` when it
   * was never discovered. Read only to tell whether a tool-level list entry
   * (`mcp__<slug>__<tool>`) names a tool the turn has; the live toolset is
   * what the engine binds.
   */
  discoveredToolNames: readonly string[] | null;
  /**
   * Every run value this server claims: the keys its `spec.env` declares
   * and its OAuth token's target variable. The agent's shell never
   * receives one (shared/shell-env.ts), even though
   * agent save copies them into the agent's own `env`. REQUIRED for the
   * same reason as {@link destructiveTools}: a synthesized server declares
   * none and says so.
   */
  declaredEnvKeys: readonly string[];
  /**
   * The plugin that brought this server, and the server's key in that
   * plugin, or `null` for any other server. Read only to show a hook the
   * name Claude Code gives a plugin's own server
   * (`mcp__plugin_<plugin>_<server>__<tool>`, `shared/hooks/tool-view.ts`).
   * REQUIRED for the same reason as {@link destructiveTools}.
   */
  pluginOrigin: McpPluginOrigin | null;
}

/** Where a plugin-installed server came from: the plugin's id (its member label) and the server's own key. */
export interface McpPluginOrigin {
  readonly pluginId: string;
  readonly server: string;
}

/**
 * The label an installed plugin stamps on every member it materialises,
 * carrying the plugin's id (the server's `PLUGIN_LABEL`,
 * `backend/services/stigmer-server/src/pipeline/apiresource-labels.ts`).
 */
export const PLUGIN_MEMBER_LABEL = "stigmer.ai/plugin";

/** A server's plugin origin, from its member label and its own name. */
export function pluginOriginOf(server: McpServer): McpPluginOrigin | null {
  const pluginId = server.metadata?.labels?.[PLUGIN_MEMBER_LABEL] ?? "";
  const name = server.metadata?.name ?? "";
  return pluginId !== "" && name !== "" ? { pluginId, server: name } : null;
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
 * @param platformEndpoints The runner's endpoints a missing
 *        STIGMER_SERVER_ADDRESS is filled from (the runner Config satisfies
 *        it). Required so no resolution path can forget the fill.
 */
export async function resolveMcpServers(
  client: StigmerClient,
  usages: McpServerUsage[],
  envVars: Record<string, string>,
  transportPosture: McpTransportPosture,
  platformEndpoints: PlatformEndpoints,
): Promise<McpResolutionResult> {
  const resolved: ResolvedMcpServer[] = [];

  for (const usage of usages) {
    const ref = usage.mcpServerRef;
    if (!ref?.slug) continue;

    try {
      const mcpServer = await client.getMcpServerByReference(ref);
      const serverEnv = filterEnvToDeclaredKeys(
        mcpServer.spec?.env,
        fillPlatformServerAddress(mcpServer, envVars, platformEndpoints),
        `MCP server '${ref.slug}'`,
      );
      const server = mcpServerToResolved(mcpServer, ref.slug, serverEnv);
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

/** The run values a server claims: its declared keys and its OAuth token's target. */
export function declaredEnvKeysOf(server: McpServer): string[] {
  const keys = new Set(Object.keys(server.spec?.env ?? {}));
  const oauthTarget = server.spec?.auth?.targetEnvVar ?? "";
  if (oauthTarget !== "") {
    keys.add(oauthTarget);
  }
  return [...keys];
}

export function mcpServerToResolved(
  server: McpServer,
  slug: string,
  envVars: Record<string, string>,
): ResolvedMcpServer | null {
  const spec = server.spec;
  if (!spec) return null;

  const discovered = server.status?.discoveredCapabilities;
  const discoveredCapabilitiesEmpty = !discovered
    || (discovered.tools.length === 0 && discovered.resourceTemplates.length === 0);

  const base = {
    discoveredCapabilitiesEmpty,
    destructiveTools: (discovered?.tools ?? []).filter((t) => t.destructiveHint).map((t) => t.name),
    discoveredToolNames: discovered ? discovered.tools.map((t) => t.name) : null,
    declaredEnvKeys: declaredEnvKeysOf(server),
    pluginOrigin: pluginOriginOf(server),
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
 * Merge MCP server usages from agent (base) and session (overlay).
 *
 * Replicates session_context_merge.py::merge_mcp_server_usages():
 * - Agent-level usages are the base set
 * - Session-level usages extend or override by mcp_server_ref.slug
 * - If both reference the same slug, they name the same server once
 *
 * Shared by both harnesses (through blueprint-resolver.ts, the turn
 * runtime's blueprint phase) so a duplicate slug resolves identically
 * everywhere: exactly one usage per server.
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
