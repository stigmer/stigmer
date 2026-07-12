// Canonical valid AgentInstance fixtures for the conformance suite.
// Domain: conformance support.
//
// AgentInstance is the "Instance" layer in the Template -> Instance -> Execution
// pattern: it binds an Agent template (agent_id) to an ordered list of
// Environment resources (environment_refs) whose values are merged at execution
// start. A Session runs against an AgentInstance (Session.spec.agent_instance_id),
// so seeding an instance's environment_refs is how the envmerge suite exercises
// the agent instance env layer. environment_refs merge in order.
//
// Negatives are composed inline in the suite, matching the convention in the
// other support modules: this module represents validity by construction.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/spec_pb";
import { type EnvironmentRefInit, makeEnvironmentRefs } from "./environments";

export const AGENT_INSTANCE_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_INSTANCE_KIND = "AgentInstance";

export interface AgentInstanceSpecOptions {
  // The agt_ id of the Agent template this instance deploys (required).
  agentId: string;
  description?: string;
  // Environment resources providing the instance env layer, merged in order.
  environmentRefs?: EnvironmentRefInit[];
}

export function makeAgentInstanceSpec(
  opts: AgentInstanceSpecOptions,
): MessageInitShape<typeof AgentInstanceSpecSchema> {
  return {
    agentId: opts.agentId,
    description: opts.description ?? "conformance fixture",
    environmentRefs: makeEnvironmentRefs(opts.environmentRefs ?? []),
  };
}

export interface AgentInstanceOptions extends AgentInstanceSpecOptions {
  org: string;
  name: string;
}

// A complete, valid AgentInstance resource ready to hand to create/apply.
export function makeAgentInstance(opts: AgentInstanceOptions): MessageInitShape<typeof AgentInstanceSchema> {
  const { org, name, ...specOpts } = opts;
  return {
    apiVersion: AGENT_INSTANCE_API_VERSION,
    kind: AGENT_INSTANCE_KIND,
    metadata: { name, org },
    spec: makeAgentInstanceSpec(specOpts),
  };
}
