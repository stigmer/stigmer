/**
 * WorkflowInstance domain pipeline steps — port the step half of
 * pkg/domain/workflowinstance/controller: parent-workflow load through the
 * in-process workflow client (the other direction of the mutual edge),
 * the same-org business rule, the spec.workflow_id immutability guard
 * (oss#646), and the default-instance visibility guard (oss#556). Proven by
 * workflowinstance.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * the family test ../workflow/__tests__/workflow.test.ts (the mutual edge
 * makes the two domains one testable unit).
 */
import { ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { isDefaultInstance } from "../../pipeline/apiresource-labels.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { rejectDefaultInstanceVisibilityUpdate } from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

type InstanceDesc = typeof WorkflowInstanceSchema;

/** Context key for the loaded parent workflow (Go ParentWorkflowKey). */
export const PARENT_WORKFLOW_KEY = "parent_workflow";

// ---------------------------------------------------------------------------
// The workflow in-process edge (DD-002): instance create verifies its
// parent through the workflow query service so the full interceptor chain
// runs — the other direction of the workflow↔workflowinstance mutual edge.
// ---------------------------------------------------------------------------

export interface ParentWorkflowLoader {
  get(workflowId: string): Promise<Workflow>;
}

/** Lazy provider — the cycle-break closure (DD-002). */
export type ParentWorkflowLoaderProvider = () => ParentWorkflowLoader;

/**
 * LoadParentWorkflow — create.go: loads the workflow the instance
 * materializes and stashes it for the same-org rule. ANY load failure maps
 * to NotFound("Workflow", id) — Go folds every client error into that arm
 * (capital-W copy is the wire contract).
 */
export function newLoadParentWorkflowStep(
  loaderProvider: ParentWorkflowLoaderProvider,
  logger: Logger,
): PipelineStep<InstanceDesc> {
  return {
    name: "LoadParentWorkflow",
    async execute(ctx: RequestContext<InstanceDesc>): Promise<void> {
      const workflowId = ctx.input.spec?.workflowId ?? "";

      logger.info("Loading parent workflow", { workflowId });

      let parent: Workflow;
      try {
        parent = await loaderProvider().get(workflowId);
      } catch (error) {
        logger.warn("Parent workflow not found", {
          error: error instanceof ConnectError ? error.rawMessage : String(error),
          workflowId,
        });
        throw notFoundError("Workflow", workflowId);
      }

      ctx.set(PARENT_WORKFLOW_KEY, parent);
    },
  };
}

/**
 * ValidateSameOrgBusinessRule — create.go: instances must live in the same
 * organization as the parent workflow; cross-org instances could leak
 * configuration/secrets. The message is the cross-edition wire contract.
 */
export function newValidateSameOrgBusinessRuleStep(
  logger: Logger,
): PipelineStep<InstanceDesc> {
  return {
    name: "ValidateSameOrgBusinessRule",
    execute(ctx: RequestContext<InstanceDesc>): void {
      const parent = ctx.get(PARENT_WORKFLOW_KEY) as Workflow | undefined;
      if (parent === undefined) {
        throw new Error("parent workflow not found in context");
      }

      const targetOrg = ctx.newState.metadata?.org ?? "";
      const workflowOrg = parent.metadata?.org ?? "";

      if (workflowOrg !== targetOrg) {
        logger.warn(
          "Business rule violation: cannot create instance of workflow in different org",
          {
            workflowId: parent.metadata?.id ?? "",
            workflowOrg,
            instanceOrg: targetOrg,
          },
        );
        throw invalidArgumentError(
          "Cannot create instance of workflow in a different organization. " +
            `Workflow belongs to org '${workflowOrg}', instance target is org '${targetOrg}'.`,
        );
      }
    },
  };
}

/**
 * ValidateInstanceUpdate — update.go: spec.workflow_id is immutable. An
 * instance is a configured materialization OF one workflow — repointing it
 * would silently change what its executions run while keeping the
 * instance's identity, history, and references intact; create a new
 * instance instead (oss#646).
 *
 * Rejecting (rather than silently preserving, as BuildUpdateState does for
 * metadata.visibility) is deliberate: visibility has a legitimate second
 * door — the guarded updateVisibility RPC — so stale manifests carrying an
 * old level are routine and must not fail the update. The parent ref has
 * NO other door; a differing value is always a client error and deserves a
 * loud failure. Same posture as the AgentChannel/Schedule guards and the
 * cloud edition's twin step. Runs after LoadExisting; Apply delegates to
 * Update, so this guard covers the apply door too.
 */
export function newValidateInstanceUpdateStep(): PipelineStep<InstanceDesc> {
  return {
    name: "ValidateInstanceUpdate",
    execute(ctx: RequestContext<InstanceDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | WorkflowInstance
        | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing workflow instance not found in context"),
          "existing workflow instance not found in context",
        );
      }

      if (ctx.input.spec?.workflowId !== existing.spec?.workflowId) {
        throw failedPreconditionError(
          `spec.workflow_id is immutable (instance runs workflow ${existing.spec?.workflowId ?? ""}) — create a new instance to run a different workflow`,
        );
      }
    },
  };
}

/**
 * RejectDefaultInstanceVisibilityUpdate — update_visibility.go: rejects
 * visibility updates on a workflow's system-managed default instance — the
 * workflow twin of the agentinstance guard (oss#556). Keyed on the
 * reserved label OR the parent's authoritative status.default_instance_id
 * pointer (covers pre-label legacy rows without a backfill migration; the
 * pointer cannot be dropped by a client update the way the label can). A
 * missing parent passes through; any other store failure is INTERNAL — a
 * transient fault must not silently open the guard.
 */
export function newRejectDefaultWorkflowInstanceVisibilityUpdateStep<
  Desc extends DescMessage,
>(store: Store, instanceKey: string): PipelineStep<Desc> {
  return {
    name: "RejectDefaultInstanceVisibilityUpdate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const instance = ctx.get(instanceKey) as WorkflowInstance;

      if (isDefaultInstance(instance.metadata)) {
        rejectDefaultInstanceVisibilityUpdate();
      }

      const parentId = instance.spec?.workflowId ?? "";
      if (parentId === "") {
        return;
      }
      let parent: Workflow;
      try {
        parent = await store.getResource(
          ApiResourceKind.workflow,
          parentId,
          WorkflowSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return;
        }
        throw internalError(
          error,
          "failed to load parent workflow for default-instance check",
        );
      }
      if (parent.status?.defaultInstanceId === instance.metadata?.id) {
        rejectDefaultInstanceVisibilityUpdate();
      }
    },
  };
}
