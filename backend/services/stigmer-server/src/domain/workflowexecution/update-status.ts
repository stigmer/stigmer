/**
 * UpdateStatus — ports controller/update_status.go: the runner's
 * progressive status-update RPC (merge + persist + event append + stream
 * broadcast — the OSS replacement for cloud's Redis write path).
 *
 * Chain per Go: ValidateUpdateStatusInput → merge+persist → PersistEvents
 * → BroadcastToStreams. Go still does the merge as a separate
 * LoadExisting step followed by a plain SaveResource — a lost-update
 * window under concurrent updates. This port runs the SAME merge body
 * inside the store's atomic `updateResource` instead (sub-project DD-001,
 * owner-ratified): Go's own agentexecution domain already calls that
 * discipline load-bearing, and this domain's per-child pending-gate merge
 * is exactly the concurrent-children write that the window can corrupt.
 * Wire-identical in sequential flows; strictly safer under concurrency;
 * the Go-side race is filed as an OSS issue.
 *
 * applyUpdateStatusMerge is the merge body run inside the updateResource
 * closure (and exercised directly by the guard tests), mirroring the
 * cloud handler's strategy: presence-guarded field merges (tasks replaced
 * wholesale, counters only when > 0), the flag-gated per-child
 * pending_approvals / pending_file_reviews merge, and the
 * phase-transition-only statusAudit bump (heartbeats must not perpetually
 * re-sort long-running executions above new ones in the recents sidebar).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, PublishToRedis, and
 * Publish steps (broadcast rides in-memory channels per ADR 011).
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowExecutionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionUpdateStatusInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type {
  Store,
  WorkflowExecutionEventRecord,
} from "../../store/interface.js";

import type { StreamBroker } from "./stream-broker.js";

export interface UpdateStatusDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  readonly broker: StreamBroker;
}

type UpdateStatusDesc =
  typeof WorkflowExecutionCommandController.method.updateStatus.input;

const EXECUTION_KEY = "execution";

export async function updateStatus(
  deps: UpdateStatusDeps,
  input: WorkflowExecutionUpdateStatusInput,
  identity: CallerIdentity,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.updateStatus.input,
    input,
    identity,
    ApiResourceKind.workflow_execution,
  );
  await newPipeline<UpdateStatusDesc>(
    "workflowexecution-update-status",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowExecutionCommandController.method.updateStatus,
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
        let updated: WorkflowExecution;
        try {
          updated = await deps.store.updateResource(
            ApiResourceKind.workflow_execution,
            ctx.input.executionId,
            WorkflowExecutionSchema,
            (execution) => {
              applyUpdateStatusMerge(execution, ctx.input);
            },
          );
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            // Go's LoadExistingExecution answers this exact NotFound.
            throw notFoundError("WorkflowExecution", ctx.input.executionId);
          }
          throw internalError(error, "failed to update execution status");
        }
        ctx.set(EXECUTION_KEY, updated);
        deps.logger.info("Successfully updated execution status", {
          executionId: ctx.input.executionId,
          phase:
            ExecutionPhase[
              updated.status?.phase ??
                ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED
            ],
        });
      },
    })
    .addStep({
      name: "PersistEvents",
      async execute(ctx) {
        await persistEvents(deps, ctx.input);
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
        deps.broker.broadcast(execution as WorkflowExecution);
      },
    })
    .build()
    .execute(reqCtx);

  const merged = reqCtx.get(EXECUTION_KEY);
  if (merged === undefined) {
    throw internalError(
      new Error("execution not found in context after pipeline"),
      "execution not found in context after pipeline",
    );
  }
  return merged as WorkflowExecution;
}

/**
 * mergePendingByChild — a per-child upsert of a workflow status list
 * (pending_approvals or pending_file_reviews): drops the existing entries
 * that belong to scopeChildId and appends the incoming entries (which
 * must all belong to scopeChildId). Every other child's entries are
 * preserved untouched, so parallel child agents surfacing/clearing their
 * own gates never clobber each other. An empty incoming list therefore
 * clears just scopeChildId's entries.
 *
 * childOf extracts an entry's owning child_agent_execution_id. Kept
 * generic so the approval and file-review lists share exactly one merge
 * semantic (Go's mergePendingByChild).
 */
export function mergePendingByChild<T>(
  existing: readonly T[],
  incoming: readonly T[],
  childOf: (entry: T) => string,
  scopeChildId: string,
): T[] {
  const merged: T[] = [];
  for (const entry of existing) {
    if (childOf(entry) !== scopeChildId) {
      merged.push(entry);
    }
  }
  merged.push(...incoming);
  return merged;
}

/**
 * The merge body run inside the updateResource closure — Go
 * BuildNewStateWithStatusStep field-for-field. Mutates `execution` in
 * place over the freshly-loaded, write-locked state. Synchronous by
 * contract (the store's modify callback), which is also what makes it
 * directly unit-testable.
 */
