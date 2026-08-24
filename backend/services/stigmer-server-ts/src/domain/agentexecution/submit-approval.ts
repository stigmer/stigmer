/**
 * SubmitApproval — ports controller/submit_approval.go: the HITL approval
 * decision writer.
 *
 * Chain per Go: ValidateProto → LoadExisting → ValidateApproval →
 * RecordApprovalDecision → SignalWorkflow → BuildResponse.
 *
 * Behavior by action: APPROVE executes the tool; SKIP feeds a skip
 * message to the LLM; REJECT denies ONE tool call and continues the run
 * (never fails it — the runner feeds the objection back to the model);
 * APPROVE_ALL approves the clicked tool AND auto-approves co-pending
 * calls of the SAME lease class (the clicked tool's built-in category or
 * its MCP server — deriveLeaseScope), leaving other classes gated.
 *
 * The decision recording is one atomic read-modify-write under the store
 * write lock, with a TOCTOU re-check (a concurrent submit that won the
 * race surfaces as Internal, exactly Go's closure error). Idempotency: a
 * repeated identical submit is a no-op answering current state.
 *
 * The approvalGateResolved signal fires ONLY when the unified HITL gate
 * fully clears — no pending approval AND no change set awaiting review.
 * With the engine disconnected (pre-#18) the signal is skipped with a
 * WARN and the decision still persists (Go's nil-creator arm).
 */
import { create } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ApprovalAction,
  ApprovalActionSchema,
  ExecutionPhase,
  ExecutionPhaseSchema,
  MessageType,
  ToolCallStatus,
  ToolCallStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { enumToJson } from "@bufbuild/protobuf";

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
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import { ensureApprovalRequests, recordDecisionEvent } from "./approval/author.js";
import { deriveLeaseScope, sameLeaseScope } from "./approval/lease-scope.js";
import { projectPendingApprovals } from "./approval/project.js";
import type {
  ExecutionEngineStateProvider,
} from "./engine.js";
import { EngineWorkflowNotFoundError } from "./engine.js";
import { countAwaitingReview } from "./filereview/gate.js";
import { settleInterruptedToolCalls } from "./tool-call-settle.js";
import type { StreamBroker } from "./stream-broker.js";

export interface SubmitApprovalDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  readonly engineState: ExecutionEngineStateProvider;
}

type SubmitApprovalDesc =
  typeof AgentExecutionCommandController.method.submitApproval.input;

// Context keys for inter-step communication — Go's key strings, verbatim.
const IS_IDEMPOTENT_REQUEST_KEY = "isIdempotentRequest";
const TARGET_RESOURCE_KEY = "targetResource";

