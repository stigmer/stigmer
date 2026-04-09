import { stringify as stringifyYaml } from "yaml";
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
import type { EnvironmentSpec } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";

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

  if (spec.envSpec) {
    const envSpec = serializeEnvSpec(spec.envSpec);
    if (envSpec) {
      result.env_spec = envSpec;
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

  if (spec.envSpec) {
    const envSpec = serializeEnvSpec(spec.envSpec);
    if (envSpec) {
      result.env_spec = envSpec;
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

function serializeEnvSpec(
  envSpec: EnvironmentSpec,
): Record<string, unknown> | undefined {
  if (!hasEntries(envSpec.data)) return undefined;

  const data: Record<string, Record<string, unknown>> = {};

  for (const [key, val] of Object.entries(envSpec.data)) {
    const entry: Record<string, unknown> = {};

    if (val.value) {
      entry.value = val.value;
    }

    if (val.isSecret) {
      entry.is_secret = val.isSecret;
    }

    if (val.description) {
      entry.description = val.description;
    }

    data[key] = entry;
  }

  const result: Record<string, unknown> = {};

  if (envSpec.description) {
    result.description = envSpec.description;
  }

  result.data = data;

  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function hasEntries(obj: Record<string, unknown> | undefined): boolean {
  if (!obj) return false;
  return Object.keys(obj).length > 0;
}
