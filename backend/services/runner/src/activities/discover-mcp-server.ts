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
import { mcpServerToResolved } from "../shared/mcp-resolver.js";
import { toMcpClientConfig } from "../shared/mcp-manager.js";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Config } from "../config.js";

const SESSION_INIT_TIMEOUT_MS = 270_000;

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

  const envVars = await resolveEnvVarsForDiscovery(
    stigmerClient,
    executionContextId ?? null,
  );

  const declaredEnvKeys = mcpServer.spec.env
    ? new Set(Object.keys(mcpServer.spec.env))
    : new Set<string>();
  const finalEnv = injectPlatformEnv(declaredEnvKeys, envVars);

  const resolved = mcpServerToResolved(mcpServer, slug, finalEnv);
  if (!resolved) {
    throw new Error(
      `MCP server '${slug}' has no valid server type configured ` +
      `(must specify either 'stdio' or 'http' in the spec)`,
    );
  }

  const connectionConfig = toMcpClientConfig([resolved]);
  const { tools, resourceTemplates } = await connectAndDiscover(
    slug,
    connectionConfig,
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

async function resolveEnvVarsForDiscovery(
  client: StigmerClient,
  executionContextId: string | null,
): Promise<Record<string, string>> {
  if (!executionContextId) return {};

  try {
    const execCtx = await client.getExecutionContextByExecutionId(
      executionContextId,
    );

    if (!execCtx?.spec?.data || Object.keys(execCtx.spec.data).length === 0) {
      console.warn(
        `[DiscoverMcpServer] ExecutionContext '${executionContextId}' not found ` +
        `or empty — MCP server may not require environment variables`,
      );
      return {};
    }

    const envVars: Record<string, string> = {};
    for (const [key, execValue] of Object.entries(execCtx.spec.data)) {
      envVars[key] = execValue.value;
    }

    console.log(
      `[DiscoverMcpServer] Resolved ${Object.keys(envVars).length} env var(s) ` +
      `from ExecutionContext '${executionContextId}'`,
    );
    return envVars;
  } catch (err) {
    console.warn(
      `[DiscoverMcpServer] Failed to resolve ExecutionContext '${executionContextId}': ` +
      `${err instanceof Error ? err.message : err}`,
    );
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Connection + Enumeration
// ─────────────────────────────────────────────────────────────────────────────

async function connectAndDiscover(
  slug: string,
  connectionConfig: ReturnType<typeof toMcpClientConfig>,
): Promise<{
  tools: DiscoveredToolResult[];
  resourceTemplates: DiscoveredResourceTemplateResult[];
}> {
  const client = new MultiServerMCPClient(connectionConfig);
  const tools: DiscoveredToolResult[] = [];
  const resourceTemplates: DiscoveredResourceTemplateResult[] = [];

  try {
    await withTimeout(SESSION_INIT_TIMEOUT_MS, slug, async () => {
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

async function withTimeout<T>(
  ms: number,
  serverSlug: string,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `MCP server '${serverSlug}' did not respond within ` +
        `${Math.round(ms / 1000)}s. If this server requires compilation or ` +
        `package installation on first run (e.g. go run, npx), the cold ` +
        `start may have exceeded the discovery timeout.`,
      ));
    }, ms);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporal Activity Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createDiscoverMcpServerActivities(config: Config) {
  const stigmerClient = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
    tokenRef: config.stigmerTokenRef,
  });

  return {
    DiscoverMcpServerCapabilities: async (
      input: DiscoverMcpServerInput,
    ): Promise<DiscoverMcpServerOutput> => {
      activityStarted();
      try {
        return await discoverMcpServer(input, { stigmerClient });
      } finally {
        activityFinished();
      }
    },
  };
}