export function applyUpdateStatusMerge(
  execution: WorkflowExecution,
  input: WorkflowExecutionUpdateStatusInput,
): void {
  if (execution.status === undefined) {
    execution.status = create(WorkflowExecutionStatusSchema);
  }
  const status = execution.status;
  const requestStatus = input.status;
  if (requestStatus === undefined) {
    return;
  }

  // The phase-transition check compares against the phase BEFORE this
  // merge writes it (Go compares to `existing`, its pre-clone snapshot).
  const previousPhase = status.phase;

  // Tasks: replaced wholesale with the runner's latest complete set.
  if (requestStatus.tasks.length > 0) {
    status.tasks = requestStatus.tasks;
  }

  if (requestStatus.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
    status.phase = requestStatus.phase;
  }
  if (requestStatus.output !== undefined) {
    status.output = requestStatus.output;
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
  if (requestStatus.temporalWorkflowId !== "") {
    status.temporalWorkflowId = requestStatus.temporalWorkflowId;
  }

  // Cost/token totals: the runner sends accumulated totals; zero means
  // "no update", never "reset".
  if (requestStatus.totalCostMicros > 0n) {
    status.totalCostMicros = requestStatus.totalCostMicros;
  }
  if (requestStatus.totalInputTokens > 0n) {
    status.totalInputTokens = requestStatus.totalInputTokens;
  }
  if (requestStatus.totalOutputTokens > 0n) {
    status.totalOutputTokens = requestStatus.totalOutputTokens;
  }

  // Guarded, per-child merge: only touch pending_approvals /
  // pending_file_reviews when explicitly requested, and even then replace
  // only the scoped child's entries. This both prevents event emissions
  // (which don't include these lists) from clobbering active gates set by
  // call-agent-status, and prevents parallel child agents from clobbering
  // each other's gates.
  const scopeChildId = input.pendingUpdateChildAgentExecutionId;
  if (input.updatePendingApprovals) {
    status.pendingApprovals = mergePendingByChild(
      status.pendingApprovals,
      requestStatus.pendingApprovals,
      (entry) => entry.childAgentExecutionId,
      scopeChildId,
    );
  }
  if (input.updatePendingFileReviews) {
    status.pendingFileReviews = mergePendingByChild(
      status.pendingFileReviews,
      requestStatus.pendingFileReviews,
      (entry) => entry.childAgentExecutionId,
      scopeChildId,
    );
  }

  // Only bump statusAudit.updatedAt on phase transitions — not on every
  // task-progress heartbeat from the runner. This prevents long-running
  // executions from perpetually sorting above freshly created ones in the
  // recents sidebar (ActivityQueryController orders by this field).
  // Mirrors the cloud's WorkflowExecutionUpdateStatusHandler exactly.
  const isPhaseTransition =
    requestStatus.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED &&
    requestStatus.phase !== previousPhase;
  if (isPhaseTransition) {
    const audit = status.audit ?? create(ApiResourceAuditSchema);
    status.audit = audit;
    const statusAudit = audit.statusAudit ?? create(ApiResourceAuditInfoSchema);
    audit.statusAudit = statusAudit;
    statusAudit.updatedAt = timestampNow();
    statusAudit.event = "updated";
  }
}

/**
 * PersistEvents — appends the input's events to the event log. Events are
 * supplementary: a failure here does NOT fail the pipeline because status
 * persistence already succeeded. A real append failure means timeline
 * data loss, so it logs at error level; skipped duplicates are the
 * expected result of the runner's idempotent batch retries and only log
 * at debug (the store's INSERT OR IGNORE first-writer-wins, oss#308).
 */
async function persistEvents(
  deps: UpdateStatusDeps,
  input: WorkflowExecutionUpdateStatusInput,
): Promise<void> {
  if (input.events.length === 0) {
    return;
  }
  const executionId = input.executionId;

  const records: WorkflowExecutionEventRecord[] = [];
  for (const event of input.events) {
    let data: Uint8Array;
    try {
      data = toBinary(WorkflowExecutionEventSchema, event);
    } catch (error) {
      deps.logger.error(
        "Failed to marshal event — dropping batch (non-fatal, timeline data lost)",
        {
          executionId,
          sequenceNumber: event.sequenceNumber,
          eventCount: input.events.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
    records.push({
      executionId,
      sequenceNumber: Number(event.sequenceNumber),
      eventType: WorkflowEventType[event.eventType] ?? "",
      taskName: event.taskName,
      data,
      createdAt: "",
    });
  }

  let appended: number;
  try {
    appended = await deps.store.appendWorkflowExecutionEvents(
      executionId,
      records,
    );
  } catch (error) {
    deps.logger.error(
      "Failed to persist execution events (non-fatal, timeline data lost)",
      {
        executionId,
        submitted: records.length,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  const skipped = records.length - appended;
  if (skipped > 0) {
    deps.logger.debug(
      "Persisted execution events (idempotent retry skipped already-persisted sequences)",
      { executionId, appended, skippedDuplicates: skipped },
    );
  } else {
    deps.logger.debug("Persisted execution events", { executionId, appended });
  }
}
