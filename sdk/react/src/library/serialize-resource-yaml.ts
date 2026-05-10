import { stringify as stringifyYaml } from "yaml";
import type {
  AgentInput,
  McpServerInput,
  McpServerUsageInput,
  SubAgentInput,
  McpAccessInput,
  ToolApprovalOverrideInput,
  ResourceRef,
} from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  AgentSpec,
  McpServerUsage,
  SubAgent,
  McpAccess,
  ToolApprovalOverride,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  McpServerSpec,
  StdioServerConfig,
  HttpServerConfig,
  ToolApprovalPolicy,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";

/**
 * Serializes a proto `Agent` into the canonical Stigmer YAML format.
 *
 * This is the inverse of {@link parseResourceYaml} — the serialized YAML
 * is round-trip compatible and can be fed back through `parseResourceYaml`
 * to produce a valid `AgentInput`.
 *
 * Only emits `apiVersion`, `kind`, `metadata`, and `spec`. The `status`
 * field is system-managed and never included in the YAML output.
 *
 * Uses snake_case field names in the YAML to match the proto canonical form,
 * which is the format expected by both the backend and `parseResourceYaml`.
 *
 * @param agent - The proto `Agent` resource to serialize.
 * @returns A YAML string suitable for editing and re-applying.
 *
 * @example
 * ```ts
 * import { serializeAgentYaml } from "@stigmer/react";
 *
 * const yaml = serializeAgentYaml(agent);
 * const file = new File([yaml], "my-agent.yaml", { type: "text/yaml" });
 * ```
 *
 * @see {@link parseResourceYaml} for the inverse operation
 */
