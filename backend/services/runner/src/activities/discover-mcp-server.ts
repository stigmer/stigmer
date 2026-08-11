/**
 * DiscoverMcpServerCapabilities Temporal activity — connects to an MCP server,
 * enumerates its tools and resource templates, and returns a serializable
 * result for the connect workflow.
 *
 * Part of the `stigmer/mcp-server/connect` workflow: runs as step 1 before
 * ClassifyToolApprovals. The activity hydrates the MCP server spec via gRPC,
 * resolves environment variables from a pre-created ExecutionContext, and
 * connects using MultiServerMCPClient for transport management.
 *
 * Security: Temporal input carries only IDs (mcp_server_id,
 * execution_context_id) — no secret values ever appear in workflow history.
 * The activity resolves secrets from the backend-created ExecutionContext.
 *
 * Activity contract:
 *   Name:   "DiscoverMcpServerCapabilities"
 *   Input:  DiscoverMcpServerInput
 *   Output: DiscoverMcpServerOutput
 */

import { createHash } from "node:crypto";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { activityStarted, activityFinished } from "../idle-watchdog.js";
import { StigmerClient } from "../client/stigmer-client.js";
import { mcpServerToResolved, type ResolvedMcpServer } from "../shared/mcp-resolver.js";
import { toMcpClientConfig } from "../shared/mcp-manager.js";
import {
  assertTransportAllowed,
  resolveMcpTransportPosture,
  type McpTransportPosture,
} from "../shared/mcp-transport-guard.js";
import { detectOAuthChallenge } from "../shared/mcp-oauth-detect.js";
import { injectAnonymousCallerIdentityForDiscovery } from "../shared/caller-identity.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { withTimeout } from "../shared/with-timeout.js";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
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
 * so a healthy endpoint completes the handshake in seconds. 30s is chosen to
 * fit inside the OSS server's 45s connect-workflow run timeout with room for
 * the 10s OAuth re-probe on the failure path — any larger and this error
 * could never surface on OSS (the workflow deadline would fire first).
 * stdio servers keep the generous bound because their first run may compile
 * or install packages (`go run`, `npx`) — the cold-start case (issue #243).
 */
const HTTP_INIT_TIMEOUT_MS = 30_000;
const STDIO_INIT_TIMEOUT_MS = 270_000;

/**
 * The server-side secret-redaction sentinel. Byte-for-byte the value both
 * editions substitute for secret values a caller may not decrypt
 * (`SecretEncryptionService.REDACTED_MARKER` in stigmer-cloud,
 * `RedactedMarker` in the OSS Go server). Discovery dialing an
 * endpoint with a redacted credential is guaranteed to fail confusingly
 * (e.g. `Authorization: Bearer ***REDACTED***` → 401 → SSE-fallback limbo),
 * so it is refused up front with an actionable error instead.
 */
const REDACTED_MARKER = "***REDACTED***";

const PLATFORM_INJECTABLE_MAP: Record<string, string> = {
  STIGMER_SERVER_ADDRESS: "STIGMER_MCP_PUBLIC_ENDPOINT",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoverMcpServerInput {
  mcpServerId: string;
  executionContextId?: string | null;
  invokerIdentityAccountId?: string | null;
}

export interface DiscoveredToolResult {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown> | null;
  // MCP server-supplied behaviour hints. UNTRUSTED — the MCP spec is explicit
  // that clients must never make tool-use decisions on annotations from
  // untrusted servers. We therefore consume them only to TIGHTEN gating
  // (destructiveHint → force-gate), never to relax it. Kept in-memory for the
  // connect workflow's tightener; deliberately excluded from `toolsFingerprint`
  // / `toolSignature` so incremental-classification reuse stays content-stable.
  annotations?: DiscoveredToolAnnotations | null;
}

export interface DiscoveredToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
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
  previousToolsFingerprint: string;
  previousToolApprovals: ToolApprovalDict[];
  newToolsFingerprint: string;
  // Full definitions of the tools discovered on the previous connect, read from
  // status.discovered_capabilities. The connect workflow diffs these against the
  // freshly discovered tools to reuse prior approval decisions for unchanged
  // tools and (re)classify only the new or changed ones. Empty on first connect.
  previousTools: DiscoveredToolResult[];
}

export interface ToolApprovalDict {
  toolName: string;
  requiresApproval: boolean;
  message: string;
}

/**
 * Raised when the credentials a server declares could not be delivered to
 * discovery — the ExecutionContext read failed, came back empty, or returned
 * redacted values (issue #239).
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
// Tools Fingerprint (pure, deterministic, safe in workflow code)
// ─────────────────────────────────────────────────────────────────────────────

export function toolsFingerprint(tools: DiscoveredToolResult[]): string {
  if (tools.length === 0) return "";

  const canonical = tools
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Previous State Extraction
// ─────────────────────────────────────────────────────────────────────────────

interface PreviousState {
  fingerprint: string;
  toolApprovals: ToolApprovalDict[];
  tools: DiscoveredToolResult[];
}

export function extractPreviousState(mcpServer: McpServer): PreviousState {
  const status = mcpServer.status;
  if (!status) return { fingerprint: "", toolApprovals: [], tools: [] };

  const caps = status.discoveredCapabilities;
  const prevTools: DiscoveredToolResult[] = [];
  if (caps) {
    for (const tool of caps.tools) {
      let schema: Record<string, unknown> | null = null;
      if (tool.inputSchema) {
        schema = structToPlainObject(tool.inputSchema);
      }
      prevTools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: schema,
      });
    }
  }

  const toolApprovals: ToolApprovalDict[] = [];
  for (const approval of status.toolApprovals) {
    toolApprovals.push({
      toolName: approval.toolName,
      requiresApproval: true,
      message: approval.message,
    });
  }

  return {
    fingerprint: toolsFingerprint(prevTools),
    toolApprovals,
    tools: prevTools,
  };
}

/**
 * Convert a protobuf Struct to a plain JS object. The @bufbuild/protobuf
 * Struct type uses `fields` as a Record<string, Value>; we need a plain
 * JSON-compatible object for fingerprinting and serialization.
 */
function structToPlainObject(struct: unknown): Record<string, unknown> | null {
  if (!struct || typeof struct !== "object") return null;
  try {
    return JSON.parse(JSON.stringify(struct));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Env Injection
// ─────────────────────────────────────────────────────────────────────────────

export function injectPlatformEnv(
  declaredEnvKeys: Set<string>,
  envVars: Record<string, string>,
): Record<string, string> {
  if (declaredEnvKeys.size === 0) return envVars;

  let result: Record<string, string> | undefined;

  for (const [targetKey, sourceKey] of Object.entries(PLATFORM_INJECTABLE_MAP)) {
    if (!declaredEnvKeys.has(targetKey)) continue;
    const value = process.env[sourceKey];
    if (!value) continue;

    if (!result) result = { ...envVars };
    if (targetKey in result && result[targetKey] !== value) {
      console.info(
        `Platform env var '${targetKey}' overrides value from ExecutionContext ` +
        `(platform infra vars are authoritative)`,
      );
    }
    result[targetKey] = value;
  }

  return result ?? envVars;
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
}

export async function discoverMcpServer(
  input: DiscoverMcpServerInput,
  deps: DiscoverDeps,
): Promise<DiscoverMcpServerOutput> {
  const { mcpServerId, executionContextId } = input;
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
  const previousState = extractPreviousState(mcpServer);

  const declaredEnv = mcpServer.spec.env ?? {};
  const envVars = await resolveEnvVarsForDiscovery(
    stigmerClient,
    executionContextId ?? null,
    slug,
    declaredEnv,
  );

  const declaredEnvKeys = new Set(Object.keys(declaredEnv));
  const platformEnv = injectPlatformEnv(declaredEnvKeys, envVars);

  // Discovery runs with no session, so every declared caller-identity key
  // resolves to the anonymous sentinel — without it, a server templating
  // ${STIGMER_CALLER_IDENTITY_VALUE} in its headers would fail discovery
  // with PlaceholderResolutionError and its tools would never be
  // classified. Servers consuming these keys answer tools/list to
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

  const newFp = toolsFingerprint(tools);

  console.log(
    `[DiscoverMcpServer] Discovery complete for '${slug}': ` +
    `${tools.length} tool(s), ${resourceTemplates.length} resource template(s)`,
  );

  return {
    tools,
    resourceTemplates,
    previousToolsFingerprint: previousState.fingerprint,
    previousToolApprovals: previousState.toolApprovals,
    newToolsFingerprint: newFp,
    previousTools: previousState.tools,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Env Var Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the discovery env from the connect flow's ExecutionContext,
 * failing CLOSED when a server's declared credentials cannot be delivered.
 *
 * The strictness is keyed on whether the server declares any NON-OPTIONAL
 * env var ("credentials expected"):
 *
 * - Credentials expected + the EC read errors, or the EC is missing/empty →
 *   {@link CredentialResolutionError}. The backend only creates a connect EC
 *   when it resolved credentials to deliver, so an unreadable or empty EC is
 *   a delivery failure (auth/scope refusal, transient backend error), never a
 *   normal state. Limping ahead was issue #239's failure mode: discovery died
 *   later as an opaque PlaceholderResolutionError or a doomed dial.
 * - Any delivered value equal to the redaction sentinel →
 *   {@link CredentialResolutionError}, regardless of optionality. A redacted
 *   value means the server-side decrypt gate refused THIS runner's credential
 *   class/scope and fell closed to redaction — dialing with the literal
 *   sentinel can only produce a misleading 401.
 * - No non-optional declarations → the old lenient path (warn and continue):
 *   servers declaring nothing (or only optional/injected keys like the
 *   caller-identity family) legitimately discover without an EC.
 */
async function resolveEnvVarsForDiscovery(
  client: StigmerClient,
  executionContextId: string | null,
  slug: string,
  declaredEnv: Record<string, EnvVarDeclaration>,
): Promise<Record<string, string>> {
  const requiredKeys = Object.entries(declaredEnv)
    .filter(([, decl]) => !decl.optional)
    .map(([key]) => key);
  const credentialsExpected = requiredKeys.length > 0;

  if (!executionContextId) return {};

  let execCtx: Awaited<ReturnType<typeof client.getExecutionContextByExecutionId>>;
  try {
    execCtx = await client.getExecutionContextByExecutionId(executionContextId);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `Could not resolve the credentials MCP server '${slug}' requires ` +
        `(${requiredKeys.join(", ")}): the connect credential store was ` +
        `unreadable (${cause}). This is a platform-side delivery failure, ` +
        `not a problem with your credentials — retry the connect, and if it ` +
        `persists, re-run the OAuth sign-in or re-enter the credentials.`,
      );
    }
    console.warn(
      `[DiscoverMcpServer] Failed to resolve ExecutionContext '${executionContextId}': ` +
      `${cause}`,
    );
    return {};
  }

  const data = execCtx?.spec?.data ?? {};
  if (Object.keys(data).length === 0) {
    if (credentialsExpected) {
      throw new CredentialResolutionError(
        `MCP server '${slug}' requires ${requiredKeys.join(", ")}, but the ` +
        `connect flow delivered no credentials. Re-run the OAuth sign-in ` +
        `(or re-enter the credentials) and connect again.`,
      );
    }
    console.warn(
      `[DiscoverMcpServer] ExecutionContext '${executionContextId}' not found ` +
      `or empty — MCP server may not require environment variables`,
    );
    return {};
  }

  const redactedKeys = Object.entries(data)
    .filter(([, execValue]) => execValue.value === REDACTED_MARKER)
    .map(([key]) => key);
  if (redactedKeys.length > 0) {
    throw new CredentialResolutionError(
      `The credentials for MCP server '${slug}' were delivered redacted ` +
      `(${redactedKeys.join(", ")}): the platform refused to decrypt them ` +
      `for this runner. This is a platform-side authorization failure — ` +
      `retry the connect, and report it if it persists.`,
    );
  }

  const envVars: Record<string, string> = {};
  for (const [key, execValue] of Object.entries(data)) {
    envVars[key] = execValue.value;
  }

  console.log(
    `[DiscoverMcpServer] Resolved ${Object.keys(envVars).length} env var(s) ` +
    `from ExecutionContext '${executionContextId}'`,
  );
  return envVars;
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
          // Capture only the two hints the tightener uses. Stored verbatim from
          // the server (untrusted): used to tighten, never to relax.
          annotations: tool.annotations
            ? {
                readOnlyHint: tool.annotations.readOnlyHint,
                destructiveHint: tool.annotations.destructiveHint,
              }
            : null,
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
    token: config.stigmerToken,
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
        });
      } finally {
        hb.stop();
        activityFinished();
      }
    },
  };
}
