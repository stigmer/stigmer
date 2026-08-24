/**
 * SubmitApproval — ports submit_approval.go: forwards a tool-call
 * approval decision to the child AgentExecution holding the gate (HITL
 * Phase 5.3). The child is identified by the child_agent_execution_id on
 * the pending_approvals entry matched by tool_call_id; the parent's own
 * state is returned unchanged (the gate clears later through the runner's
 * call-agent-status updateStatus).
 *
 * Forwarding failures FLATTEN to Unavailable — the deliberate asymmetry
 * with SubmitFileDecision, which propagates the child's status unchanged
 * (its digest/completeness rejections are actionable; a failed approval
 * forward is treated as transient).
 */
import type { SubmitApprovalInput as AgentSubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SubmitApprovalInputSchema as AgentSubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import type { SubmitWorkflowApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { create } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import type { Store } from "../../store/interface.js";

/**
 * The narrow agentexecution forwarding edge (Go
 * AgentExecutionApprovalClient) — method-segregated from the
 * file-decision edge so each handler depends only on the RPC it uses;
 * the in-process agentexecution controller satisfies both.
 */
export interface AgentExecutionApprovalForwarder {
  submitApproval(input: AgentSubmitApprovalInput): Promise<AgentExecution>;
}
export type AgentExecutionApprovalForwarderProvider =
  () => AgentExecutionApprovalForwarder;

export interface SubmitApprovalDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly approvalForwarder: AgentExecutionApprovalForwarderProvider;
}

type SubmitApprovalDesc =
  typeof WorkflowExecutionCommandController.method.submitApproval.input;

const TARGET_EXECUTION_KEY = "targetResource";
const CHILD_EXECUTION_ID_KEY = "childAgentExecutionId";

export async function submitApproval(
  deps: SubmitApprovalDeps,
  input: SubmitWorkflowApprovalInput,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.submitApproval.input,
    input,
    ApiResourceKind.workflow_execution,
  );
  await newPipeline<SubmitApprovalDesc>(
    "workflow-execution-submit-approval",
    deps.logger,
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
      name: "ValidateApproval",
      execute(ctx) {
        const execution = ctx.get(TARGET_EXECUTION_KEY) as WorkflowExecution;
        const executionId = execution.metadata?.id ?? "";
        const requestedToolCallId = ctx.input.toolCallId;
        const pendingApprovals = execution.status?.pendingApprovals ?? [];

        if (pendingApprovals.length === 0) {
          throw failedPreconditionError(
            `workflow execution ${executionId} has no pending approvals`,
          );
        }

        const matched = pendingApprovals.find(
          (entry) => entry.approval?.toolCallId === requestedToolCallId,
        );
        if (matched === undefined) {
          throw invalidArgumentError(
            `tool_call_id ${requestedToolCallId} not found in pending_approvals for workflow execution ${executionId}`,
          );
        }

        const childExecutionId = matched.childAgentExecutionId;
        if (childExecutionId === "") {
          throw failedPreconditionError(
            `workflow execution ${executionId} has no child agent execution ID for tool_call ${requestedToolCallId} - approval must be submitted directly to the agent`,
          );
        }
        ctx.set(CHILD_EXECUTION_ID_KEY, childExecutionId);
      },
    })
    .addStep({
      name: "ForwardToChild",
      async execute(ctx) {
        const childExecutionId = ctx.get(CHILD_EXECUTION_ID_KEY) as string;
        deps.logger.info("Forwarding approval to child AgentExecution", {
          childExecutionId,
          toolCallId: ctx.input.toolCallId,
        });
        try {
          await deps.approvalForwarder().submitApproval(
            create(AgentSubmitApprovalInputSchema, {
              agentExecutionId: childExecutionId,
              toolCallId: ctx.input.toolCallId,
              action: ctx.input.action,
              comment: ctx.input.comment,
            }),
          );
        } catch (error) {
          // Flattened to Unavailable — Go's %v embeds the child error text.
          throw unavailableError(
            `failed to forward approval to child agent: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    })
    .addStep({
      name: "BuildResponse",
      execute(ctx) {
        const execution = ctx.get(TARGET_EXECUTION_KEY) as WorkflowExecution;
        deps.logger.info(
          "AUDIT: Workflow approval decision submitted and forwarded to child agent",
          {
            workflowExecutionId: execution.metadata?.id ?? "",
            org: execution.metadata?.org ?? "",
            toolCallId: ctx.input.toolCallId,
            childExecutionId: ctx.get(CHILD_EXECUTION_ID_KEY) as string,
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