export function serializeAgentYaml(agent: Agent): string {
  const doc: Record<string, unknown> = {
    apiVersion: agent.apiVersion || "agentic.stigmer.ai/v1",
    kind: agent.kind || "Agent",
    metadata: buildMetadata(agent.metadata),
    spec: buildAgentSpec(agent.spec),
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

/**
 * Serializes a proto `McpServer` into the canonical Stigmer YAML format.
 *
 * This is the inverse of {@link parseResourceYaml} for McpServer resources.
 * Same round-trip guarantee and snake_case convention as {@link serializeAgentYaml}.
 *
 * @param mcpServer - The proto `McpServer` resource to serialize.
 * @returns A YAML string suitable for editing and re-applying.
 *
 * @example
 * ```ts
 * import { serializeMcpServerYaml } from "@stigmer/react";
 *
 * const yaml = serializeMcpServerYaml(mcpServer);
 * const file = new File([yaml], "my-server.yaml", { type: "text/yaml" });
 * ```
 *
 * @see {@link parseResourceYaml} for the inverse operation
 */
export function serializeMcpServerYaml(mcpServer: McpServer): string {
  const doc: Record<string, unknown> = {
    apiVersion: mcpServer.apiVersion || "agentic.stigmer.ai/v1",
    kind: mcpServer.kind || "McpServer",
    metadata: buildMetadata(mcpServer.metadata),
    spec: buildMcpServerSpec(mcpServer.spec),
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function buildMetadata(
  metadata: Agent["metadata"] | McpServer["metadata"],
): Record<string, unknown> {
  if (!metadata) return {};

  const result: Record<string, unknown> = {
    name: metadata.name,
  };

  if (metadata.org) {
    result.org = metadata.org;
  }

  if (metadata.slug && metadata.slug !== metadata.name) {
    result.slug = metadata.slug;
  }

  if (hasEntries(metadata.labels)) {
    result.labels = { ...metadata.labels };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Agent spec
// ---------------------------------------------------------------------------

function buildAgentSpec(
  spec: AgentSpec | undefined,
): Record<string, unknown> {
  if (!spec) return {};

  const result: Record<string, unknown> = {};

  if (spec.description) {
    result.description = spec.description;
  }

  if (spec.iconUrl) {
    result.icon_url = spec.iconUrl;
  }

  if (spec.instructions) {
    result.instructions = spec.instructions;
  }

  if (spec.mcpServerUsages.length > 0) {
    result.mcp_server_usages = spec.mcpServerUsages.map(serializeMcpServerUsage);
  }

  if (spec.skillRefs.length > 0) {
    result.skill_refs = spec.skillRefs.map(serializeResourceRef);
  }

  if (spec.subAgents.length > 0) {
    result.sub_agents = spec.subAgents.map(serializeSubAgent);
  }

  if (hasEntries(spec.env)) {
    const env = serializeEnv(spec.env);
    if (env) {
      result.env = env;
    }
  }

  return result;
}

function serializeMcpServerUsage(
  usage: McpServerUsage,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (usage.mcpServerRef) {
    result.mcp_server_ref = serializeResourceRef(usage.mcpServerRef);
  }

  if (usage.enabledTools.length > 0) {
    result.enabled_tools = [...usage.enabledTools];
  }

  if (usage.toolApprovalOverrides.length > 0) {
    result.tool_approval_overrides =
      usage.toolApprovalOverrides.map(serializeToolApprovalOverride);
  }

  return result;
}

function serializeToolApprovalOverride(
  override: ToolApprovalOverride,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    tool_name: override.toolName,
    requires_approval: override.requiresApproval,
  };

  if (override.message) {
    result.message = override.message;
  }

  return result;
}

function serializeSubAgent(sub: SubAgent): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: sub.name,
  };

  if (sub.description) {
    result.description = sub.description;
  }

  if (sub.instructions) {
    result.instructions = sub.instructions;
  }

  if (sub.modelOverride) {
    result.model_override = sub.modelOverride;
  }

  if (sub.mcpAccess.length > 0) {
    result.mcp_access = sub.mcpAccess.map(serializeMcpAccess);
  }

  if (sub.skillRefs.length > 0) {
    result.skill_refs = sub.skillRefs.map(serializeResourceRef);
  }

  return result;
}

function serializeMcpAccess(access: McpAccess): Record<string, unknown> {
  const result: Record<string, unknown> = {
    mcp_server: access.mcpServer,
  };

  if (access.enabledTools.length > 0) {
    result.enabled_tools = [...access.enabledTools];
  }

  return result;
}

// ---------------------------------------------------------------------------
// McpServer spec
// ---------------------------------------------------------------------------

function buildMcpServerSpec(
  spec: McpServerSpec | undefined,
): Record<string, unknown> {
  if (!spec) return {};

  const result: Record<string, unknown> = {};

  if (spec.description) {
    result.description = spec.description;
  }

  if (spec.iconUrl) {
    result.icon_url = spec.iconUrl;
  }

  if (spec.tags.length > 0) {
    result.tags = [...spec.tags];
  }

  if (spec.serverType.case === "stdio") {
    result.stdio = serializeStdioConfig(spec.serverType.value);
  } else if (spec.serverType.case === "http") {
    result.http = serializeHttpConfig(spec.serverType.value);
  }

  if (spec.defaultEnabledTools.length > 0) {
    result.default_enabled_tools = [...spec.defaultEnabledTools];
  }

  if (spec.pinnedToolApprovals.length > 0) {
    result.pinned_tool_approvals =
      spec.pinnedToolApprovals.map(serializeToolApprovalPolicy);
  }

  if (hasEntries(spec.env)) {
    const env = serializeEnv(spec.env);
    if (env) {
      result.env = env;
    }
  }

  return result;
}

function serializeStdioConfig(
  config: StdioServerConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    command: config.command,
  };

  if (config.args.length > 0) {
    result.args = [...config.args];
  }

  if (config.workingDir) {
    result.working_dir = config.workingDir;
  }

  return result;
}

function serializeHttpConfig(
  config: HttpServerConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    url: config.url,
  };

  if (hasEntries(config.headers)) {
    result.headers = { ...config.headers };
  }

  if (hasEntries(config.queryParams)) {
    result.query_params = { ...config.queryParams };
  }

  if (config.timeoutSeconds > 0) {
    result.timeout_seconds = config.timeoutSeconds;
  }

  return result;
}

function serializeToolApprovalPolicy(
  policy: ToolApprovalPolicy,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    tool_name: policy.toolName,
  };

  if (policy.message) {
    result.message = policy.message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Shared serializers
// ---------------------------------------------------------------------------

function serializeResourceRef(
  ref: ApiResourceReference,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (ref.org) {
    result.org = ref.org;
  }

  if (ref.kind) {
    result.kind = ref.kind;
  }

  result.slug = ref.slug;

  if (ref.version) {
    result.version = ref.version;
  }

  return result;
}

function serializeEnv(
  env: { [key: string]: EnvVarDeclaration },
): Record<string, Record<string, unknown>> | undefined {
  const keys = Object.keys(env);
  if (keys.length === 0) return undefined;

  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, val] of Object.entries(env)) {
    const entry: Record<string, unknown> = {};

    if (val.isSecret) {
      entry.is_secret = val.isSecret;
    }

    if (val.description) {
      entry.description = val.description;
    }

    if (val.optional) {
      entry.optional = val.optional;
    }

    result[key] = entry;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function hasEntries(obj: Record<string, unknown> | undefined): boolean {
  if (!obj) return false;
  return Object.keys(obj).length > 0;
}

// ===========================================================================
// AgentInput serialization (from SDK input type, not proto)
// ===========================================================================

/**
 * Serializes an {@link AgentInput} (SDK input type) into the canonical
 * Stigmer YAML format.
 *
 * Unlike {@link serializeAgentYaml} which takes a proto `Agent`, this
 * function works from the SDK input type — the same shape used by
 * `stigmer.agent.apply()`. This is used by the creation wizard to
 * preview the YAML before submission.
 *
 * The output is round-trip compatible with {@link parseResourceYaml}.
 *
 * @param input - The SDK `AgentInput` to serialize.
 * @returns A YAML string in the canonical Stigmer resource format.
 *
 * @example
 * ```ts
 * import { serializeAgentInputYaml } from "@stigmer/react";
 *
 * const yaml = serializeAgentInputYaml({
 *   name: "my-agent",
 *   org: "acme",
 *   instructions: "You are a helpful assistant.",
 * });
 * ```
 */
export function serializeAgentInputYaml(input: AgentInput): string {
  const doc: Record<string, unknown> = {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: buildInputMetadata(input),
    spec: buildAgentInputSpec(input),
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

function buildInputMetadata(input: AgentInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: input.name,
  };

  if (input.org) {
    result.org = input.org;
  }

  if (input.slug && input.slug !== input.name) {
    result.slug = input.slug;
  }

  if (input.labels && Object.keys(input.labels).length > 0) {
    result.labels = { ...input.labels };
  }

  return result;
}

function buildAgentInputSpec(input: AgentInput): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (input.description) {
    result.description = input.description;
  }

  if (input.iconUrl) {
    result.icon_url = input.iconUrl;
  }

  if (input.instructions) {
    result.instructions = input.instructions;
  }

  if (input.mcpServerUsages && input.mcpServerUsages.length > 0) {
    result.mcp_server_usages = input.mcpServerUsages.map(serializeInputMcpUsage);
  }

  if (input.skillRefs && input.skillRefs.length > 0) {
    result.skill_refs = input.skillRefs.map(serializeInputRef);
  }

  if (input.subAgents && input.subAgents.length > 0) {
    result.sub_agents = input.subAgents.map(serializeInputSubAgent);
  }

  if (input.env && Object.keys(input.env).length > 0) {
    result.env = serializeInputEnv(input.env);
  }

  return result;
}

function serializeInputMcpUsage(
  usage: McpServerUsageInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    mcp_server_ref: serializeInputRef(usage.mcpServerRef),
  };

  if (usage.enabledTools && usage.enabledTools.length > 0) {
    result.enabled_tools = [...usage.enabledTools];
  }

  if (usage.toolApprovalOverrides && usage.toolApprovalOverrides.length > 0) {
    result.tool_approval_overrides =
      usage.toolApprovalOverrides.map(serializeInputApprovalOverride);
  }

  return result;
}

function serializeInputApprovalOverride(
  override: ToolApprovalOverrideInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (override.toolName) {
    result.tool_name = override.toolName;
  }
  if (override.requiresApproval != null) {
    result.requires_approval = override.requiresApproval;
  }
  if (override.message) {
    result.message = override.message;
  }

  return result;
}

function serializeInputSubAgent(sub: SubAgentInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: sub.name,
  };

  if (sub.description) {
    result.description = sub.description;
  }
  if (sub.instructions) {
    result.instructions = sub.instructions;
  }
  if (sub.modelOverride) {
    result.model_override = sub.modelOverride;
  }
  if (sub.mcpAccess && sub.mcpAccess.length > 0) {
    result.mcp_access = sub.mcpAccess.map(serializeInputMcpAccess);
  }
  if (sub.skillRefs && sub.skillRefs.length > 0) {
    result.skill_refs = sub.skillRefs.map(serializeInputRef);
  }

  return result;
}

