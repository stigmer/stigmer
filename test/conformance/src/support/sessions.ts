// Canonical valid Session fixtures for the conformance suite.
// Domain: conformance support.
//
// Session is the runtime conversation thread that runs against an AgentInstance.
// Its one structurally meaningful reference is spec.agent_instance_id: when it is
// empty the server resolves a platform default agent (labeled
// stigmer.ai/default-agent), which the fresh conformance server does not seed — so
// the canonical builder always carries an explicit instance id. Suites obtain that
// id from an Agent fixture: Agent.create provisions a default AgentInstance and
// returns it on status.default_instance_id (an `ain_…` id).
//
// Negatives (duplicate, missing name, wrong const fields) are written inline in the
// suite, matching support/agents.ts and support/environments.ts: this module is
// validity-by-construction. Runtime-populated fields (harness_state_id and the
// harness/execution_target immutability sentinels it gates) only exist after a real
// execution and are out of scope until the execution-lifecycle slice (Class B).
import type { MessageInitShape } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const SESSION_API_VERSION = "agentic.stigmer.ai/v1";
export const SESSION_KIND = "Session";

export interface SessionSpecOptions {
  // Agent instance the session runs against. Required for clean creation; pass an
  // Agent fixture's status.default_instance_id (an `ain_…` id).
  agentInstanceId: string;
  // Conversation title; defaults to a stable placeholder.
  subject?: string;
  // Execution engine. Omitted by default so the create-vs-get parity check stays
  // stable on the as-stored value (the server does not normalize harness at
  // create — UNSPECIFIED is only resolved to NATIVE at execution dispatch).
  harness?: Harness;
  // Where activities run. Omitted by default for the same parity reason.
  executionTarget?: ExecutionTarget;
  // Session-level McpServer slugs, projected into spec.mcp_server_usages. Org is
  // left empty so the server normalizes it to the session's org.
  mcpServerRefs?: string[];
  // Session-level Skill slugs, projected into spec.skill_refs.
  skillRefs?: string[];
}

// A valid SessionSpec referencing the given agent instance. Optional harness /
// execution_target / references are only set when explicitly provided, keeping the
// canonical session minimal and parity-stable.
export function makeSessionSpec(opts: SessionSpecOptions): MessageInitShape<typeof SessionSpecSchema> {
  return {
    agentInstanceId: opts.agentInstanceId,
    subject: opts.subject ?? "conformance fixture session",
    ...(opts.harness !== undefined ? { harness: opts.harness } : {}),
    ...(opts.executionTarget !== undefined ? { executionTarget: opts.executionTarget } : {}),
    mcpServerUsages: (opts.mcpServerRefs ?? []).map((slug) => ({
      mcpServerRef: { slug, kind: ApiResourceKind.mcp_server },
    })),
    skillRefs: (opts.skillRefs ?? []).map((slug) => ({ slug, kind: ApiResourceKind.skill })),
  };
}

export interface SessionOptions extends SessionSpecOptions {
  org: string;
  name: string;
}

// A complete, valid Session resource ready to hand to create/apply/update.
export function makeSession(opts: SessionOptions): MessageInitShape<typeof SessionSchema> {
  const { org, name, ...specOpts } = opts;
  return {
    apiVersion: SESSION_API_VERSION,
    kind: SESSION_KIND,
    metadata: { name, org },
    spec: makeSessionSpec(specOpts),
  };
}
