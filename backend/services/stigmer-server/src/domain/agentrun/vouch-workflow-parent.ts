/**
 * A turn's link to the workflow run that started it (spec.parent): the
 * two steps that make it a fact the server vouched for rather than a
 * string any caller filled in.
 *
 * The link carries a dispatch decision (the turn's activities run on the
 * workflow run's `wfexec:` queue, in its sandbox), a signal target and a
 * Temporal task token, and an edition's billing and capacity gates read
 * its presence as "this turn is the workflow run's spend". So it follows
 * exactly the trust rule reserved labels follow (guard-reserved-labels.ts):
 *
 *   - a request the server composed itself passes;
 *   - a runner the composed RunnerCredentialProvider vouches for that
 *     workflow execution passes (vouchRunnerLineageLabels, the capability
 *     that already binds a workflow-bound credential to its own run and
 *     REFUSES a mismatch by throwing its own byte-pinned copy);
 *   - anyone else needs `can_write_reserved_labels` on the platform:
 *     open source's permissive default Authorizer grants it (the
 *     trusted-local posture keeps working), and an enforcing Authorizer
 *     denies it, so only the vouched runner links a turn there.
 *
 * Any other link is refused with INVALID_ARGUMENT, the guard's own code,
 * never silently dropped: a confused caller learns what happened. And when
 * the turn also carries the stigmer.ai/workflow-execution-id lineage label,
 * the link must name the same run: one fact never has two values.
 *
 * The turn's dispatch queue follows from the link, never from a caller:
 * parentRunQueueOf answers the workflow run's own queue (its sandbox) when
 * the run has one, and "" when it shares the global runner pool, where the
 * turn dispatches as any turn does.
 *
 * VouchWorkflowParent runs on create beside RecordRunnerLineageLabels,
 * after BuildNewState and before GuardReservedLabels. On update,
 * ValidateParentImmutability keeps the stored link: the workflow run a turn
 * was started by is a fact of its creation, as its session is, so an
 * update that leaves the link out keeps it and one that changes it is
 * refused.
 *
 * Proven by __tests__/vouch-workflow-parent.test.ts and the agent-execution
 * conformance suite's parent arms.
 */
import { create, equals } from "@bufbuild/protobuf";

import type {
  AgentRun,
  AgentRunSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  AgentRunSpecSchema,
  WorkflowParentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { mayWriteReservedLabels } from "../../pipeline/steps/guard-reserved-labels.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import type { WorkflowRunQueue } from "../../temporal/workflowexecution/dispatch.js";

import {
  WORKFLOW_PARENT_IMMUTABLE_MESSAGE,
  WORKFLOW_PARENT_NOT_VOUCHED_MESSAGE,
  workflowParentMismatchMessage,
} from "./constants.js";
import { WORKFLOW_EXECUTION_ID_LABEL } from "./record-runner-lineage-labels.js";

type Desc = typeof AgentRunSchema;

export function newVouchWorkflowParentStep(
  provider: RunnerCredentialProvider,
  authorizer: Authorizer,
): PipelineStep<Desc> {
  return {
    name: "VouchWorkflowParent",
    async execute(ctx) {
      const parent = ctx.newState.spec?.parent;
      if (parent === undefined) {
        return;
      }
      const workflowExecutionId = parent.workflowRunId;
      const labelled =
        metadataOf(ctx.newState)?.labels[WORKFLOW_EXECUTION_ID_LABEL] ?? "";
      if (labelled !== "" && labelled !== workflowExecutionId) {
        throw invalidArgumentError(
          workflowParentMismatchMessage(workflowExecutionId, labelled),
        );
      }
      if (isServerComposedRequest(ctx.callerIdentity)) {
        return;
      }
      // The capability throws its own byte-pinned refusal when a
      // workflow-bound credential names another run; false means "not a
      // runner credential", which falls to the operator question.
      const vouch = provider.vouchRunnerLineageLabels;
      if (
        vouch !== undefined &&
        vouch.call(provider, ctx.callerIdentity, workflowExecutionId)
      ) {
        return;
      }
      if (await mayWriteReservedLabels(authorizer, ctx.callerIdentity)) {
        return;
      }
      throw invalidArgumentError(WORKFLOW_PARENT_NOT_VOUCHED_MESSAGE);
    },
  };
}

export function newValidateParentImmutabilityStep(): PipelineStep<Desc> {
  return {
    name: "ValidateParentImmutability",
    execute(ctx) {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | AgentRun
        | undefined;
      const stored = existing?.spec?.parent;
      const merged = ctx.newState;
      merged.spec ??= create(AgentRunSpecSchema);
      const requested = merged.spec.parent;
      if (requested === undefined) {
        merged.spec.parent = stored;
        return;
      }
      if (
        stored === undefined ||
        !equals(WorkflowParentSchema, requested, stored)
      ) {
        throw failedPreconditionError(WORKFLOW_PARENT_IMMUTABLE_MESSAGE);
      }
    },
  };
}

/** The queue a turn's parent link routes it to, or "" for normal dispatch (the module header). */
export function parentRunQueueOf(
  execution: AgentRun,
  workflowRunQueue: WorkflowRunQueue,
): string {
  const parent = execution.spec?.parent;
  return parent === undefined
    ? ""
    : workflowRunQueue(parent.workflowRunId);
}