function serializeInputMcpAccess(
  access: McpAccessInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    mcp_server: access.mcpServer,
  };

  if (access.enabledTools && access.enabledTools.length > 0) {
    result.enabled_tools = [...access.enabledTools];
  }

  return result;
}

function serializeInputRef(ref: ResourceRef): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (ref.org) {
    result.org = ref.org;
  }
  result.slug = ref.slug;

  if (ref.version) {
    result.version = ref.version;
  }

  return result;
}

function serializeInputEnv(
  env: NonNullable<AgentInput["env"]>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, val] of Object.entries(env)) {
    const entry: Record<string, unknown> = {};

    if (val.isSecret) {
      entry.is_secret = val.isSecret;
    }
    if (val.description) {
      entry.description = val.description;
    }
    if (val.optional) {
      entry.optional = val.optional;
    }

    result[key] = entry;
  }

  return result;
}

// ===========================================================================
// McpServerInput serialization (from SDK input type, not proto)
// ===========================================================================

/**
 * Serializes a {@link McpServerInput} (SDK input type) into the canonical
 * Stigmer YAML format.
 *
 * Unlike {@link serializeMcpServerYaml} which takes a proto `McpServer`,
 * this function works from the SDK input type — the same shape used by
 * `stigmer.mcpServer.apply()`. This is used by the creation wizard to
 * preview the YAML before submission.
 *
 * The output is round-trip compatible with {@link parseResourceYaml}.
 *
 * @param input - The SDK `McpServerInput` to serialize.
 * @returns A YAML string in the canonical Stigmer resource format.
 *
 * @example
 * ```ts
 * import { serializeMcpServerInputYaml } from "@stigmer/react";
 *
 * const yaml = serializeMcpServerInputYaml({
 *   name: "github",
 *   org: "acme",
 *   http: { url: "https://mcp.github.com/sse" },
 * });
 * ```
 */
