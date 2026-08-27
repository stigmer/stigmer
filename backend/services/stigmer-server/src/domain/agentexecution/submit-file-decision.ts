/**
 * SubmitFileDecision — ports controller/submit_file_decision.go: the
 * backend-owned writer of FILE_DECIDED events on the append-only
 * file_review stream (apply-then-review HITL). FileChangeSet.decisions is
 * the derived projection; the runner's reconcile applies the approved
 * bytes — this RPC records the decision and enforces that
 * expected_digest still matches the captured content the user reviewed
 * ("what you approve is what gets applied").
 *
 * Chain mirrors the approval pipeline: ValidateProto → LoadExisting →
 * ValidateDecision → RecordFileDecision → SignalWorkflow →
 * BuildResponse. The signal is the SAME approvalGateResolved — the HITL
 * gate is unified, so a turn blocked on file review (and possibly tool
 * approvals too) resumes through one signal and one wait. Unlike
 * approvals, a file REJECT has no immediate-resume shortcut — every file
 * in the set must be decided (or one CHANGE_SET-scoped decision cover
 * them) before the runner reconciles.
 *
 * Idempotency: a decision with the same deterministic event id already on
 * the stream is a no-op answering current state.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionPhase,
  ExecutionPhaseSchema,
  FileDecisionAction,
  FileDecisionActionSchema,
  FileDecisionScope,
  FileDecisionScopeSchema,
  FileReviewEventType,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { FileReviewEventStream } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { SubmitFileDecisionInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { enumToJson } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { AgentExecutionStatusObserver } from "../../extensions/status-hooks.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import type { ExecutionEngineStateProvider } from "./engine.js";
import { EngineWorkflowNotFoundError } from "./engine.js";
import {
  buildFileDecision,
  eventId as fileReviewEventId,
  findChange,
  findChangeSet,
  approveBlockedReason,
  recordFileDecisionEvent,
  targetDigest,
} from "./filereview/author.js";
import { countAwaitingReview, gateResolved } from "./filereview/gate.js";
import { projectFileChangeSets } from "./filereview/project.js";
import { notifyStatusObservers } from "./status-observers.js";
import { settleInterruptedToolCalls } from "./tool-call-settle.js";
import type { StreamBroker } from "./stream-broker.js";

export interface SubmitFileDecisionDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly broker: StreamBroker;
  readonly engineState: ExecutionEngineStateProvider;
  /** O4: the stale-workflow reconcile's →FAILED stamp is a notified transition. */
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
}

type SubmitFileDecisionDesc =
  typeof AgentExecutionCommandController.method.submitFileDecision.input;

// Go's key strings, verbatim.
const FILE_DECISION_IDEMPOTENT_KEY = "isIdempotentFileDecision";
const TARGET_RESOURCE_KEY = "targetResource";

