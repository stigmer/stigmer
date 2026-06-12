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

export const AGENT_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_KIND = "Agent";

export interface AgentSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // System prompt; defaults to a value comfortably above the min_len=10 floor.
  instructions?: string;
  // McpServer slugs to reference via spec.mcp_server_usages. Each becomes an
  // mcp_server_ref with kind=mcp_server (the CEL constraint the agent spec
  // enforces). Org is left empty so the server normalizes it to the agent's org.
  mcpServerRefs?: string[];
}

// A valid AgentSpec: instructions satisfy the min_len=10 constraint, and any
// requested McpServer references are projected into mcp_server_usages.
export function makeAgentSpec(opts: AgentSpecOptions = {}): MessageInitShape<typeof AgentSpecSchema> {
  return {
    description: opts.description ?? "conformance fixture",
    instructions: opts.instructions ?? "Review code carefully and suggest improvements.",
    mcpServerUsages: (opts.mcpServerRefs ?? []).map((slug) => ({
      mcpServerRef: { slug, kind: ApiResourceKind.mcp_server },
    })),
  };
}

export interface AgentOptions extends AgentSpecOptions {
  org: string;
  name: string;
}

// A complete, valid Agent resource ready to hand to create/apply/update.
export function makeAgent(opts: AgentOptions): MessageInitShape<typeof AgentSchema> {
  const { org, name, description, instructions, mcpServerRefs } = opts;
  return {
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: { name, org },
    spec: makeAgentSpec({ description, instructions, mcpServerRefs }),
  };
}