export function serializeMcpServerInputYaml(input: McpServerInput): string {
  const doc: Record<string, unknown> = {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: buildMcpServerInputMetadata(input),
    spec: buildMcpServerInputSpec(input),
  };

  return stringifyYaml(doc, { lineWidth: 0, blockQuote: "literal" });
}

function buildMcpServerInputMetadata(
  input: McpServerInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: input.name,
  };

  if (input.org) {
    result.org = input.org;
  }

  if (input.slug && input.slug !== input.name) {
    result.slug = input.slug;
  }

  if (input.labels && Object.keys(input.labels).length > 0) {
    result.labels = { ...input.labels };
  }

  return result;
}

function buildMcpServerInputSpec(
  input: McpServerInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (input.description) {
    result.description = input.description;
  }

  if (input.iconUrl) {
    result.icon_url = input.iconUrl;
  }

  if (input.stdio) {
    const stdio: Record<string, unknown> = {
      command: input.stdio.command,
    };
    if (input.stdio.args && input.stdio.args.length > 0) {
      stdio.args = [...input.stdio.args];
    }
    if (input.stdio.workingDir) {
      stdio.working_dir = input.stdio.workingDir;
    }
    result.stdio = stdio;
  }

  if (input.http) {
    const http: Record<string, unknown> = {
      url: input.http.url,
    };
    if (input.http.headers && Object.keys(input.http.headers).length > 0) {
      http.headers = { ...input.http.headers };
    }
    if (input.http.queryParams && Object.keys(input.http.queryParams).length > 0) {
      http.query_params = { ...input.http.queryParams };
    }
    if (input.http.timeoutSeconds && input.http.timeoutSeconds > 0) {
      http.timeout_seconds = input.http.timeoutSeconds;
    }
    result.http = http;
  }

  if (input.env && Object.keys(input.env).length > 0) {
    result.env = serializeInputEnv(input.env);
  }

  if (input.auth) {
    result.auth = serializeInputMcpServerAuth(input.auth);
  }

  return result;
}

function serializeInputMcpServerAuth(
  auth: NonNullable<McpServerInput["auth"]>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (auth.oauthAppRef) {
    result.oauth_app_ref = serializeInputRef(auth.oauthAppRef);
  }
  if (auth.targetEnvVar) {
    result.target_env_var = auth.targetEnvVar;
  }
  if (auth.tokenLifetimeHint) {
    result.token_lifetime_hint = auth.tokenLifetimeHint;
  }
  if (auth.scopeHints && auth.scopeHints.length > 0) {
    result.scope_hints = [...auth.scopeHints];
  }
  if (auth.discoveryUrl) {
    result.discovery_url = auth.discoveryUrl;
  }

  return result;
}
