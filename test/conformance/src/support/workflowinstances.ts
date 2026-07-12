// Canonical valid WorkflowInstance fixtures for the conformance suite.
// Domain: conformance support.
//
// WorkflowInstance is the "Instance" layer in the Template -> Instance ->
// Execution pattern: it binds a Workflow template (workflow_id) to an ordered
// list of Environment resources (environment_refs) whose values are merged at
// execution start. The envmerge suite uses it to seed the instance env layer;
// environment_refs merge in declaration order (later overrides earlier).
//
// Negatives are composed inline in the suite, matching the convention in the
// other support modules: this module represents validity by construction.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { type EnvironmentRefInit, makeEnvironmentRefs } from "./environments";

export const WORKFLOW_INSTANCE_API_VERSION = "agentic.stigmer.ai/v1";
export const WORKFLOW_INSTANCE_KIND = "WorkflowInstance";

export interface WorkflowInstanceSpecOptions {
  // The wfl_ id of the Workflow template this instance deploys (required).
  workflowId: string;
  description?: string;
  // Environment resources providing the instance env layer, merged in order.
  environmentRefs?: EnvironmentRefInit[];
}

export function makeWorkflowInstanceSpec(
  opts: WorkflowInstanceSpecOptions,
): MessageInitShape<typeof WorkflowInstanceSpecSchema> {
  return {
    workflowId: opts.workflowId,
    description: opts.description ?? "conformance fixture",
    environmentRefs: makeEnvironmentRefs(opts.environmentRefs ?? []),
  };
}

export interface WorkflowInstanceOptions extends WorkflowInstanceSpecOptions {
  org: string;
  name: string;
}

// A complete, valid WorkflowInstance resource ready to hand to create/apply.
export function makeWorkflowInstance(
  opts: WorkflowInstanceOptions,
): MessageInitShape<typeof WorkflowInstanceSchema> {
  const { org, name, ...specOpts } = opts;
  return {
    apiVersion: WORKFLOW_INSTANCE_API_VERSION,
    kind: WORKFLOW_INSTANCE_KIND,
    metadata: { name, org },
    spec: makeWorkflowInstanceSpec(specOpts),
  };
}
