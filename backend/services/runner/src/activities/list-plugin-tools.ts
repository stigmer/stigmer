/**
 * The tools listing's activity: lists the tools one of a plugin's MCP
 * servers offers now, as the person who asked, for the plugin page's
 * "Check tools" and `stigmer connect plugin`. Nothing is stored; the server
 * answers the list to its caller.
 *
 * The one step of the `stigmer/mcp-server/connect` workflow (its type name,
 * and this activity's, are pinned wire identifiers from before a server
 * lived inside a plugin). The activity reads the plugin through the control
 * plane, takes the named server's entry, fetches the listing's values from
 * their vaults (`VaultValueController.fetchValues`, the same fetch a turn
 * makes, answered only for the attempt's credential), and lists the
 * server's tools (shared/mcp-tool-listing.ts).
 *
 * Security: the workflow input carries only ids (the plugin, the server's
 * name, and the attempt) and the attempt's credential — no value ever
 * appears in workflow history. A listing has no conversation, so every
 * caller-identity key the server reads resolves to the anonymous sentinel:
 * a server reading them answers tools/list to anonymous callers by
 * contract.
 *
 * Activity contract:
 *   Name:   "DiscoverMcpServerCapabilities"
 *   Input:  ListPluginToolsInput
 *   Output: ListPluginToolsOutput
 */

import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { declaredKeysOf, dialedUrlOf, entryToResolved } from "../shared/mcp-resolver.js";
import { assertTransportAllowed, resolveMcpTransportPosture, type McpTransportPosture } from "../shared/mcp-transport-guard.js";
import { injectAnonymousCallerIdentityForDiscovery } from "../shared/caller-identity.js";
import {
  fillPlatformServerAddress,
  platformServerAddress,
  SERVER_ADDRESS_ENV_KEY,
  type PlatformEndpoints,
} from "../shared/platform-server-address.js";
import { toolServerSegment } from "../shared/plugin-servers.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { listServerTools } from "../shared/mcp-tool-listing.js";
import { filterEnvToDeclaredKeys } from "../shared/placeholder-resolver.js";
import { fetchRunValues, RunValuesRefusedError, toolValuesKey, type ToolValueGroup } from "../shared/run-values.js";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { Config } from "../config.js";

export interface ListPluginToolsInput {
  pluginId: string;
  /** The server's name in the plugin. */
  server: string;
  /** The listing's attempt, whose values it fetches; absent when the server reads none. */
  executionContextId?: string | null;
  /**
   * The runner credential bound to the attempt, the fetch's authority,
   * carried with the work item: the listing has no execution of its own to
   * exchange for one. Absent on an edition whose ambient connect sandbox
   * credential is bound to the attempt.
   */
  executionContextToken?: string | null;
}

export interface ListedToolResult {
  name: string;
  description: string;
  /** The tool's MCP annotation `destructiveHint === true`, and nothing else. */
  destructiveHint: boolean;
}

export interface ListPluginToolsOutput {
  tools: ListedToolResult[];
}

/**
 * Raised when the values a server reads could not be delivered to the
 * listing — the fetch was refused or failed, or answered nothing for a
 * server that requires values (issue #239). It names the root cause, credential
 * delivery, instead of its downstream symptom (an unresolved placeholder,
 * or a dial with a missing login). The message is user-facing and
 * self-contained: it survives the Temporal boundary into the server's
 * failure text.
 */
export class CredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialResolutionError";
  }
}

export interface ListPluginToolsDeps {
  stigmerClient: StigmerClient;
  /** Whether stdio servers may be started here; a cloud runner refuses one even to list its tools. */
  transportPosture: McpTransportPosture;
  /** The runner's endpoints a missing STIGMER_SERVER_ADDRESS is filled from. */
  platformEndpoints: PlatformEndpoints;
}

