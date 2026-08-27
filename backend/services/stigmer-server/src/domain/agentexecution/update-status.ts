/**
 * UpdateStatus — ports controller/update_status.go: the runner's
 * progressive status-update RPC and the domain's single merge chokepoint.
 *
 * Chain per Go: ValidateUpdateStatusInput → MergeAndPersistExecution →
 * NotifyStatusObservers → BroadcastToStreams. The merge+persist is ONE
 * atomic read-modify-write under the store's per-resource write lock
 * (store.updateResource) — the same discipline SubmitApproval uses,
 * load-bearing now that the append-only approval_event_stream is the
 * source of truth for pending_approvals: a non-atomic load-then-save
 * could drop an approval event a concurrent SubmitApproval appended in
 * the window between the load and the save.
 *
 * O4 (20260827.07) consumes the status-transition hooks here — one of
 * the five notifying sites (the exhaustive list: status-observers.ts):
 * observers fire post-persist and before broadcast; the response
 * decorators run on the reply (the §7 querySignal seam — the cloud
 * piggybacks its control signal on this response; OSS answers
 * UNSPECIFIED).
 *
 * applyUpdateStatusMerge is the merge body run inside the updateResource
 * closure (and exercised directly by the guard tests), mirroring the Java
 * BuildNewStateWithStatusStep strategy: most fields are replaced
 * wholesale with the runner's latest complete state, while server-owned
 * fields (approval decisions, the approval_event_stream, the file_review
 * ledger) are preserved/authored here because the runner never sends
 * them.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, PublishToRedis, and
 * Publish steps (broadcast rides in-memory channels per ADR 011).
 */
import { create } from "@bufbuild/protobuf";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  AgentExecutionUpdateStatusInput,
  UpdateStatusResponse,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusObserver,
} from "../../extensions/status-hooks.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import { ensureApprovalRequests } from "./approval/author.js";
import { preserveApprovalFields } from "./approval/preserve.js";
import { projectPendingApprovals } from "./approval/project.js";
import { appendRunnerEvents } from "./filereview/author.js";
import { autoKeepApprovedCommandSets } from "./filereview/autokeep.js";
import { projectFileChangeSets } from "./filereview/project.js";
import { reconcileFileChangeProgress } from "./filereview/progress.js";
import {
  isTerminalExecutionPhase,
  isTranscriptTerminalPhase,
} from "./phases.js";
import {
  applyResponseDecorators,
  notifyStatusObservers,
} from "./status-observers.js";
import { settleInterruptedToolCalls } from "./tool-call-settle.js";
import type { StreamBroker } from "./stream-broker.js";

export interface UpdateStatusDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly broker: StreamBroker;
  /** The composed status-transition observers (O4, DD-006 §3). */
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  /** The composed reply decorators — the §7 querySignal seam (O4). */
  readonly responseDecorators: ReadonlyArray<AgentExecutionResponseDecorator>;
}

type UpdateStatusDesc =
  typeof AgentExecutionCommandController.method.updateStatus.input;

const EXECUTION_KEY = "execution";
// O4-internal handoff (not a ported Go key): the phase read inside the
// updateResource closure BEFORE the merge mutates, for the observer step.
const OLD_PHASE_KEY = "o4OldPhase";

