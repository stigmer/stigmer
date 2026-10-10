/**
 * Resolves the MCP servers a turn's plugins carry into an intermediate
 * ResolvedMcpServer format.
 *
 * THE single resolver for both harnesses: the turn runtime's MCP phase
 * (harness/turn-context.ts, serving both adapters) and a tools listing
 * (shared/mcp-tool-listing.ts, through entryToResolved) consume it. Each
 * harness maps the result into its SDK format at the last hop:
 * toMcpClientConfig (shared/mcp-manager.ts) for LangChain,
 * toCursorMcpConfig (execute-cursor/cursor-mcp-config.ts) for the Cursor
 * SDK — so a behavioral change here (like the transport guard) lands in
 * both execution paths by construction.
 *
 * A plugin's server is named as Claude Code names it, `plugin_<plugin>_<server>`
 * (plugin-servers.ts), so a tool list written for Claude Code scopes the
 * same tools here and a hook sees the names it expects.
 *
 * Each server is filled only from its own values: the group the run's value
 * fetch answered for its plugin and name (shared/run-values.ts), plus the
 * platform-filled keys the caller hands over (the caller identity), through
 * the per-server filter over the keys the entry reads. A server the fetch
 * named no group for gets no run values. A server whose URL is not, byte for
 * byte, the URL its group was checked against is skipped for the turn with a
 * warning naming it: the server checked each login's address against that
 * URL when it handed the values over, and a value goes nowhere else.
 *
 * The one platform key filled here is STIGMER_SERVER_ADDRESS
 * (platform-server-address.ts), before the declared-key filter so the filter
 * sees the key present.
 */

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
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
import { toolServerSegment } from "./plugin-servers.js";
import { toolValuesKey, type ToolValueGroup } from "./run-values.js";

/**
 * Harness-agnostic intermediate representation of a resolved MCP server.
 * Each harness maps this into its SDK-specific format (e.g., Cursor
 * McpServerConfig, LangGraph MultiServerMCPClient config).
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
  /**
   * The plugin that brought this server and the server's key in it, or
   * `null` for the platform's own servers. Read to show a hook the server
   * as Claude Code names it (`plugin:<plugin>:<server>`,
   * `shared/hooks/tool-view.ts`) and to name a server whose value a hook
   * asks for. Deliberately REQUIRED, not optional: every construction site
   * (the synthesized attachments included) must say so.
   */
  pluginOrigin: McpPluginOrigin | null;
}

/** Where a plugin's server came from: the plugin's id and name, and the server's own key. */
export interface McpPluginOrigin {
  readonly pluginId: string;
  readonly plugin: string;
  readonly server: string;
}

export interface McpResolutionResult {
  resolvedServers: ResolvedMcpServer[];
}

/**
 * Resolve every MCP server of the turn's plugins.
 *
 * @param plugins The turn's plugins, each at the version it resolved to.
 * @param tools The run's values per tool, by {@link toolValuesKey}.
 * @param platformValues Platform-filled keys every server may read (the
 *        caller identity); authoritative over a same-named run value.
 * @param transportPosture Whether stdio servers may run here (derive via
 *        resolveMcpTransportPosture(config.mode)). A stdio server under a
 *        forbidding posture throws {@link McpTransportError} and fails the
 *        whole resolution — never degraded to a skipped server.
 * @param platformEndpoints The runner's endpoints a missing
 *        STIGMER_SERVER_ADDRESS is filled from (the runner Config satisfies
 *        it). Required so no resolution path can forget the fill.
 */
/** Two of a turn's servers would take one name; the turn cannot run them both. */
export class DuplicateServerNameError extends Error {
  constructor(name: string, first: string, second: string) {
    super(`two MCP servers of this turn would both be named '${name}' (${first} and ${second}); remove one of their plugins`);
    this.name = "DuplicateServerNameError";
  }
}

export function resolvePluginServers(
  plugins: readonly Plugin[],
  tools: ReadonlyMap<string, ToolValueGroup>,
  platformValues: Readonly<Record<string, string>>,
  transportPosture: McpTransportPosture,
  platformEndpoints: PlatformEndpoints,
): McpResolutionResult {
  const resolved: ResolvedMcpServer[] = [];
  const named = new Map<string, string>();

  for (const plugin of plugins) {
    const pluginId = plugin.metadata?.id ?? "";
    const pluginName = plugin.metadata?.name ?? "";
    for (const entry of plugin.status?.mcpServers ?? []) {
      const slug = toolServerSegment(pluginName, entry.name);
      // Two servers one name would share every table keyed by it (the
      // engines' server configs, tool lists, leases, marks, hook matchers):
      // the turn is refused rather than one silently taking the other's
      // place. Run planning refuses it first; this is the backstop.
      const holder = named.get(slug);
      if (holder !== undefined) {
        throw new DuplicateServerNameError(slug, holder, `plugin '${pluginName}' server '${entry.name}'`);
      }
      named.set(slug, `plugin '${pluginName}' server '${entry.name}'`);
      try {
        const group = tools.get(toolValuesKey(pluginId, entry.name));
        if (group !== undefined && group.url !== dialedUrlOf(entry)) {
          console.warn(
            `MCP server '${slug}' no longer dials the URL its values were checked against ` +
              "when this turn started: it is skipped for this turn. Recover the run to plan its values again.",
          );
          continue;
        }
        const serverEnv = filterEnvToDeclaredKeys(
          declaredKeysOf(entry),
          fillPlatformServerAddress(entry, slug, { ...group?.values, ...platformValues }, platformEndpoints),
          `MCP server '${slug}'`,
        );
        const server = entryToResolved(entry, slug, serverEnv, { pluginId, plugin: pluginName, server: entry.name });
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
          console.error(`MCP server '${slug}': ${err.message}`);
        } else {
          console.warn(`Failed to resolve MCP server '${slug}': ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  return { resolvedServers: resolved };
}

/**
 * How many of a turn's servers the agent and session declared: the
 * plugins' servers, the platform's own attachments excluded (the timing
 * record's `mcp_server_count`, read by benchmark/report.ts).
 */
export function declaredServerCount(servers: readonly ResolvedMcpServer[]): number {
  return servers.filter((server) => server.pluginOrigin !== null).length;
}

/** The keys a server reads, as the env filter takes them. */
export function declaredKeysOf(entry: McpServerEntry): Record<string, true> {
  return Object.fromEntries(entry.env.map((key) => [key, true as const]));
}

/** The URL a server dials: its HTTP URL, or "" for a local program. */
export function dialedUrlOf(entry: McpServerEntry): string {
  return entry.transport.case === "http" ? entry.transport.value.url : "";
}

export function entryToResolved(
  entry: McpServerEntry,
  slug: string,
  envVars: Record<string, string>,
  pluginOrigin: McpPluginOrigin | null,
): ResolvedMcpServer | null {
  switch (entry.transport.case) {
    case "stdio": {
      const stdio = entry.transport.value;
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
        pluginOrigin,
      };
    }
    case "http": {
      const http = entry.transport.value;
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
        pluginOrigin,
      };
    }
    case undefined:
      return null;
    default: {
      const exhaustive: never = entry.transport;
      return exhaustive;
    }
  }
}

export { PlaceholderResolutionError } from "./placeholder-resolver.js";
