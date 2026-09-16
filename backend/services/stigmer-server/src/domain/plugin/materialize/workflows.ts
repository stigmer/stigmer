/**
 * Workflows from a plugin: the author's `ai.stigmer/workflows/<name>.yaml`
 * documents, applied as written. Only Stigmer reads this folder (other
 * clients have no workflow), so there is nothing portable to layer; the
 * file stem is the workflow's name and slug, and the workflow chain's own
 * validation (ValidateWorkflowSpec, ValidateReferences) judges the spec
 * exactly as it would a `stigmer apply`.
 */
import { create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";

import { generateSlug } from "../../../pipeline/steps/slug.js";
import { memberMetadata } from "./identity.js";
import type { PluginIdentity } from "./identity.js";

export interface PlannedWorkflow {
  readonly name: string;
  readonly slug: string;
  readonly resource: Workflow;
}

/** One parsed overlay workflow: its file stem and the document. */
export interface OverlayWorkflow {
  readonly name: string;
  readonly resource: Workflow;
}

export function workflowSlugOf(name: string): string {
  return generateSlug(name);
}

export function planWorkflows(
  overlays: readonly OverlayWorkflow[],
  identity: PluginIdentity,
): PlannedWorkflow[] {
  return overlays.map(({ name, resource }) => {
    const slug = workflowSlugOf(name);
    return {
      name,
      slug,
      resource: create(WorkflowSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Workflow",
        metadata: memberMetadata(identity, { name, slug }, resource.metadata),
        spec: resource.spec,
      }),
    };
  });
}
