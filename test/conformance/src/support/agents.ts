// Canonical valid Agent fixtures for the conformance suite.
// Domain: conformance support.
//
// Agent is a flat (non-versioned) blueprint. Its spec is optional at the proto
// level, but a useful agent carries `instructions` (min_len=10). These builders
// give the suite one canonical *valid* agent so CRUD and cross-resource tests
// share a single source of truth and vary it deliberately — notably via
// `mcpServerRefs`, which composes the Agent->McpServer reference invariant
// exercised by ValidateReferencesStep.
//
// Negative cases (too-short instructions, missing name) are written inline in
// the suite, not here: this module represents validity by construction, matching
// the convention established by support/workflows.ts.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { type EnvVarDeclarationInit, makeEnvDeclarations } from "./environments";

export const AGENT_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_KIND = "Agent";

// Per-agent tool approval override on a single MCP server usage. Mirrors the
// proto ToolApprovalOverride (tool_name, requires_approval, message); this is the
// per-agent level of the approval-policy chain and the lever that gates a tool
// for HITL conformance.
export interface ToolApprovalOverrideOption {
  toolName: string;
  requiresApproval: boolean;
  message?: string;
}

// A single mcp_server_usage with optional per-tool approval overrides. Used when
// a test needs more than a bare reference (e.g. to gate a tool for HITL).
export interface McpServerUsageOption {
  slug: string;
  toolApprovalOverrides?: ToolApprovalOverrideOption[];
}

export interface AgentSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // System prompt; defaults to a value comfortably above the min_len=10 floor.
  instructions?: string;
  // McpServer slugs to reference via spec.mcp_server_usages. Each becomes an
  // mcp_server_ref with kind=mcp_server (the CEL constraint the agent spec
  // enforces). Org is left empty so the server normalizes it to the agent's org.
  mcpServerRefs?: string[];
  // Richer mcp_server_usages, for tests that attach tool_approval_overrides.
  // Combined with mcpServerRefs (which are the simple, override-free form).
  mcpServerUsages?: McpServerUsageOption[];
  // Blueprint env-var declarations projected into spec.env — the least-privilege
  // key whitelist the execution engine filters the merged environment against.
  // Declarations carry no value (that is the instance/runtime job); see envmerge.
  env?: Record<string, EnvVarDeclarationInit>;
}

// A valid AgentSpec: instructions satisfy the min_len=10 constraint, and any
// requested McpServer references are projected into mcp_server_usages. Bare
// `mcpServerRefs` and richer `mcpServerUsages` are both supported and merged.
export function makeAgentSpec(opts: AgentSpecOptions = {}): MessageInitShape<typeof AgentSpecSchema> {
  const refUsages = (opts.mcpServerRefs ?? []).map((slug) => ({
    mcpServerRef: { slug, kind: ApiResourceKind.mcp_server },
  }));
  const richUsages = (opts.mcpServerUsages ?? []).map((usage) => ({
    mcpServerRef: { slug: usage.slug, kind: ApiResourceKind.mcp_server },
    toolApprovalOverrides: (usage.toolApprovalOverrides ?? []).map((o) => ({
      toolName: o.toolName,
      requiresApproval: o.requiresApproval,
      message: o.message ?? "",
    })),
  }));
  return {
    description: opts.description ?? "conformance fixture",
    instructions: opts.instructions ?? "Review code carefully and suggest improvements.",
    mcpServerUsages: [...refUsages, ...richUsages],
    ...(opts.env !== undefined ? { env: makeEnvDeclarations(opts.env) } : {}),
  };
}

export interface AgentOptions extends AgentSpecOptions {
  org: string;
  name: string;
}

// A complete, valid Agent resource ready to hand to create/apply/update.
export function makeAgent(opts: AgentOptions): MessageInitShape<typeof AgentSchema> {
  const { org, name, description, instructions, mcpServerRefs, mcpServerUsages, env } = opts;
  return {
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: { name, org },
    spec: makeAgentSpec({ description, instructions, mcpServerRefs, mcpServerUsages, env }),
  };
}