export async function updateStatus(
  deps: UpdateStatusDeps,
  input: AgentExecutionUpdateStatusInput,
  identity: CallerIdentity,
): Promise<UpdateStatusResponse> {
  const reqCtx = new RequestContext(
    AgentExecutionCommandController.method.updateStatus.input,
    input,
    identity,
    ApiResourceKind.agent_execution,
  );
  await newPipeline<UpdateStatusDesc>(
    "agentexecution-update-status",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        AgentExecutionCommandController.method.updateStatus,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateUpdateStatusInput",
      execute(ctx) {
        if (ctx.input.executionId === "") {
          throw invalidArgumentError("execution_id is required");
        }
        if (ctx.input.status === undefined) {
          throw invalidArgumentError("status is required");
        }
      },
    })
    .addStep({
      name: "MergeAndPersistExecution",
      async execute(ctx) {
        let updated: AgentExecution;
        let oldPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
        try {
          updated = await deps.store.updateResource(
            ApiResourceKind.agent_execution,
            ctx.input.executionId,
            AgentExecutionSchema,
            (execution) => {
              oldPhase =
                execution.status?.phase ??
                ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
              applyUpdateStatusMerge(execution, ctx.input, deps.logger);
            },
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("AgentExecution", ctx.input.executionId);
          }
          throw internalError(error, "failed to update execution status");
        }
        // Hand the merged result to the observer + broadcast steps.
        ctx.set(EXECUTION_KEY, updated);
        ctx.set(OLD_PHASE_KEY, oldPhase);
      },
    })
    .addStep({
      name: "NotifyStatusObservers",
      async execute(ctx) {
        const execution = ctx.get(EXECUTION_KEY) as AgentExecution | undefined;
        if (execution === undefined) {
          return; // BroadcastToStreams answers the missing-key fault below.
        }
        await notifyStatusObservers(
          deps,
          execution,
          ctx.get(OLD_PHASE_KEY) as ExecutionPhase,
          execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
        );
      },
    })
    .addStep({
      name: "BroadcastToStreams",
      execute(ctx) {
        const execution = ctx.get(EXECUTION_KEY);
        if (execution === undefined) {
          throw internalError(
            new Error("execution not found in context"),
            "execution not found in context",
          );
        }
        // Push to active subscribers AFTER the persist commits (ADR 011
        // write path) — the ordering subscribe's register-before-snapshot
        // guarantee builds on.
        deps.broker.broadcast(execution as AgentExecution);
      },
    })
    .build()
    .execute(reqCtx);

  // The §7 decorator seam: the cloud contributes its control signal to
  // fields the shared reply schema already carries; the OSS baseline
  // (UNSPECIFIED) is byte-identical when no decorator is composed.
  return applyResponseDecorators(
    deps.responseDecorators,
    deps.logger,
    reqCtx.get(EXECUTION_KEY) as AgentExecution,
    create(UpdateStatusResponseSchema, {
      signal: ExecutionControlSignal.UNSPECIFIED,
    }),
  );
}

/**
 * Whether replacing existing with incoming would drop committed
 * transcript history for a non-terminal execution, plus a short reason
 * for the rejection log. Enforces the append-only-at-identity invariant:
 * a non-terminal transcript may grow and reconcile entries in place, but
 * it may neither shrink nor drop a previously committed tool-call id.
 * Terminal executions (the TRANSCRIPT terminal set — TERMINATED stays
 * protected) may be rewritten freely and so are never a regression here.
 */
export function nonTerminalTranscriptRegression(
  phase: ExecutionPhase,
  existing: AgentMessage[],
  incoming: AgentMessage[],
): { reject: boolean; reason: string } {
  if (isTranscriptTerminalPhase(phase)) {
    return { reject: false, reason: "" };
  }
  if (incoming.length < existing.length) {
    return { reject: true, reason: "would shrink the message transcript" };
  }

  const incomingToolCallIds = new Set<string>();
  for (const m of incoming) {
    for (const tc of m.toolCalls) {
      if (tc.id !== "") {
        incomingToolCallIds.add(tc.id);
      }
    }
  }
  for (const m of existing) {
    for (const tc of m.toolCalls) {
      if (tc.id === "") {
        continue;
      }
      if (!incomingToolCallIds.has(tc.id)) {
        return {
          reject: true,
          reason: "would drop a previously-committed tool call",
        };
      }
    }
  }
  return { reject: false, reason: "" };
}

/**
 * Merges an incoming status update into the execution in place — the
 * runner-owns-the-transcript merge rules, exactly update_status.go
 * applyUpdateStatusMerge. Runs inside the updateResource closure
 * (synchronous by store contract), so the merge, the approval event
 * authoring, and the pending_approvals projection all see the same
 * snapshot that will be persisted.
 */
