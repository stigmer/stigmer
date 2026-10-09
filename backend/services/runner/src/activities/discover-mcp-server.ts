/**
 * DiscoverMcpServerCapabilities Temporal activity — connects to an MCP server,
 * enumerates its tools and resource templates, and returns a serializable
 * result for the connect workflow.
 *
 * The one step of the `stigmer/mcp-server/connect` workflow. The activity
 * hydrates the MCP server spec via gRPC, fetches the connect's values from
 * their vaults (`VaultValueController.fetchValues`, the same fetch a run's
 * turn makes), and connects using MultiServerMCPClient for transport
 * management.
 *
 * Each tool carries `destructiveHint`: true only when the server's own MCP
 * annotation says `destructiveHint: true`. The approval default asks before
 * such a tool and before no other MCP tool (`shared/approval-policy.ts`).
 * Annotations are untrusted (the MCP spec says so), so they are read only in
 * the direction that adds a question: `readOnlyHint` is never read, and a
 * tool marked both read-only and destructive asks. MCP's own default for an
 * unannotated tool is "destructive"; Stigmer acts only on an explicit true,
 * so a server that annotates nothing gates nothing.
 *
 * Security: Temporal input carries only IDs (mcp_server_id,
 * execution_context_id, which names the connect attempt) and the attempt's
 * credential — no secret values ever appear in workflow history. The
 * activity fetches the values when it runs, and the server answers only
 * that credential.
 *
 * Activity contract:
 *   Name:   "DiscoverMcpServerCapabilities"
 *   Input:  DiscoverMcpServerInput
 *   Output: DiscoverMcpServerOutput
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { dialedUrlOf, mcpServerToResolved, type ResolvedMcpServer } from "../shared/mcp-resolver.js";
import { toMcpClientConfig } from "../shared/mcp-manager.js";
import {
  assertTransportAllowed,
  resolveMcpTransportPosture,
  type McpTransportPosture,
} from "../shared/mcp-transport-guard.js";
import { detectOAuthChallenge } from "../shared/mcp-oauth-detect.js";
import { injectAnonymousCallerIdentityForDiscovery } from "../shared/caller-identity.js";
import {
  fillPlatformServerAddress,
  platformServerAddress,
  SERVER_ADDRESS_ENV_KEY,
  type PlatformEndpoints,
} from "../shared/platform-server-address.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { withTimeout } from "../shared/with-timeout.js";
import { fetchRunValues, RunValuesRefusedError, type ToolValueGroup } from "../shared/run-values.js";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { Config } from "../config.js";

/**
 * MCP session-init bounds, per transport (issue #239).
 *
 * A remote endpoint that accepts a connection but never completes the MCP
 * handshake would otherwise hang initialization forever: the MCP SDK's SSE
 * transport resolves only on the server's `endpoint` event, with no timer of
 * its own, and mcp-adapters silently falls back to SSE whenever the
 * streamable-HTTP POST is answered with a 4xx (monday.com's endpoint did
 * exactly this — 4xx on POST, then a silently-open SSE stream).
 *
 * HTTP endpoints get a short bound: there is nothing to install or compile,
 * so a healthy endpoint completes the handshake in seconds — a short bound is
 * what converts the silent hang into a fast, actionable failure (with room for
 * the 10s OAuth re-probe on the failure path). stdio servers keep the generous
 * bound because their first run may compile or install packages (`go run`,
 * `npx`) — the cold-start case (issue #243). The server's connect-workflow
 * run timeout sits above the stdio bound, so this file's actionable errors
 * stay reachable.
 */
const HTTP_INIT_TIMEOUT_MS = 30_000;
const STDIO_INIT_TIMEOUT_MS = 270_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverMcpServerInput {
  mcpServerId: string;
  /** The connect attempt whose values discovery fetches; absent when the server declares nothing. */
  executionContextId?: string | null;
  /**
   * The runner credential bound to the connect attempt, the fetch's
   * authority. Minted by the OSS handler and carried with the work item —
   * discovery has no execution of its own to exchange for one. Absent on
   * cloud, where the ambient connect_sandbox credential is bound to it.
   */
  executionContextToken?: string | null;
  invokerIdentityAccountId?: string | null;
}

export interface DiscoveredToolResult {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown> | null;
  /** The tool's MCP annotation `destructiveHint === true`, and nothing else (see the file header). */
  destructiveHint: boolean;
}