export async function listPluginTools(
  input: ListPluginToolsInput,
  deps: ListPluginToolsDeps,
): Promise<ListPluginToolsOutput> {
  const { pluginId, server } = input;
  console.log(`[ListPluginTools] Listing started for plugin=${pluginId} server=${server}`);

  const plugin = await deps.stigmerClient.getPlugin(pluginId);
  const entry = plugin.status?.mcpServers.find((candidate) => candidate.name === server);
  if (entry === undefined) {
    throw new Error(`plugin '${plugin.metadata?.name ?? pluginId}' has no MCP server named '${server}'`);
  }
  const slug = toolServerSegment(plugin.metadata?.name ?? "", entry.name);

  const declarations: Record<string, EnvVarDeclaration> = {};
  for (const key of entry.env) {
    const declaration = plugin.status?.env[key];
    if (declaration !== undefined) declarations[key] = declaration;
  }
  // A key the platform fills for this transport is not a credential the
  // listing must deliver, so its absence from the fetch is never a failure.
  if (platformServerAddress(entry.transport.case, deps.platformEndpoints) !== null) {
    delete declarations[SERVER_ADDRESS_ENV_KEY];
  }
  const values = await valuesForListing(
    deps.stigmerClient,
    input.executionContextId ?? null,
    input.executionContextToken ?? null,
    pluginId,
    entry,
    slug,
    declarations,
  );
  const env = injectAnonymousCallerIdentityForDiscovery(
    new Set(entry.env),
    filterEnvToDeclaredKeys(
      declaredKeysOf(entry),
      fillPlatformServerAddress(entry, slug, values, deps.platformEndpoints),
      `MCP server '${slug}'`,
    ),
  );

  const resolved = entryToResolved(entry, slug, env, { pluginId, plugin: plugin.metadata?.name ?? "", server: entry.name });
  if (!resolved) {
    throw new Error(`MCP server '${slug}' names neither a command nor a URL`);
  }
  assertTransportAllowed(resolved.slug, resolved.connectionType, deps.transportPosture);

  const tools = await listServerTools(resolved);
  console.log(`[ListPluginTools] Listed ${tools.length} tool(s) of '${slug}'`);
  return {
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, destructiveHint: tool.destructive })),
  };
}

/**
 * The listing's values, failing CLOSED when a server's required keys cannot
 * be delivered:
 * - the server refuses the fetch for a reason the person fixes (a required
 *   key in no vault the listing reads, a sign-in that cannot be renewed) →
 *   {@link CredentialResolutionError} carrying the server's sentence;
 * - a required key is expected and the fetch fails otherwise, or answers
 *   nothing for this server → {@link CredentialResolutionError};
 * - no required key → the lenient path (warn and continue): a server that
 *   reads nothing, or only optional and platform-filled keys, lists without
 *   values.
 */
async function valuesForListing(
  client: StigmerClient,
  attemptId: string | null,
  token: string | null,
  pluginId: string,
  entry: McpServerEntry,
  slug: string,
  declarations: Record<string, EnvVarDeclaration>,
): Promise<Record<string, string>> {
  const requiredKeys = Object.entries(declarations)
    .filter(([, declaration]) => !declaration.optional)
    .map(([key]) => key);
  const credentialsExpected = requiredKeys.length > 0;
  if (!attemptId) return {};

  let group: ToolValueGroup | undefined;
  try {
    const values = await fetchRunValues(client, attemptId, token ?? undefined);
    group = values.tools.get(toolValuesKey(pluginId, entry.name));
  } catch (err) {
    if (err instanceof RunValuesRefusedError) {
      throw new CredentialResolutionError(`MCP server '${slug}': ${err.message}`);
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `Could not resolve the credentials MCP server '${slug}' requires ` +
          `(${requiredKeys.join(", ")}): the listing's values could not be ` +
          `fetched (${cause}). This is a platform-side delivery failure, ` +
          `not a problem with your credentials — list the tools again, and if it ` +
          `persists, sign in or save the credentials again.`,
      );
    }
    console.warn(`[ListPluginTools] Failed to fetch the values of listing '${attemptId}': ${cause}`);
    return {};
  }

  if (group !== undefined && group.url !== dialedUrlOf(entry)) {
    throw new CredentialResolutionError(
      `MCP server '${slug}' changed its URL while its tools were being listed, so its values were not sent. List them again.`,
    );
  }
  if (group === undefined || Object.keys(group.values).length === 0) {
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `MCP server '${slug}' requires ${requiredKeys.join(", ")}, but the ` +
          `listing received no credentials. Sign in again (or save the ` +
          `credentials again) and list the tools again.`,
      );
    }
    return {};
  }
  return { ...group.values };
}

export function createListPluginToolsActivities(config: Config) {
  const stigmerClient = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    DiscoverMcpServerCapabilities: async (input: ListPluginToolsInput): Promise<ListPluginToolsOutput> => {
      activityStarted();
      // The workflow proxies this activity with a 60s heartbeatTimeout, so it
      // MUST heartbeat: a listing slower than 60s (a stdio cold start, issue
      // #243) would otherwise be killed with an opaque heartbeat timeout
      // instead of reaching the listing's actionable init-timeout errors.
      const hb = startHeartbeat(15_000, () => ({
        phase: "listing_plugin_tools",
        pluginId: input.pluginId,
        server: input.server,
      }));
      try {
        return await listPluginTools(input, {
          stigmerClient,
          transportPosture: resolveMcpTransportPosture(config.mode),
          platformEndpoints: config,
        });
      } finally {
        hb.stop();
        activityFinished();
      }
    },
  };
}
