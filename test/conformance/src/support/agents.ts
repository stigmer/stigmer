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
import type { InitShape } from "./init-shape";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { type EnvVarDeclarationInit, makeEnvDeclarations } from "./environments";

export const AGENT_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_KIND = "Agent";

// The BARE agent's one instruction: the only agent-authored bytes in what the
// native harness sends the model when nothing else is attached. One home, so
// the request-shape goldens (which photograph this agent's wire) and the live
// benchmark (which measures it) are the same agent by construction, not by
// copy. Changing it moves the goldens and the benchmark's baseline together.
export const BARE_AGENT_INSTRUCTIONS = "Answer in one short sentence.";

// A sub-agent the root agent may delegate to through the built-in `task` tool
// (spec.sub_agents). Mirrors the proto SubAgent's three authored fields; the
// name is what a tool_use turn names as `subagent_type`.
export interface SubAgentOption {
  name: string;
  description?: string;
  // Sub-agent system prompt; the proto's min_len=10 floor applies.
  instructions: string;
}

export interface AgentSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // System prompt; defaults to a value comfortably above the min_len=10 floor.
  instructions?: string;
  // Sub-agents projected into spec.sub_agents (the delegation arms).
  subAgents?: SubAgentOption[];
  // McpServer slugs to reference via spec.mcp_server_usages. Each becomes an
  // mcp_server_ref with kind=mcp_server (the CEL constraint the agent spec
  // enforces). Org is left empty so the server normalizes it to the agent's org.
  mcpServerRefs?: string[];
  // The agent's two tool lists (spec.tools, spec.disallowed_tools), in Claude
  // Code's names: "only these" and "never these". Passed through verbatim;
  // what an entry means is the runner's to resolve.
  tools?: string[];
  disallowedTools?: string[];
  // Skill slugs to reference via spec.skill_refs, each with kind=skill. Org is
  // left empty so the server normalizes it to the agent's org.
  skillRefs?: string[];
  // Blueprint env-var declarations projected into spec.env — the least-privilege
  // key whitelist the execution engine filters the merged environment against.
  // Declarations carry no value (that is the instance/runtime job); see envmerge.
  env?: Record<string, EnvVarDeclarationInit>;
}

// A valid AgentSpec: instructions satisfy the min_len=10 constraint, and any
// requested McpServer references are projected into mcp_server_usages.
export function makeAgentSpec(opts: AgentSpecOptions = {}): InitShape<typeof AgentSpecSchema> {
  return {
    description: opts.description ?? "conformance fixture",
    instructions: opts.instructions ?? "Review code carefully and suggest improvements.",
    mcpServerUsages: (opts.mcpServerRefs ?? []).map((slug) => ({
      mcpServerRef: { slug, kind: ApiResourceKind.mcp_server },
    })),
    ...(opts.skillRefs !== undefined
      ? { skillRefs: opts.skillRefs.map((slug) => ({ slug, kind: ApiResourceKind.skill })) }
      : {}),
    ...(opts.subAgents !== undefined
      ? {
          subAgents: opts.subAgents.map((sub) => ({
            name: sub.name,
            description: sub.description ?? `${sub.name} sub-agent`,
            instructions: sub.instructions,
          })),
        }
      : {}),
    ...(opts.env !== undefined ? { env: makeEnvDeclarations(opts.env) } : {}),
    ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
    ...(opts.disallowedTools !== undefined ? { disallowedTools: opts.disallowedTools } : {}),
  };
}

export interface AgentOptions extends AgentSpecOptions {
  org: string;
  name: string;
  // Metadata labels, passed through verbatim — label semantics live server-side.
  // The suite's one consumer today is the reserved-label guard pin, which
  // introduces a stigmer.ai/* key as an ordinary caller to see it refused.
  labels?: Record<string, string>;
}

// A complete, valid Agent resource ready to hand to create/apply/update.
export function makeAgent(opts: AgentOptions): InitShape<typeof AgentSchema> {
  const { org, name, labels, ...spec } = opts;
  return {
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: { name, org, ...(labels !== undefined ? { labels } : {}) },
    spec: makeAgentSpec(spec),
  };
}
