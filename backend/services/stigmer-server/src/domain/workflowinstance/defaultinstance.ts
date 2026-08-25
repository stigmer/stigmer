/**
 * Default-instance factory — ports
 * pkg/domain/workflowinstance/defaultinstance: the canonical
 * WorkflowInstance request for per-workflow default instances, the workflow
 * twin of the agentinstance defaultinstance module and the OSS twin of the
 * cloud edition's DefaultWorkflowInstanceFactory. See the agentinstance
 * twin's header for the full rationale (naming single-sourcing, no
 * visibility of their own, reserved-label markers vs the authoritative
 * status.default_instance_id pointer); the two modules must stay in
 * lockstep.
 */
import { create } from "@bufbuild/protobuf";

import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../pipeline/apiresource-labels.js";

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "WorkflowInstance";

const SLUG_SUFFIX = "-default";
const DESCRIPTION = "Default instance (auto-created, no custom configuration)";

/**
 * The deterministic slug of a workflow's default instance
 * (<workflow-slug>-default) — the single source of the naming convention,
 * used by workflow create and by workflow-execution create's self-heal
 * lookup when a legacy workflow lacks status.default_instance_id.
 */
export function defaultWorkflowInstanceSlug(workflowSlug: string): string {
  return workflowSlug + SLUG_SUFFIX;
}

/**
 * Builds the WorkflowInstance proto for a default-instance creation request
 * from the parent workflow's metadata. Callers hand it to the
 * workflowinstance in-process client (createAsSystem), which owns
 * persistence and validation.
 *
 * Takes the metadata rather than loose strings for the same reason as the
 * agentinstance twin: the instance is named from the workflow's SLUG (the
 * identity defaultWorkflowInstanceSlug reconstructs for fallback lookups),
 * never the free-form display name — reading it at this single source makes
 * the wrong-field mistake unwritable (oss#355).
 */
export function buildDefaultWorkflowInstanceRequest(
  workflow: ApiResourceMetadata,
): WorkflowInstance {
  return create(WorkflowInstanceSchema, {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: defaultWorkflowInstanceSlug(workflow.slug),
      org: workflow.org,
      labels: {
        [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE,
        [SYSTEM_MANAGED_LABEL]: RESERVED_LABEL_TRUE,
      },
    },
    spec: {
      workflowId: workflow.id,
      description: DESCRIPTION,
    },
  });
}