export function applyUpdateStatusMerge(
  execution: AgentExecution,
  input: AgentExecutionUpdateStatusInput,
  logger: Logger,
): void {
  if (execution.status === undefined) {
    execution.status = create(AgentExecutionStatusSchema);
  }
  const status = execution.status;
  const requestStatus = input.status;
  if (requestStatus === undefined) {
    // Unreachable through the RPC (the validate step refuses); the
    // direct-call guard keeps the merge total.
    return;
  }

  // Snapshot the pre-merge transcript before any replacement: the
  // regression guard compares against the persisted messages, and
  // preserveApprovalFields copies the SubmitApproval-owned decision
  // fields from these existing messages onto the incoming ones.
  // Reassigning status.messages below does not mutate these references.
  const existingMessages = status.messages;
  const existingSubAgents = status.subAgentExecutions;
  const existingPhase = status.phase;

  // Merge messages (replace with latest from request), guarding against
  // any update that would drop committed transcript history for a
  // non-terminal execution. The runner owns the transcript and only ever
  // GROWS it in flight; two regressions are rejected at this single
  // persistence chokepoint:
  //  1. A strictly SHORTER transcript — the classic partial write.
  //  2. A transcript that DROPS a committed tool-call id while appending
  //     enough later turns to keep the count equal-or-greater
  //     (front-truncation, invisible to a count-only check; tool-call
  //     ids are the only stable identity in the transcript).
  // Content is deliberately NOT compared: legitimate updates both grow
  // it (streaming) and blank it in place (the Cursor runner's
  // post-denial narration redaction), so a content check would reject
  // valid writes.
  if (requestStatus.messages.length > 0) {
    const { reject, reason } = nonTerminalTranscriptRegression(
      existingPhase,
      existingMessages,
      requestStatus.messages,
    );
    if (reject) {
      logger.warn(
        "Rejected status update that would drop committed transcript history for a non-terminal execution; keeping existing messages",
        {
          executionId: input.executionId,
          existingMessages: existingMessages.length,
          incomingMessages: requestStatus.messages.length,
          reason,
        },
      );
    } else {
      status.messages = requestStatus.messages;
    }
  }

  // Wholesale presence-guarded replacements (latest from request).
  if (requestStatus.subAgentExecutions.length > 0) {
    status.subAgentExecutions = requestStatus.subAgentExecutions;
  }
  // todos is a map field; Go's len() counts entries.
  if (Object.keys(requestStatus.todos).length > 0) {
    status.todos = requestStatus.todos;
  }
  // Artifacts are published by agents via publish_artifact during
  // execution; the runner persists them through this RPC.
  if (requestStatus.artifacts.length > 0) {
    status.artifacts = requestStatus.artifacts;
  }
  // Write-backs are populated during post-execution processing when the
  // platform detects git changes and creates PRs.
  if (requestStatus.workspaceWriteBacks.length > 0) {
    status.workspaceWriteBacks = requestStatus.workspaceWriteBacks;
  }

  // Preserve approval fields (approval_action, approval_decided_at,
  // approved_by) atomically recorded by SubmitApproval — the runner
  // always sends UNSPECIFIED, so the wholesale replacement above would
  // otherwise erase user decisions.
  preserveApprovalFields(
    status.messages,
    status.subAgentExecutions,
    existingMessages,
    existingSubAgents,
  );

  // Update phase (if provided) — latched once terminal. A terminal phase
  // is final by contract, but a runner activity can outlive its
  // workflow's termination, so a straggler streaming persist can arrive
  // carrying IN_PROGRESS after Terminate already wrote TERMINATED.
  // Without the latch that persist resurrects the phase — and the
  // execution is stuck live forever, because the workflow that would
  // re-terminalize it is gone. Recover is the one sanctioned
  // un-terminalizer and runs through its own lifecycle step, never this
  // merge.
  if (requestStatus.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
    if (
      isTerminalExecutionPhase(existingPhase) &&
      requestStatus.phase !== existingPhase
    ) {
      logger.warn(
        "Ignored phase change on a terminal execution; terminal phases are final (Recover is the sanctioned un-terminalizer)",
        {
          executionId: input.executionId,
          storedPhase: ExecutionPhase[existingPhase],
          ignoredPhase: ExecutionPhase[requestStatus.phase],
        },
      );
    } else {
      status.phase = requestStatus.phase;
    }
  }

  if (requestStatus.error !== "") {
    status.error = requestStatus.error;
  }
  if (requestStatus.startedAt !== "") {
    status.startedAt = requestStatus.startedAt;
  }
  if (requestStatus.completedAt !== "") {
    status.completedAt = requestStatus.completedAt;
  }

  // Defense-in-depth: completed_at must not be set for non-terminal
  // phases. The runner clears completed_at on resume, but the
  // empty-string merge above cannot propagate the clear — this guard
  // prevents the contradictory state (completed_at set +
  // phase=WAITING_FOR_APPROVAL) observed in production.
  if (
    status.phase === ExecutionPhase.EXECUTION_IN_PROGRESS ||
    status.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL ||
    status.phase === ExecutionPhase.EXECUTION_PENDING
  ) {
    status.completedAt = "";
  }

  // Terminal invariant (issue #207): a terminal execution carries zero
  // non-terminal tool calls. Settling here — at the single merge
  // chokepoint — covers every updateStatus writer without any of them
  // having to remember it, and composes with the phase latch into a
  // self-healing pair: a straggler persist that reintroduces RUNNING rows
  // cannot move the terminal phase, so its rows are re-settled in the
  // same merge. Runs before ensureApprovalRequests so a gated call on a
  // dead execution never seeds a REQUESTED approval event.
  if (isTerminalExecutionPhase(status.phase)) {
    let settledAt = status.completedAt;
    if (settledAt === "") {
      settledAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    const settled = settleInterruptedToolCalls(status, settledAt);
    if (settled > 0) {
      logger.info(
        "Settled in-flight tool calls to TOOL_CALL_INTERRUPTED on terminal execution",
        {
          executionId: input.executionId,
          phase: ExecutionPhase[status.phase],
          settledToolCalls: settled,
        },
      );
    }
  }

  // Author REQUESTED events for any tool call now in the approval gate
  // (seeding the persisted stream the first time it is touched). The
  // runner never sends this server-only field; it is carried over from
  // the loaded resource and mutated in place here. Decisions are authored
  // separately by SubmitApproval. Because this runs inside the
  // updateResource write lock on the freshly-loaded stream, the events it
  // appends can never clobber a decision a concurrent SubmitApproval
  // appended.
  ensureApprovalRequests(status, input.executionId);

  // Compute pending_approvals from the authored event stream, via the
  // single projection seam (returns the event-stream projection and runs
  // the scan parity cross-check).
  status.pendingApprovals = projectPendingApprovals(
    status.phase,
    status.messages,
    status.subAgentExecutions,
    status.approvalEventStream,
    logger,
  );

  // Fold the runner-authored capture/reconcile events (carried on the
  // request payload) into the server-owned ledger: append-only,
  // idempotent by event_id, FILE_DECIDED dropped (server-authored by
  // SubmitFileDecision).
  appendRunnerEvents(status, input.executionId, requestStatus);

  // Approved-command auto-keep (DD-28): a candidate whose provenance
  // verifies against the server-authored approval record is decided by
  // policy IN THE SAME WRITE that folded it, so the gate never arms for a
  // set the user already consented to via the command approval.
  autoKeepApprovedCommandSets(
    status,
    input.executionId,
    execution.spec?.autoApproveAll ?? false,
    logger,
  );

  // Recompute file_change_sets from the append-only ledger via its single
  // projection seam — always derived, never merged, so it cannot go
  // stale.
  status.fileChangeSets = projectFileChangeSets(
    status.phase,
    status.fileReviewEventStream,
  );

  // Mid-run live capture (DD-32): merge the runner-owned transient
  // progress snapshot (presence-guarded replace, like streaming_usage
  // below), then clear it unless its change set is still CAPTURING — run
  // here so it sees the freshly-projected file_change_sets.
  if (requestStatus.fileChangeProgress !== undefined) {
    status.fileChangeProgress = requestStatus.fileChangeProgress;
  }
  status.fileChangeProgress = reconcileFileChangeProgress(
    status.fileChangeSets,
    status.fileChangeProgress,
  );

  // Merge streaming_usage (replace with latest from request): a
  // display-only fallback when proxy-reported usage is unavailable.
  if (requestStatus.streamingUsage !== undefined) {
    status.streamingUsage = requestStatus.streamingUsage;
  }

  // Merge recalled_memories_report: runner-owned, written at most once
  // per execution at prompt build (DD-008 D5). Later persists omit it, so
  // this presence guard is what preserves the stored report across the
  // execution's remaining status writes.
  if (requestStatus.recalledMemoriesReport !== undefined) {
    status.recalledMemoriesReport = requestStatus.recalledMemoriesReport;
  }

  if (requestStatus.contextInfo !== undefined) {
    status.contextInfo = requestStatus.contextInfo;
  }

  if (requestStatus.setupProgress !== undefined) {
    status.setupProgress = requestStatus.setupProgress;
  }
  // Clear setup_progress when phase leaves PENDING (defense-in-depth):
  // the worker stops sending it once streaming begins, but an explicit
  // clear prevents stale data if the phase transitions via a different
  // code path.
  if (status.phase !== ExecutionPhase.EXECUTION_PENDING) {
    status.setupProgress = undefined;
  }

  // Merge structured_output: populated by the runner on COMPLETED when
  // ExecutionConfig had structured_output_schema; immutable after first
  // population.
  if (requestStatus.structuredOutput !== undefined) {
    status.structuredOutput = requestStatus.structuredOutput;
  }

  logger.debug("Merged status fields", {
    executionId: input.executionId,
    phase: ExecutionPhase[status.phase],
    messagesCount: status.messages.length,
    pendingApprovalsCount: status.pendingApprovals.length,
  });
}
