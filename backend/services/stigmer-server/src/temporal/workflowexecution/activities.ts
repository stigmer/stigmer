/**
 * Server-side activity implementations for the workflow-execution worker —
 * ports pkg/domain/workflowexecution/temporal/activities
 * (update_status_impl.go) and registers #15's DeleteExecutionContext seam.
 *
 * UpdateWorkflowExecutionStatus deliberately does NOT reuse the domain's
 * updateStatus RPC merge (the choice agentexecution's port made): in Go
 * the two merges are DIFFERENT code with different semantics, and the
 * differences are wire-visible for exactly the payloads this workflow
 * sends (sub-project DD-001 brief, owner-ratified):
 *
 *   - The activity bumps statusAudit.updatedAt on EVERY call; the RPC
 *     bumps only on phase TRANSITIONS (the recents-sidebar rule). A
 *     defense re-assert of an unchanged phase must keep bumping.
 *   - The activity never touches events, output, temporal_workflow_id,
 *     or the pending gate lists.
 *   - A missing execution is an ordinary wrapped activity error
 *     ("workflow execution not found: …"), not the RPC's NotFound.
 *
 * What IS adopted from the domain: the atomic `updateResource` persist
 * (the #20 DD-001 posture — Go's activity is a load-then-save with the
 * same lost-update window its RPC has; not ported) and the post-persist
 * broadcast through the domain's StreamBroker (Go wires the same broker
 * into both).
 *
 * Payload boundary (sub-project 20260824.03 design rule): statuses cross
 * as proto-JSON — the TS default payload converter cannot serialize the
 * bigint int64 fields of typed messages. Server-internal payloads; only
 * the activity NAMES are byte-pinned.
 */
import { create, fromJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { StreamBroker } from "../../domain/workflowexecution/stream-broker.js";
import {
  DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
  deleteExecutionContextForExecution,
} from "../../domain/executioncontext/temporal/delete-execution-context.js";
import type { WorkflowSandboxTerminalObserver } from "../../sandbox/steps.js";
import type { Store } from "../../store/interface.js";
import { UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME } from "./names.js";

export interface WorkflowExecutionActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  /**
   * Fires the workflow-sandbox teardown on terminal transitions (§6d,
   * O6) — this activity is the orchestrator's failure/cancellation
   * persist site, one of the three status write sites the Q3b ruling
   * wires.
   */
  readonly sandboxTerminalObserver: WorkflowSandboxTerminalObserver;
}

/**
 * Builds the activity record the worker registers. Keys are the
 * byte-pinned activity names; the runner-owned child workflow is
 * deliberately NOT here — a worker registering the other side's names
 * would break queue-based routing (worker_config.go's contract).
 */
export function createWorkflowExecutionActivities(
  deps: WorkflowExecutionActivityDeps,
): Record<string, (...args: never[]) => Promise<unknown>> {
  const { store, logger, broker, sandboxTerminalObserver } = deps;

  return {
    /**
     * The orchestrator's status persist, invoked as a LOCAL activity
     * (pause/resume handlers) AND a REGULAR activity (failure/
     * cancellation paths) — one implementation serves both modes,
     * exactly one named registration (see names.ts's DD-002 note on why
     * the NAME is load-bearing).
     */
    [UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME]: async (
      executionId: string,
      statusJson: JsonValue,
    ): Promise<void> => {
      const statusUpdates = fromJson(WorkflowExecutionStatusSchema, statusJson);

      let updated: WorkflowExecution;
      // The phase BEFORE this merge, read under the write lock — the
      // sandbox observer below keys on the transition (§6d, O6).
      let previousPhase = ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      try {
        updated = await store.updateResource(
          ApiResourceKind.workflow_execution,
          executionId,
          WorkflowExecutionSchema,
          (execution) => {
            previousPhase =
              execution.status?.phase ??
              ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
            applyActivityStatusMerge(execution, statusUpdates);
          },
        );
      } catch (error) {
        // Go wraps EVERY load/save failure with this one text ("workflow
        // execution not found: %w" — update_status_impl.go names the
        // load; the atomic persist folds both arms into it).
        throw new Error(
          `workflow execution not found: ${errorText(error)}`,
          { cause: error },
        );
      }

      logger.info("Activity updated workflow execution status", {
        execution_id: executionId,
        phase:
          ExecutionPhase[
            updated.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED
          ],
        tasks: updated.status?.tasks.length ?? 0,
      });

      // Broadcast to active subscribers AFTER the persist commits
      // (ADR 011 write path) — failure recovery updates must be
      // immediately visible to externally-connected subscribe streams.
      broker.broadcast(updated);
      // A terminal transition (the orchestrator's FAILED/CANCELLED
      // persists) tears the per-execution sandbox down, fire-and-forget.
      sandboxTerminalObserver(
        executionId,
        previousPhase,
        updated.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
      );
    },

    /** #15's seam, shared with the agent-execution worker exactly as in Go. */
    [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: async (
      executionId: string,
    ): Promise<void> => {
      await deleteExecutionContextForExecution(store, logger, executionId);
    },
  };
}

/**
 * The ACTIVITY's merge body (update_status_impl.go UpdateExecutionStatus,
 * field-for-field), run inside the store's atomic updateResource closure.
 * Deliberately NOT applyUpdateStatusMerge from the domain's RPC path —
 * see the module header for the wire-visible differences. Exported for
 * the co-located unit tests.
 */
export function applyActivityStatusMerge(
  execution: WorkflowExecution,
  statusUpdates: WorkflowExecutionStatus,
): void {
  if (execution.status === undefined) {
    execution.status = create(WorkflowExecutionStatusSchema);
  }
  const status = execution.status;

  // Tasks: replaced wholesale with the worker's latest complete set.
  if (statusUpdates.tasks.length > 0) {
    status.tasks = statusUpdates.tasks;
  }
  if (statusUpdates.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) {
    status.phase = statusUpdates.phase;
  }
  if (statusUpdates.error !== "") {
    status.error = statusUpdates.error;
  }
  if (statusUpdates.startedAt !== "") {
    status.startedAt = statusUpdates.startedAt;
  }
  if (statusUpdates.completedAt !== "") {
    status.completedAt = statusUpdates.completedAt;
  }
  // Cost/token aggregates: monotonically increasing, always take the
  // latest value; zero means "no update", never "reset".
  if (statusUpdates.totalCostMicros > 0n) {
    status.totalCostMicros = statusUpdates.totalCostMicros;
  }
  if (statusUpdates.totalInputTokens > 0n) {
    status.totalInputTokens = statusUpdates.totalInputTokens;
  }
  if (statusUpdates.totalOutputTokens > 0n) {
    status.totalOutputTokens = statusUpdates.totalOutputTokens;
  }

  // UNCONDITIONAL statusAudit bump — the activity's semantic, distinct
  // from the RPC merge's phase-transition-only rule (module header).
  const audit = status.audit ?? create(ApiResourceAuditSchema);
  status.audit = audit;
  const statusAudit = audit.statusAudit ?? create(ApiResourceAuditInfoSchema);
  audit.statusAudit = statusAudit;
  statusAudit.updatedAt = timestampNow();
  statusAudit.event = "updated";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