export async function submitFileDecision(
  deps: SubmitFileDecisionDeps,
  input: SubmitFileDecisionInput,
  identity: CallerIdentity,
): Promise<AgentExecution> {
  const reqCtx = new RequestContext(
    AgentExecutionCommandController.method.submitFileDecision.input,
    input,
    identity,
    ApiResourceKind.agent_execution,
  );
  await newPipeline<SubmitFileDecisionDesc>(
    "agent-execution-submit-file-decision",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionCommandController.method.submitFileDecision,
        deps.authorizer,
      ),
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
      name: "ValidateDecision",
      execute(ctx) {
        const execution = ctx.get(TARGET_RESOURCE_KEY) as AgentExecution;
        validateFileDecisionTarget(execution, ctx.input);

        // Idempotency: the same deterministic event id already on the
        // stream means this exact decision was recorded.
        if (
          streamHasFileDecision(
            execution.status?.fileReviewEventStream,
            ctx.input,
          )
        ) {
          deps.logger.info("IDEMPOTENT: file decision already recorded", {
            executionId: execution.metadata?.id ?? "",
            changeSetId: ctx.input.changeSetId,
            fileChangeId: ctx.input.fileChangeId,
          });
          ctx.set(FILE_DECISION_IDEMPOTENT_KEY, true);
        }
      },
    })
    .addStep({
      name: "RecordFileDecision",
      async execute(ctx) {
        if (ctx.get(FILE_DECISION_IDEMPOTENT_KEY) === true) {
          return;
        }
        const executionId = ctx.input.agentExecutionId;
        const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
        // OSS is single-user with no multi-tenant auth context, so the
        // reviewer is empty; the Cloud edition populates reviewer_id from
        // the authenticated caller.
        const reviewerId = "";

        let updated: AgentExecution;
        try {
          updated = await deps.store.updateResource(
            ApiResourceKind.agent_execution,
            executionId,
            AgentExecutionSchema,
            (execution) => {
              // Re-validate under the write lock against the
              // freshly-loaded state (guards against a capture/decision
              // that landed between the pre-lock validation and this
              // update).
              validateFileDecisionTarget(execution, ctx.input);
              if (execution.status === undefined) {
                execution.status = create(AgentExecutionStatusSchema);
              }

              const decision = buildFileDecision(
                ctx.input.changeSetId,
                ctx.input.fileChangeId,
                ctx.input.scope,
                ctx.input.action,
                ctx.input.expectedDigest,
                reviewerId,
                now,
                ctx.input.reason,
                ctx.input.acknowledgeUnreviewable,
              );
              recordFileDecisionEvent(execution.status, executionId, decision);

              // Recompute file_change_sets from the authored ledger via
              // the single projection seam, so the new decision reflects
              // immediately and consistently with the source of truth.
              execution.status.fileChangeSets = projectFileChangeSets(
                execution.status.phase,
                execution.status.fileReviewEventStream,
              );
            },
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("agent_execution", executionId);
          }
          // A precondition failure re-detected under the lock is already a
          // status error (client fault); surface it verbatim rather than
          // masking it as INTERNAL.
          if (error instanceof ConnectError) {
            throw error;
          }
          throw internalError(error, "failed to persist file decision");
        }

        deps.broker.broadcast(updated);
        ctx.set(TARGET_RESOURCE_KEY, updated);
      },
    })
    .addStep({
      name: "SignalWorkflow",
      async execute(ctx) {
        if (ctx.get(FILE_DECISION_IDEMPOTENT_KEY) === true) {
          deps.logger.debug(
            "Skipping workflow signal for idempotent file decision",
          );
          return;
        }
        const engine = deps.engineState();
        if (!engine.connected) {
          deps.logger.warn(
            "Workflow creator not available - skipping Temporal signal",
          );
          return;
        }

        const execution = ctx.get(TARGET_RESOURCE_KEY) as AgentExecution;
        const executionId = execution.metadata?.id ?? "";
        const status = execution.status;

        // Resume only when the WHOLE gate is clear: no change set awaiting
        // review and no tool approval pending.
        if (status === undefined || !gateResolved(status)) {
          deps.logger.info(
            "File decision recorded, HITL gate not yet resolved — waiting",
            {
              executionId,
              changeSetId: ctx.input.changeSetId,
              pendingApprovalsRemaining: status?.pendingApprovals.length ?? 0,
              changeSetsAwaitingReview: countAwaitingReview(
                status?.fileChangeSets ?? [],
              ),
            },
          );
          return;
        }

        deps.logger.info(
          "HITL gate resolved by file decision — sending approvalGateResolved signal",
          { executionId, changeSetId: ctx.input.changeSetId },
        );

        try {
          await engine.engine.signalApprovalGateResolved(executionId);
        } catch (error) {
          if (error instanceof EngineWorkflowNotFoundError) {
            deps.logger.warn(
              "Workflow not found - reconciling stale execution status to FAILED",
              { executionId },
            );
            await reconcileStaleFileReviewExecution(deps, execution);
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
        deps.logger.info("AUDIT: File decision submitted", {
          executionId: execution.metadata?.id ?? "",
          org: execution.metadata?.org ?? "",
          changeSetId: ctx.input.changeSetId,
          fileChangeId: ctx.input.fileChangeId,
          scope: enumToJson(FileDecisionScopeSchema, ctx.input.scope),
          action: enumToJson(FileDecisionActionSchema, ctx.input.action),
        });
      },
    })
    .build()
    .execute(reqCtx);

  return reqCtx.get(TARGET_RESOURCE_KEY) as AgentExecution;
}

/**
 * Enforces the preconditions against the current projection: non-terminal
 * execution, change set (and file) existence, the FILE-scope
 * file_change_id requirement, the APPROVE completeness gate, and the
 * expected_digest enforcement gate. Shared by the pre-lock validate step
 * and the under-lock re-check (Go validateFileDecisionTarget).
 */
function validateFileDecisionTarget(
  execution: AgentExecution,
  input: SubmitFileDecisionInput,
): void {
  const executionId = execution.metadata?.id ?? "";
  const phase =
    execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const changeSets = projectFileChangeSets(
    phase,
    execution.status?.fileReviewEventStream,
  );
  if (changeSets.length === 0) {
    throw failedPreconditionError(
      `execution ${executionId} has no actionable file change sets (phase ${enumToJson(ExecutionPhaseSchema, phase) as string})`,
    );
  }

  const cs = findChangeSet(changeSets, input.changeSetId);
  if (cs === undefined) {
    throw failedPreconditionError(
      `change set ${input.changeSetId} not found for execution ${executionId}`,
    );
  }

  if (input.scope === FileDecisionScope.FILE) {
    if (input.fileChangeId === "") {
      throw invalidArgumentError("file_change_id is required for FILE scope");
    }
    if (findChange(cs, input.fileChangeId) === undefined) {
      throw failedPreconditionError(
        `file change ${input.fileChangeId} not found in change set ${input.changeSetId}`,
      );
    }
  }

  // Completeness precondition: a non-COMPLETE diff can never be approved
  // as if complete. Gated before the digest check and only for APPROVE,
  // so an unreviewable change stays discardable (REJECT) and the turn can
  // still resume.
  if (input.action === FileDecisionAction.APPROVE) {
    const reason = approveBlockedReason(
      cs,
      input.scope,
      input.fileChangeId,
      input.acknowledgeUnreviewable,
    );
    if (reason !== "") {
      throw failedPreconditionError(reason);
    }
  }

  const target = targetDigest(cs, input.scope, input.fileChangeId);
  if (input.expectedDigest !== target) {
    throw invalidArgumentError(
      `expected_digest mismatch for change set ${input.changeSetId}: the captured content changed since it was reviewed`,
    );
  }
}

function streamHasFileDecision(
  stream: FileReviewEventStream | undefined,
  input: SubmitFileDecisionInput,
): boolean {
  let scopeId = input.changeSetId;
  if (input.scope === FileDecisionScope.FILE) {
    scopeId = input.fileChangeId;
  }
  const id = fileReviewEventId(
    input.changeSetId,
    scopeId,
    FileReviewEventType.FILE_DECIDED,
  );
  return (stream?.events ?? []).some((ev) => ev.eventId === id);
}

/**
 * Marks an execution FAILED when its backing workflow is gone — the
 * file-review twin of the approval path's reconcile; BOTH append-only
 * ledgers are preserved verbatim for the audit trail, the projections
 * left empty (terminal).
 */
async function reconcileStaleFileReviewExecution(
  deps: SubmitFileDecisionDeps,
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
      fileReviewEventStream: execution.status?.fileReviewEventStream,
    },
  });
  reconciled.status?.messages.push(
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_SYSTEM,
      content:
        "The workflow backing this execution is no longer running. This can happen due to infrastructure issues or manual termination. The execution has been marked as failed.",
    }),
  );

  // Any in-flight tool call is still non-terminal; this write
  // terminalizes the execution, so settle them (issue #207).
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
    "RECONCILIATION: Updated stale file-review execution status to FAILED",
    { executionId },
  );

  // O4 site 5 of 5 (status-observers.ts): the reconcile's →FAILED stamp
  // is a persisted terminal transition.
  await notifyStatusObservers(
    deps,
    reconciled,
    execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    ExecutionPhase.EXECUTION_FAILED,
  );
}
