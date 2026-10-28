/**
 * Resolves the MCP servers a turn's agent writes and its plugins carry into
 * an intermediate ResolvedMcpServer format.
 *
 * THE single resolver for both harnesses: the turn runtime's MCP phase
 * (harness/turn-context.ts, serving both adapters) and a tools listing
 * (shared/mcp-tool-listing.ts, through entryToResolved) consume it. Each
 * harness maps the result into its SDK format at the last hop:
 * toMcpClientConfig (shared/mcp-manager.ts) for LangChain, the host's
 * bridge (execute-claude/mcp-bridge.ts) for the Claude engine — so a
 * behavioral change here (like the transport guard) lands in both
 * execution paths by construction.
 *
 * A plugin's server is named as Claude Code names it, `plugin_<plugin>_<server>`
 * (plugin-servers.ts), so a tool list written for Claude Code scopes the
 * same tools here and a hook sees the names it expects. A server the agent
 * writes itself is named by its own name, as Claude Code names a server
 * added directly (`mcp__<name>__<tool>`), and read as a plugin entry
 * (agent-servers.ts), so both go through one loop: the URL check, the
 * declared-key filter, the platform address fill, the transport guard.
 *
 * Every resolved server records its home (`McpServerHome`): the plugin it
 * is part of, the agent that writes it, or the platform for the runner's
 * own attachments. Every reader that tells them apart (the tool listing,
 * the hooks' names, the platform set, the server count) switches on it.
 *
 * Each server is filled only from its own values: the group the run's value
 * fetch answered for its home and name (shared/run-values.ts), plus the
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

import type { AgentMcpServer } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
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
import { agentServerEntry } from "./agent-servers.js";
import { fillPlatformServerAddress, type PlatformEndpoints } from "./platform-server-address.js";
import { toolServerSegment } from "./plugin-servers.js";
import { toolValuesKey, type ToolValueGroup } from "./run-values.js";

/**
 * Harness-agnostic intermediate representation of a resolved MCP server.
 * Each harness maps this into its SDK-specific format (e.g., LangGraph
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
  /**
   * Whose server this is: a plugin's, an agent's own, or the platform's.
   * Read to show a hook the server as Claude Code names it
   * (`shared/hooks/tool-view.ts`), to name a server whose value a hook asks
   * for, and to tell the platform's servers from every other. Deliberately
   * REQUIRED: every construction site (the synthesized attachments
   * included) must say so.
   */
  home: McpServerHome;
}

/**
 * Where a turn's server comes from: a plugin (its id and name, and the
 * server's key in it), an agent that writes it (its id, the subagent's name
 * in the turn or `null` for the turn's own agent, and the server's name),
 * or the platform (the runner's own attachments).
 */
export type McpServerHome =
  | { readonly kind: "plugin"; readonly pluginId: string; readonly plugin: string; readonly server: string }
  | { readonly kind: "agent"; readonly agentId: string; readonly subagent: string | null; readonly server: string }
  | { readonly kind: "platform" };

/** A server's home in a sentence, for the refusals that name two servers. */
export function describeServerHome(home: McpServerHome, slug: string): string {
  switch (home.kind) {
    case "plugin":
      return `plugin '${home.plugin}' server '${home.server}'`;
    case "agent":
      return home.subagent === null
        ? `the agent's own server '${home.server}'`
        : `subagent '${home.subagent}''s own server '${home.server}'`;
    case "platform":
      return `the platform's server '${slug}'`;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = home;
      return exhaustive;
    }
  }
}