export interface DiscoveredResourceTemplateResult {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface DiscoverMcpServerOutput {
  tools: DiscoveredToolResult[];
  resourceTemplates: DiscoveredResourceTemplateResult[];
}

/**
 * Raised when the credentials a server declares could not be delivered to
 * discovery — the value fetch was refused or failed, or answered nothing for
 * a server that requires values (issue #239).
 *
 * Exists because the alternative is strictly worse: proceeding without the
 * declared credentials either dies later as an opaque
 * PlaceholderResolutionError (when a header/arg templates the missing var) or
 * dials the endpoint with a garbage credential and strands the connect in the
 * 4xx → SSE-fallback limbo this file's init bounds exist to contain. Failing
 * here names the ROOT cause — credential delivery — instead of its downstream
 * symptom. The message is user-facing and self-contained: it survives the
 * Temporal boundary and the Go/Java connect wrappers include it in the
 * user-facing failure text.
 */
export class CredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialResolutionError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Discovery Logic (no Temporal coupling)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverDeps {
  stigmerClient: StigmerClient;
  /**
   * Whether stdio servers may be spawned here (derive via
   * resolveMcpTransportPosture(config.mode)). Discovery spawns the same
   * subprocess an execution would, so it enforces the same
   * local-runner-only rule — a cloud runner refuses stdio even for
   * tool enumeration.
   */
  transportPosture: McpTransportPosture;
  /**
   * The runner's endpoints a missing STIGMER_SERVER_ADDRESS is filled from
   * (the runner Config satisfies it) — the same fill execution applies, so
   * discovery dials what the run will dial.
   */
  platformEndpoints: PlatformEndpoints;
}

export async function discoverMcpServer(
  input: DiscoverMcpServerInput,
  deps: DiscoverDeps,
): Promise<DiscoverMcpServerOutput> {
  const { mcpServerId, executionContextId, executionContextToken } = input;
  const { stigmerClient } = deps;

  console.log(
    `[DiscoverMcpServer] Discovery started for mcp_server_id=${mcpServerId}`,
  );

  const mcpServer = await stigmerClient.getMcpServer(mcpServerId);
  if (!mcpServer?.spec) {
    throw new Error(
      `MCP server '${mcpServerId}' not found or has no spec`,
    );
  }

  const slug = mcpServer.metadata?.slug || mcpServerId;

  const declaredEnv = mcpServer.spec.env ?? {};
  // A key the platform fills for this transport is not a credential the
  // connect must deliver, so its absence from the fetch is never a failure.
  const platformFillsAddress =
    platformServerAddress(mcpServer.spec.serverType.case, deps.platformEndpoints) !== null;
  const credentialDeclarations = platformFillsAddress
    ? Object.fromEntries(
        Object.entries(declaredEnv).filter(([key]) => key !== SERVER_ADDRESS_ENV_KEY),
      )
    : declaredEnv;
  const envVars = await resolveEnvVarsForDiscovery(
    stigmerClient,
    executionContextId ?? null,
    executionContextToken ?? null,
    mcpServer,
    slug,
    credentialDeclarations,
  );

  const declaredEnvKeys = new Set(Object.keys(declaredEnv));
  const platformEnv = fillPlatformServerAddress(mcpServer, envVars, deps.platformEndpoints);

  // Discovery runs with no session, so every declared caller-identity key
  // resolves to the anonymous sentinel — without it, a server templating
  // ${STIGMER_CALLER_IDENTITY_VALUE} in its headers would fail discovery
  // with PlaceholderResolutionError and its tools would never be
  // discovered. Servers consuming these keys answer tools/list to
  // anonymous callers by contract.
  const finalEnv = injectAnonymousCallerIdentityForDiscovery(
    declaredEnvKeys,
    platformEnv,
  );

  const resolved = mcpServerToResolved(mcpServer, slug, finalEnv);
  if (!resolved) {
    throw new Error(
      `MCP server '${slug}' has no valid server type configured ` +
      `(must specify either 'stdio' or 'http' in the spec)`,
    );
  }

  assertTransportAllowed(resolved.slug, resolved.connectionType, deps.transportPosture);

  const connectionConfig = toMcpClientConfig([resolved]);
  const { tools, resourceTemplates } = await connectAndDiscover(
    slug,
    connectionConfig,
    resolved,
  );

  console.log(
    `[DiscoverMcpServer] Discovery complete for '${slug}': ` +
    `${tools.length} tool(s), ${resourceTemplates.length} resource template(s)`,
  );

  return { tools, resourceTemplates };
}

// ─────────────────────────────────────────────────────────────────────────────
// Env Var Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the discovery env from the connect's values, failing CLOSED when a
 * server's declared credentials cannot be delivered.
 *
 * The fetch answers the values grouped by declarer; discovery takes its own
 * server's group and nothing else, and only while the server still dials
 * the URL the group was checked against.
 *
 * - The server refuses the fetch for a reason the person fixes (a required
 *   key in no vault the connect reads, a sign-in that cannot be renewed) →
 *   {@link CredentialResolutionError} carrying the server's sentence.
 * - Credentials expected (the server declares a NON-OPTIONAL env var) and
 *   the fetch fails otherwise, or answers nothing for this server →
 *   {@link CredentialResolutionError}: a delivery failure, never a normal
 *   state. Limping ahead was issue #239's failure mode: discovery died
 *   later as an opaque PlaceholderResolutionError or a doomed dial.
 * - No non-optional declarations → the lenient path (warn and continue):
 *   servers declaring nothing (or only optional/injected keys like the
 *   caller-identity family) legitimately discover without values. A
 *   STIGMER_SERVER_ADDRESS the platform fills for the server's transport is
 *   left out of the count by the caller (platform-server-address.ts).
 */
async function resolveEnvVarsForDiscovery(
  client: StigmerClient,
  connectId: string | null,
  connectToken: string | null,
  mcpServer: McpServer,
  slug: string,
  declaredEnv: Record<string, EnvVarDeclaration>,
): Promise<Record<string, string>> {
  const requiredKeys = Object.entries(declaredEnv)
    .filter(([, decl]) => !decl.optional)
    .map(([key]) => key);
  const credentialsExpected = requiredKeys.length > 0;

  if (!connectId) return {};

  let group: ToolValueGroup | undefined;
  try {
    // The payload-carried token authenticates the fetch on OSS (oss#535);
    // undefined on cloud, where the ambient credential applies instead.
    const values = await fetchRunValues(client, connectId, connectToken ?? undefined);
    group = values.tools.get(mcpServer.metadata?.id ?? "");
  } catch (err) {
    if (err instanceof RunValuesRefusedError) {
      throw new CredentialResolutionError(`MCP server '${slug}': ${err.message}`);
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `Could not resolve the credentials MCP server '${slug}' requires ` +
        `(${requiredKeys.join(", ")}): the connect's values could not be ` +
        `fetched (${cause}). This is a platform-side delivery failure, ` +
        `not a problem with your credentials — retry the connect, and if it ` +
        `persists, re-run the sign-in or save the credentials again.`,
      );
    }
    console.warn(`[DiscoverMcpServer] Failed to fetch the values of connect '${connectId}': ${cause}`);
    return {};
  }