export async function submitApproval(
  deps: SubmitApprovalDeps,
  input: SubmitApprovalInput,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionCommandController.method.submitApproval.input,
    input,
    ApiResourceKind.agent_execution,
  );
  await newPipeline<SubmitApprovalDesc>(
    "agent-execution-submit-approval",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "LoadExisting",
      async execute(ctx) {
        const executionId = ctx.input.agentExecutionId;
        if (executionId === "") {
          throw invalidArgumentError("agent_execution_id is required");
        }
        let execution: AgentExecution;
        try {
          execution = await deps.store.getResource(
            ApiResourceKind.agent_execution,
            executionId,
            AgentExecutionSchema,
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("agent_execution", executionId);
          }
          throw internalError(error, "failed to load agent execution");
        }
        ctx.set(TARGET_RESOURCE_KEY, execution);
      },
    })
    .addStep({
      name: "ValidateApproval",
      execute(ctx) {
        const execution = ctx.get(TARGET_RESOURCE_KEY) as AgentExecution;
        const executionId = execution.metadata?.id ?? "";
        const requestedToolCallId = ctx.input.toolCallId;
        const requestedAction = ctx.input.action;
        const currentPhase =
          execution.status?.phase ??
          ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

        // Approval is accepted during active execution phases where tool
        // calls may await decisions; terminal and pre-start phases refuse.
        if (
          currentPhase !== ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL &&
          currentPhase !== ExecutionPhase.EXECUTION_IN_PROGRESS
        ) {
          throw failedPreconditionError(
            `execution ${executionId} is in phase ${protoName(ExecutionPhaseSchema, currentPhase)}, approval requires EXECUTION_WAITING_FOR_APPROVAL or EXECUTION_IN_PROGRESS`,
          );
        }

        // The ToolCall in messages is the single source of truth.
        const tc = findToolCallInExecution(execution, requestedToolCallId);
        if (tc === undefined) {
          throw invalidArgumentError(
            `tool_call_id ${requestedToolCallId} not found in messages for execution ${executionId}`,
          );
        }

        // Idempotency: a decision already recorded on the ToolCall.
        const existingAction = tc.approvalAction;
        if (existingAction !== ApprovalAction.UNSPECIFIED) {
          if (existingAction === requestedAction) {
            deps.logger.info(
              "IDEMPOTENT: ToolCall already has matching approval action",
              {
                executionId,
                toolCallId: requestedToolCallId,
                action: protoName(ApprovalActionSchema, requestedAction),
              },
            );
            ctx.set(IS_IDEMPOTENT_REQUEST_KEY, true);
            return;
          }
          throw failedPreconditionError(
            `tool call ${requestedToolCallId} already has approval action ${protoName(ApprovalActionSchema, existingAction)}, cannot change to ${protoName(ApprovalActionSchema, requestedAction)}`,
          );
        }

        if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
          throw failedPreconditionError(
            `tool call ${requestedToolCallId} has status ${protoName(ToolCallStatusSchema, tc.status)}, expected TOOL_CALL_WAITING_APPROVAL`,
          );
        }
      },
    })
    .addStep({
      name: "RecordApprovalDecision",
      async execute(ctx) {
        if (ctx.get(IS_IDEMPOTENT_REQUEST_KEY) === true) {
          deps.logger.debug(
            "Skipping approval decision recording for idempotent request",
          );
          return;
        }
        const executionId = ctx.input.agentExecutionId;
        const toolCallId = ctx.input.toolCallId;
        const action = ctx.input.action;
        const comment = ctx.input.comment;
        const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
        // Decider identity for the approval ledger. OSS is single-user
        // with no multi-tenant auth context, so the principal is empty;
        // the Cloud edition populates it from the authenticated caller.
        const decidedBy = "";

        let updated: AgentExecution;
        try {
          updated = await deps.store.updateResource(
            ApiResourceKind.agent_execution,
            executionId,
            AgentExecutionSchema,
            (execution) => {
              // Re-check under the write lock: TOCTOU guard against a
              // concurrent request that recorded a decision between our
              // validation step and this locked update.
              const tc = findToolCallInExecution(execution, toolCallId);
              if (tc === undefined) {
                throw new Error(
                  `tool call ${toolCallId} no longer exists in execution ${executionId}`,
                );
              }
              if (tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
                throw new Error(
                  `tool call ${toolCallId} already has approval action ${protoName(ApprovalActionSchema, tc.approvalAction)} (concurrent approval won the race)`,
                );
              }

              if (execution.status === undefined) {
                execution.status = create(AgentExecutionStatusSchema);
              }

              // Author REQUESTED events BEFORE recording the decision,
              // while every gated tool call is still WAITING — seeds the
              // stream for executions predating the field, so a decision
              // event always has a preceding request.
              ensureApprovalRequests(execution.status, executionId);

              tc.approvalAction = action;
              tc.approvalDecidedAt = now;
              tc.approvedBy = decidedBy;
              // The rich decision event (decided_by + the user's comment)
              // in the same locked write that records the decision on the
              // scan, so it can never be duplicated or clobbered.
              recordDecisionEvent(execution.status, tc, decidedBy, comment);

              // APPROVE_ALL grants a run-lifetime lease scoped to the
              // clicked tool's class; co-pending calls of the SAME class
              // are auto-approved with a plain APPROVE and no comment (the
              // escalation comment belongs to the clicked tool).
              if (action === ApprovalAction.APPROVE_ALL) {
                for (const bulkTc of bulkApproveCoPendingToolCalls(
                  execution,
                  toolCallId,
                  now,
                  decidedBy,
                )) {
                  recordDecisionEvent(execution.status, bulkTc, decidedBy, "");
                }
              }

              // Recompute pending_approvals — the approved entry
              // disappears because its approval_action is now set.
              execution.status.pendingApprovals = projectPendingApprovals(
                execution.status.phase,
                execution.status.messages,
                execution.status.subAgentExecutions,
                execution.status.approvalEventStream,
                deps.logger,
              );
            },
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("agent_execution", executionId);
          }
          throw internalError(error, "failed to persist approval decision");
        }

        deps.logger.info(
          "Recorded approval decision on ToolCall, recomputed pending_approvals",
          {
            executionId,
            toolCallId,
            action: protoName(ApprovalActionSchema, action),
            pendingApprovalsRemaining:
              updated.status?.pendingApprovals.length ?? 0,
          },
        );

        deps.broker.broadcast(updated);
        ctx.set(TARGET_RESOURCE_KEY, updated);
      },
    })
    .addStep({
      name: "SignalWorkflow",
      async execute(ctx) {
        if (ctx.get(IS_IDEMPOTENT_REQUEST_KEY) === true) {
          deps.logger.debug("Skipping workflow signal for idempotent request");
          return;
        }

        const engine = deps.engineState();
        if (!engine.connected) {
          // Go's nil-creator arm: the decision persists; the signal is
          // skipped until #18 connects an engine.
          deps.logger.warn(
            "Workflow creator not available - skipping Temporal signal",
          );
          return;
        }

        const execution = ctx.get(TARGET_RESOURCE_KEY) as AgentExecution;
        const executionId = execution.metadata?.id ?? "";
        const pendingRemaining =
          execution.status?.pendingApprovals.length ?? 0;
        const awaitingReview = countAwaitingReview(
          execution.status?.fileChangeSets ?? [],
        );

        // The HITL gate is unified: a turn resumes only when BOTH
        // sub-gates clear. Clearing the last approval while file review is
        // still pending must NOT resume the turn. REJECT is not special:
        // it resolves exactly one gate, like SKIP.
        if (!(pendingRemaining === 0 && awaitingReview === 0)) {
          deps.logger.info(
            "Approval recorded, HITL gate not yet resolved — waiting",
            {
              executionId,
              toolCallId: ctx.input.toolCallId,
              pendingApprovalsRemaining: pendingRemaining,
              changeSetsAwaitingReview: awaitingReview,
            },
          );
          return;
        }

        try {
          await engine.engine.signalApprovalGateResolved(executionId);
        } catch (error) {
          if (error instanceof EngineWorkflowNotFoundError) {
            deps.logger.warn(
              "Workflow not found - reconciling stale execution status to FAILED",
              { executionId },
            );
            await reconcileStaleExecution(deps, execution);
            throw failedPreconditionError(
              `workflow not running for execution ${executionId} - the backing workflow has terminated unexpectedly and the execution has been marked as failed`,
            );
          }
          throw unavailableError(
            `failed to signal workflow: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        deps.logger.info(
          "Successfully sent approvalGateResolved signal to workflow",
          { executionId },
        );
      },
    })
    .addStep({
      name: "BuildResponse",
      execute(ctx) {
        const execution = ctx.get(TARGET_RESOURCE_KEY) as AgentExecution;
        // Audit log the approval decision (caller identity arrives with
        // the cloud edition's auth context).
        const tc = findToolCallInExecution(execution, ctx.input.toolCallId);
        deps.logger.info("AUDIT: Approval decision submitted", {
          executionId: execution.metadata?.id ?? "",
          org: execution.metadata?.org ?? "",
          toolCallId: ctx.input.toolCallId,
          toolName: tc?.name ?? "unknown",
          action: protoName(ApprovalActionSchema, ctx.input.action),
          comment: ctx.input.comment,
        });
      },
    })
    .build()
    .execute(reqCtx);

  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentExecution;
}

/**
 * Terminalizes an execution stuck in WAITING_FOR_APPROVAL because the
 * backing workflow no longer runs (Go reconcileStaleExecution).
 * Best-effort: a failed persist is logged and the caller still surfaces
 * the WorkflowNotFound refusal. The approval-event ledger is preserved
 * verbatim for the audit trail; pending_approvals is deliberately left
 * empty (a FAILED execution has no actionable approvals). Whole-resource
 * save is intentional: this writes a TERMINAL state with no live appender
 * racing the stream.
 */
async function reconcileStaleExecution(
  deps: SubmitApprovalDeps,
  execution: AgentExecution,
): Promise<void> {
  const executionId = execution.metadata?.id ?? "";

  const reconciled = create(AgentExecutionSchema, {
    apiVersion: execution.apiVersion,
    kind: execution.kind,
    metadata: execution.metadata,
    spec: execution.spec,
    status: {
      phase: ExecutionPhase.EXECUTION_FAILED,
      error:
        "Workflow backing this execution is no longer running. Execution has been marked as failed.",
      messages: execution.status?.messages ?? [],
      audit: execution.status?.audit,
      approvalEventStream: execution.status?.approvalEventStream,
    },
  });

  // A system message explaining what happened.
  reconciled.status?.messages.push(
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_SYSTEM,
      content:
        "The workflow backing this execution is no longer running. This can happen due to infrastructure issues or manual termination. The execution has been marked as failed.",
    }),
  );

  // The gated call that brought the user here — plus any other in-flight
  // call — is still non-terminal; this write terminalizes the execution,
  // so settle them (issue #207).
  settleInterruptedToolCalls(
    reconciled.status,
    new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  );

  try {
    await deps.store.saveResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
      reconciled,
    );
  } catch (error) {
    deps.logger.error(
      "Failed to reconcile stale execution status - execution will remain in WAITING_FOR_APPROVAL until next attempt",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  deps.logger.info(
    "RECONCILIATION: Updated stale execution status to FAILED",
    { executionId },
  );
}

/**
 * The gate-resolving half of an APPROVE_ALL decision, SCOPED to the
 * clicked tool's lease class (Go bulkApproveCoPendingToolCalls): every
 * co-pending call (still WAITING_APPROVAL, no decision) of the SAME lease
 * scope is set to a plain APPROVE (the audit trail stays unambiguous —
 * exactly one tool carries APPROVE_ALL, the user's escalation point);
 * calls of a DIFFERENT class stay WAITING_APPROVAL so the gate keeps
 * waiting for them. Returns the calls it approved so the caller authors a
 * decision event for each.
 */
export function bulkApproveCoPendingToolCalls(
  execution: AgentExecution,
  clickedToolCallId: string,
  decidedAt: string,
  decidedBy: string,
): ToolCall[] {
  const clicked = findToolCallInExecution(execution, clickedToolCallId);
  if (clicked === undefined) {
    return [];
  }
  const clickedScope = deriveLeaseScope(clicked);
  if (clickedScope === undefined) {
    // The clicked tool has no leasable scope (an unknown/ungated name
    // that somehow carried APPROVE_ALL). Nothing else can match it.
    // Defensive — a gated tool always has a scope.
    return [];
  }

  const approved: ToolCall[] = [];
  const approveIfWaitingInScope = (tc: ToolCall): void => {
    if (tc.id === clickedToolCallId) {
      return;
    }
    if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
      return;
    }
    if (tc.approvalAction !== ApprovalAction.UNSPECIFIED) {
      return;
    }
    const scope = deriveLeaseScope(tc);
    if (scope === undefined || !sameLeaseScope(scope, clickedScope)) {
      return;
    }
    tc.approvalAction = ApprovalAction.APPROVE;
    tc.approvalDecidedAt = decidedAt;
    tc.approvedBy = decidedBy;
    approved.push(tc);
  };

  for (const msg of execution.status?.messages ?? []) {
    for (const tc of msg.toolCalls) {
      approveIfWaitingInScope(tc);
    }
  }
  for (const sa of execution.status?.subAgentExecutions ?? []) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        approveIfWaitingInScope(tc);
      }
    }
  }
  return approved;
}

/**
 * Searches for a ToolCall by ID in messages (root and sub-agent). Tool
 * calls live exclusively in messages[].tool_calls.
 */
export function findToolCallInExecution(
  execution: AgentExecution,
  toolCallId: string,
): ToolCall | undefined {
  for (const msg of execution.status?.messages ?? []) {
    for (const tc of msg.toolCalls) {
      if (tc.id === toolCallId) {
        return tc;
      }
    }
  }
  for (const sa of execution.status?.subAgentExecutions ?? []) {
    for (const msg of sa.messages) {
      for (const tc of msg.toolCalls) {
        if (tc.id === toolCallId) {
          return tc;
        }
      }
    }
  }
  return undefined;
}

/** The full proto enum value name — Go's .String() rendering. */
function protoName(
  schema: Parameters<typeof enumToJson>[0],
  value: number,
): string {
  return enumToJson(schema, value) as string;
}