/** Whether two homes are one: the same plugin's or agent's server of one name, or both the platform's. */
export function sameServerHome(a: McpServerHome, b: McpServerHome): boolean {
  switch (a.kind) {
    case "plugin":
      return b.kind === "plugin" && a.pluginId === b.pluginId && a.server === b.server;
    case "agent":
      return b.kind === "agent" && a.agentId === b.agentId && a.server === b.server;
    case "platform":
      return b.kind === "platform";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

/** The platform's own servers among `servers`, by slug: the one answer to "is this the platform's?". */
export function platformServerSlugsOf(servers: readonly ResolvedMcpServer[]): ReadonlySet<string> {
  return new Set(servers.filter((server) => server.home.kind === "platform").map((server) => server.slug));
}

export interface McpResolutionResult {
  resolvedServers: ResolvedMcpServer[];
}

/** Two of a turn's servers would take one name; the turn cannot run them both. */
export class DuplicateServerNameError extends Error {
  constructor(name: string, first: string, second: string) {
    super(`two MCP servers of this turn would both be named '${name}' (${first} and ${second}); remove or rename one of them`);
    this.name = "DuplicateServerNameError";
  }
}

/** The agent whose own servers a resolution reads: its id, its name as a subagent (`null` for the turn's agent), its servers. */
export interface TurnServerAgent {
  readonly agentId: string;
  readonly subagent: string | null;
  readonly servers: readonly AgentMcpServer[];
}

/**
 * One server before resolution: its home, its name in the turn, the key of
 * its values group, and its entry as read with that group's values (an
 * agent's server takes its login header only when a login arrived).
 */
interface TurnServerSource {
  readonly home: Exclude<McpServerHome, { kind: "platform" }>;
  readonly slug: string;
  readonly valuesKey: string;
  readonly entryWith: (values: Readonly<Record<string, string>> | undefined) => McpServerEntry;
}

/** The servers to resolve: the agent's own first, then each plugin's. */
function turnServerSources(agent: TurnServerAgent | undefined, plugins: readonly Plugin[]): TurnServerSource[] {
  const sources: TurnServerSource[] = [];
  for (const server of agent?.servers ?? []) {
    sources.push({
      home: { kind: "agent", agentId: agent!.agentId, subagent: agent!.subagent, server: server.name },
      slug: server.name,
      valuesKey: toolValuesKey("agent", agent!.agentId, server.name),
      entryWith: (values) => agentServerEntry(server, values),
    });
  }
  for (const plugin of plugins) {
    const pluginId = plugin.metadata?.id ?? "";
    const pluginName = plugin.metadata?.name ?? "";
    for (const entry of plugin.status?.mcpServers ?? []) {
      sources.push({
        home: { kind: "plugin", pluginId, plugin: pluginName, server: entry.name },
        slug: toolServerSegment(pluginName, entry.name),
        valuesKey: toolValuesKey("plugin", pluginId, entry.name),
        entryWith: () => entry,
      });
    }
  }
  return sources;
}

/**
 * Resolve every MCP server of one agent of the turn: the servers it writes
 * itself, then its plugins'.
 *
 * @param input.agent The agent whose own servers to resolve; undefined for
 *        the built-in assistant.
 * @param input.plugins Its plugins, each at the version it resolved to.
 * @param input.tools The run's values per tool, by {@link toolValuesKey}.
 * @param input.platformValues Platform-filled keys every server may read
 *        (the caller identity); authoritative over a same-named run value.
 * @param input.transportPosture Whether stdio servers may run here (derive
 *        via resolveMcpTransportPosture(config.mode)). A stdio server under a
 *        forbidding posture throws {@link McpTransportError} and fails the
 *        whole resolution — never degraded to a skipped server.
 * @param input.platformEndpoints The runner's endpoints a missing
 *        STIGMER_SERVER_ADDRESS is filled from (the runner Config satisfies
 *        it). Required so no resolution path can forget the fill.
 */
export function resolveTurnServers(input: {
  readonly agent: TurnServerAgent | undefined;
  readonly plugins: readonly Plugin[];
  readonly tools: ReadonlyMap<string, ToolValueGroup>;
  readonly platformValues: Readonly<Record<string, string>>;
  readonly transportPosture: McpTransportPosture;
  readonly platformEndpoints: PlatformEndpoints;
}): McpResolutionResult {
  const resolved: ResolvedMcpServer[] = [];
  const named = new Map<string, string>();

  for (const { home, slug, valuesKey, entryWith } of turnServerSources(input.agent, input.plugins)) {
    // Two servers one name would share every table keyed by it (the
    // engines' server configs, tool lists, leases, marks, hook matchers):
    // the turn is refused rather than one silently taking the other's
    // place. Run planning refuses it first; this is the backstop.
    const holder = named.get(slug);
    if (holder !== undefined) {
      throw new DuplicateServerNameError(slug, holder, describeServerHome(home, slug));
    }
    named.set(slug, describeServerHome(home, slug));
    try {
      const group = input.tools.get(valuesKey);
      const entry = entryWith(group?.values);
      if (group !== undefined && group.url !== dialedUrlOf(entry)) {
        console.warn(
          `MCP server '${slug}' no longer dials the URL its values were checked against ` +
            "when this turn started: it is skipped for this turn. Recover the run to plan its values again.",
        );
        continue;
      }
      const serverEnv = filterEnvToDeclaredKeys(
        declaredKeysOf(entry),
        fillPlatformServerAddress(entry, slug, { ...group?.values, ...input.platformValues }, input.platformEndpoints),
        `MCP server '${slug}'`,
      );
      const server = entryToResolved(entry, slug, serverEnv, home);
      if (server) {
        assertTransportAllowed(server.slug, server.connectionType, input.transportPosture);
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

  return { resolvedServers: resolved };
}

/**
 * How many of a turn's servers the agent and session declared: the
 * agent's own and the plugins', the platform's own attachments excluded
 * (the timing record's `mcp_server_count`, read by benchmark/report.ts).
 */
export function declaredServerCount(servers: readonly ResolvedMcpServer[]): number {
  return servers.filter((server) => server.home.kind !== "platform").length;
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
  home: McpServerHome,
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
        home,
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
        home,
      };
    }
    case undefined:
      return null;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over the transport oneof; a decoded entry's case is one of the arms above or undefined */
    default: {
      const exhaustive: never = entry.transport;
      return exhaustive;
    }
  }
}

export { PlaceholderResolutionError } from "./placeholder-resolver.js";