  if (group !== undefined && group.url !== dialedUrlOf(mcpServer)) {
    throw new CredentialResolutionError(
      `MCP server '${slug}' changed its URL while it was connecting, so its values were not sent. Connect again.`,
    );
  }
  if (group === undefined || Object.keys(group.values).length === 0) {
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `MCP server '${slug}' requires ${requiredKeys.join(", ")}, but the ` +
        `connect delivered no credentials. Sign in again (or save the ` +
        `credentials again) and connect again.`,
      );
    }
    return {};
  }

  console.log(
    `[DiscoverMcpServer] Fetched ${Object.keys(group.values).length} value(s) ` +
    `for connect '${connectId}'`,
  );
  return { ...group.values };
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Connection + Enumeration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pick the session-init bound for a resolved server's transport.
 *
 * Exported for tests; pure so the timeout choice (the load-bearing half of
 * the issue-#239 fix) can be pinned without wiring a slow clock.
 */
export function initTimeoutMsFor(connectionType: ResolvedMcpServer["connectionType"]): number {
  return connectionType === "stdio" ? STDIO_INIT_TIMEOUT_MS : HTTP_INIT_TIMEOUT_MS;
}

/**
 * The user-facing message for a session-init timeout. Names the endpoint (or
 * command) so the failure is diagnosable from the message alone, and explains
 * the known silent-hang shape for HTTP endpoints — issue #239's mechanism.
 */
export function initTimeoutMessageFor(slug: string, resolved: ResolvedMcpServer): string {
  const seconds = Math.round(initTimeoutMsFor(resolved.connectionType) / 1000);
  if (resolved.connectionType === "stdio") {
    return (
      `MCP server '${slug}' (command: ${resolved.command}) did not complete ` +
      `MCP initialization within ${seconds}s. If this server requires ` +
      `compilation or package installation on first run (e.g. go run, npx), ` +
      `the cold start may have exceeded the discovery timeout.`
    );
  }
  return (
    `MCP server '${slug}' at ${resolved.url} did not complete MCP ` +
    `initialization within ${seconds}s. The endpoint accepted the connection ` +
    `but never finished the handshake — commonly an endpoint that rejects ` +
    `streamable HTTP while leaving its SSE fallback stream silently open. ` +
    `Verify the URL points at a live streamable-HTTP MCP endpoint.`
  );
}

async function connectAndDiscover(
  slug: string,
  connectionConfig: ReturnType<typeof toMcpClientConfig>,
  resolved: ResolvedMcpServer,
): Promise<{
  tools: DiscoveredToolResult[];
  resourceTemplates: DiscoveredResourceTemplateResult[];
}> {
  const client = new MultiServerMCPClient(connectionConfig);
  const tools: DiscoveredToolResult[] = [];
  const resourceTemplates: DiscoveredResourceTemplateResult[] = [];

  try {
    await withTimeout(
      initTimeoutMsFor(resolved.connectionType),
      () => initTimeoutMessageFor(slug, resolved),
      async () => {
      await client.initializeConnections();

      const mcpClient = await client.getClient(slug);
      if (!mcpClient) {
        throw new Error(
          `Failed to get MCP client for server '${slug}' after initialization`,
        );
      }

      const toolsResult = await mcpClient.listTools();
      for (const tool of toolsResult.tools) {
        tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema
            ? (tool.inputSchema as Record<string, unknown>)
            : null,
          destructiveHint: tool.annotations?.destructiveHint === true,
        });
      }

      try {
        const capabilities = mcpClient.getServerCapabilities();
        if (capabilities?.resources) {
          const templatesResult = await mcpClient.listResourceTemplates();
          for (const tpl of templatesResult.resourceTemplates) {
            resourceTemplates.push({
              uriTemplate: tpl.uriTemplate,
              name: tpl.name,
              description: tpl.description ?? "",
              mimeType: tpl.mimeType ?? "",
            });
          }
        }
      } catch (err) {
        console.warn(
          `[DiscoverMcpServer] Server '${slug}' does not support ` +
          `resource templates: ${err instanceof Error ? err.message : err}`,
        );
      }
    });
  } catch (err) {
    // The MCP client surfaces a 401 OAuth challenge as an opaque aggregate
    // ("unhandled errors in a TaskGroup"). For HTTP servers, re-probe once to
    // see if the endpoint is actually asking for OAuth and, if so, replace the
    // useless error with an actionable one. Non-OAuth failures rethrow as-is.
    const oauthError = await classifyHttpOAuthFailure(slug, connectionConfig);
    if (oauthError) throw oauthError;
    throw err;
  } finally {
    await client.close().catch((err: unknown) => {
      console.warn(
        `[DiscoverMcpServer] Error closing MCP client for '${slug}': ` +
        `${err instanceof Error ? err.message : err}`,
      );
    });
  }

  return { tools, resourceTemplates };
}

