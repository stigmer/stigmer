/**
 * SubmitFileDecision — ports submit_file_decision.go: forwards a
 * file-review keep/discard decision to the child AgentExecution whose
 * gate is surfaced on this workflow via status.pending_file_reviews. The
 * (child, change_set_id) pair must be surfaced on the parent — a caller
 * can never decide on a gate the workflow has not surfaced.
 *
 * The child's gRPC status PROPAGATES UNCHANGED on forwarding failure —
 * the deliberate asymmetry with SubmitApproval: a digest mismatch or
 * incomplete diff is a real, actionable rejection
 * (FailedPrecondition/InvalidArgument), not a transient transport failure
 * to flatten.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SubmitFileDecisionInput as AgentSubmitFileDecisionInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SubmitFileDecisionInputSchema as AgentSubmitFileDecisionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import type { SubmitWorkflowFileDecisionInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";

/**
 * The narrow agentexecution file-decision edge (Go
 * AgentExecutionFileDecisionClient) — method-segregated from the approval
 * edge; the in-process agentexecution controller satisfies both.
 */
export interface AgentExecutionFileDecisionForwarder {
  submitFileDecision(
    input: AgentSubmitFileDecisionInput,
  ): Promise<AgentExecution>;
}
export type AgentExecutionFileDecisionForwarderProvider =
  () => AgentExecutionFileDecisionForwarder;

export interface SubmitFileDecisionDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly fileDecisionForwarder: AgentExecutionFileDecisionForwarderProvider;
}

type SubmitFileDecisionDesc =
  typeof WorkflowExecutionCommandController.method.submitFileDecision.input;

const TARGET_EXECUTION_KEY = "targetResource";

export async function submitFileDecision(
  deps: SubmitFileDecisionDeps,
  input: SubmitWorkflowFileDecisionInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.submitFileDecision.input,
    input,
    identity,
    ApiResourceKind.workflow_execution,
  );
  await newPipeline<SubmitFileDecisionDesc>(
    "workflow-execution-submit-file-decision",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowExecutionCommandController.method.submitFileDecision,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "LoadExisting",
      async execute(ctx) {
        if (ctx.input.executionId === "") {
          throw invalidArgumentError("execution_id is required");
        }
        let execution: WorkflowExecution;
        try {
          execution = await deps.store.getResource(
            ApiResourceKind.workflow_execution,
            ctx.input.executionId,
            WorkflowExecutionSchema,
          );
        } catch {
          throw notFoundError("workflow_execution", ctx.input.executionId);
        }
        ctx.set(TARGET_EXECUTION_KEY, execution);
      },
    })
    .addStep({
      name: "ValidateFileDecision",
      execute(ctx) {
        const execution = ctx.get(TARGET_EXECUTION_KEY) as WorkflowExecution;
        const executionId = execution.metadata?.id ?? "";
        const childId = ctx.input.childAgentExecutionId;
        const changeSetId = ctx.input.changeSetId;
        const pendingFileReviews = execution.status?.pendingFileReviews ?? [];

        if (pendingFileReviews.length === 0) {
          throw failedPreconditionError(
            `workflow execution ${executionId} has no pending file reviews`,
          );
        }
        const surfaced = pendingFileReviews.some(
          (review) =>
            review.childAgentExecutionId === childId &&
            review.changeSetId.includes(changeSetId),
        );
        if (!surfaced) {
          throw failedPreconditionError(
            `workflow execution ${executionId} has no pending file review for child ${childId} change set ${changeSetId}`,
          );
        }
      },
    })
    .addStep({
      name: "ForwardToChild",
      async execute(ctx) {
        deps.logger.info("Forwarding file decision to child AgentExecution", {
          childExecutionId: ctx.input.childAgentExecutionId,
          changeSetId: ctx.input.changeSetId,
        });
        try {
          await deps.fileDecisionForwarder().submitFileDecision(
            create(AgentSubmitFileDecisionInputSchema, {
              agentExecutionId: ctx.input.childAgentExecutionId,
              changeSetId: ctx.input.changeSetId,
              scope: ctx.input.scope,
              fileChangeId: ctx.input.fileChangeId,
              action: ctx.input.action,
              expectedDigest: ctx.input.expectedDigest,
              reason: ctx.input.reason,
              acknowledgeUnreviewable: ctx.input.acknowledgeUnreviewable,
            }),
          );
        } catch (error) {
          // Propagate the child's STATUS unchanged (code + message) — its
          // completeness and digest gates return actionable rejections the
          // caller must see. Re-minted rather than rethrown: the client-side
          // ConnectError carries the in-process response's metadata, and
          // echoing that envelope through the serving response corrupts the
          // HTTP/2 trailers.
          if (error instanceof ConnectError) {
            throw new ConnectError(error.rawMessage, error.code);
          }
          throw error;
        }
      },
    })
    .addStep({
      name: "BuildResponse",
      execute(ctx) {
        const execution = ctx.get(TARGET_EXECUTION_KEY) as WorkflowExecution;
        deps.logger.info(
          "AUDIT: Workflow file decision submitted and forwarded to child agent",
          {
            workflowExecutionId: execution.metadata?.id ?? "",
            org: execution.metadata?.org ?? "",
            childExecutionId: ctx.input.childAgentExecutionId,
            changeSetId: ctx.input.changeSetId,
          },
        );
      },
    })
    .build()
    .execute(reqCtx);

  const execution = reqCtx.get(TARGET_EXECUTION_KEY);
  if (execution === undefined) {
    throw internalError(
      new Error("execution not found in context"),
      "execution not found in context",
    );
  }
  return execution as WorkflowExecution;
}