/**
 * If the server uses HTTP transport, probe its endpoint to classify a discovery
 * failure as an OAuth challenge. Returns the actionable error to throw, or
 * `null` for stdio servers and non-OAuth failures (caller rethrows original).
 */
async function classifyHttpOAuthFailure(
  slug: string,
  connectionConfig: ReturnType<typeof toMcpClientConfig>,
): Promise<Error | null> {
  const connection = connectionConfig[slug];
  if (!connection || connection.transport !== "http" || !connection.url) {
    return null;
  }
  return detectOAuthChallenge(connection.url, connection.headers, slug);
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Activity Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createDiscoverMcpServerActivities(config: Config) {
  const stigmerClient = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    tokenRef: config.stigmerTokenRef,
    runnerTokenRef: config.stigmerRunnerTokenRef,
  });

  return {
    DiscoverMcpServerCapabilities: async (
      input: DiscoverMcpServerInput,
    ): Promise<DiscoverMcpServerOutput> => {
      activityStarted();
      // The connect workflow proxies this activity with a 60s heartbeatTimeout,
      // so it MUST heartbeat: before this loop existed, any discovery slower
      // than 60s (stdio cold start — issue #243) or wedged on a silent remote
      // (issue #239) was killed by Temporal with an opaque heartbeat timeout
      // instead of reaching this file's actionable init-timeout errors.
      const hb = startHeartbeat(15_000, () => ({
        phase: "discovering_mcp_server",
        mcpServerId: input.mcpServerId,
      }));
      try {
        return await discoverMcpServer(input, {
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
