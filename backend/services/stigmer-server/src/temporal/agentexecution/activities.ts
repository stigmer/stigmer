/**
 * Server-side activity implementations for the agent-execution worker —
 * ports pkg/domain/agentexecution/temporal/activities (update_status_impl,
 * load_execution, read_harness_state_id) and
 * registers DeleteExecutionContext, the server's own delete of the run's
 * context through the context's delete chain
 * (domain/executioncontext/internal-delete.ts, stigmer#1647).
 *
 * Payload boundary: statuses and
 * executions cross as proto-JSON — the TS default payload converter
 * cannot serialize the bigint int64 fields of typed messages. These
 * payloads are SERVER-INTERNAL (this worker's workflow is the only
 * caller; histories never cross editions), so only the activity
 * NAMES are byte-pinned.
 *
 * UpdateExecutionStatus is the worker acting on the server's own behalf:
 * the invoke workflow's fallback writes (FAILED when a runner fails
 * without persisting, the IN_PROGRESS re-assertions on recovery and
 * resume, the CANCELLED fallback, the defense-in-depth PAUSED and
 * WAITING_FOR_APPROVAL persists). Like every other server-internal call
 * — the schedule clock's fires, the reconciler's deletes, the HITL
 * forwarders — it rides the in-process transport (boot/inprocess.ts),
 * whose position-1 interceptor mints the `internal` caller class the
 * Authorize step honors and whose chain runs the runner's
 * exact updateStatus handler: the domain's single atomic merge
 * chokepoint plus the composed status hooks and the StreamBroker
 * broadcast, so the activity and the runner's gRPC path can never
 * diverge on merge semantics (Go's activity impl shared the merge helpers
 * for the same reason). The activity therefore builds NO identity of its
 * own. Its predecessor called the domain function directly with the
 * chassis's trusted-local WIRE identity (`user`-class), which an
 * enforcing Authorizer has no grant for — every runner failure on the
 * cloud composition left a hung, never-FAILED execution (stigmer#979).
 *
 * The reads (LoadAgentExecution, ReadHarnessStateId) stay store-direct:
 * pure reads with Java `findById` parity — no chain to bypass. The
 * ExecutionContext delete is not a read: it rides the context's own delete
 * chain over the in-process transport (domain/executioncontext/
 * internal-delete.ts), because a bare store delete skipped the chain's
 * cleanup event and left the search row (stigmer#1647).
 */
import { create, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  RunUpdateStatusInput,
  UpdateStatusResponse,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { deleteExecutionContextForExecution } from "../../domain/executioncontext/internal-delete.js";
import type { ExecutionContextDeleter } from "../../domain/executioncontext/internal-delete.js";
import { DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME } from "../../domain/executioncontext/temporal/delete-execution-context.js";
import type { Store } from "../../store/interface.js";
import {
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "./names.js";
import { decodeRunStatusJson } from "./execution-json.js";

/**
 * The worker's own-behalf status edge — the agentexecution UpdateStatus
 * RPC reached over the in-process transport (the `InProcessClients`
 * surface in boot/inprocess.ts satisfies it). Method-segregated like the
 * other in-process edges (Go's narrow client interfaces): the worker
 * needs exactly this one RPC.
 */
export interface ExecutionStatusWriter {
  updateStatus(
    input: RunUpdateStatusInput,
  ): Promise<UpdateStatusResponse>;
}

export interface AgentExecutionActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The in-process status edge, read per call: the worker factories are
   * built before the in-process wiring exists and run after it (the
   * composition root's requireInProcess idiom — a true cycle, resolved
   * lazily like the RunStarter's create edge).
   */
  readonly statusWriter: () => ExecutionStatusWriter;
  /**
   * The server's own delete of a run's ExecutionContext, read per call (the
   * same boot cycle as the status edge): the context's delete chain over
   * the in-process transport, so its cleanup and search-row delete run on
   * the run-end delete too (stigmer#1647).
   */
  readonly executionContextDeleter: () => ExecutionContextDeleter;
}

/**
 * Builds the activity record the worker registers. Keys are the
 * byte-pinned activity names; runner-owned activities (EnsureThread,
 * ExecuteDeepAgent, ExecuteCursor, GenerateSessionSubject) are
 * deliberately NOT here — registering them would break queue-based
 * routing (worker_config.go's CRITICAL rules).
 */
export function createAgentExecutionActivities(
  deps: AgentExecutionActivityDeps,
): Record<string, (...args: never[]) => Promise<unknown>> {
  const { store, logger } = deps;

  return {
    /**
     * The atomic status merge, invoked as a regular activity (failure/
     * cancellation paths) AND a local activity (persistFinalStatus) —
     * one implementation serves both modes, exactly Go's single named
     * registration. The activity owns only the payload boundary (proto-
     * JSON in, a typed UpdateStatus input out); identity, authorization,
     * merge, hooks, and broadcast are the in-process lane's (module
     * header). A ConnectError from the lane — NotFound for a deleted
     * execution — IS the activity's failure, exactly what the direct
     * domain call answered before.
     */
    [UPDATE_EXECUTION_STATUS_ACTIVITY_NAME]: async (
      executionId: string,
      statusJson: JsonValue,
    ): Promise<void> => {
      const status = decodeRunStatusJson(RunStatusSchema, statusJson);
      await deps.statusWriter().updateStatus(
        create(RunUpdateStatusInputSchema, {
          runId: executionId,
          status,
        }),
      );
    },

    /**
     * Pure read of the current execution (the workflow's input snapshot
     * is stale by completion time — historically the workflow held a
     * stale copy; loading from the DB reflects every runner update).
     */
    [LOAD_AGENT_EXECUTION_ACTIVITY_NAME]: async (
      executionId: string,
    ): Promise<JsonValue> => {
      let execution;
      try {
        execution = await store.getResource(
          ApiResourceKind.run,
          executionId,
          RunSchema,
        );
      } catch (error) {
        // Go load_execution.go wraps with this exact text — keeps the
        // inner diagnostic chain byte-comparable across editions.
        throw new Error(
          `load agent execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return toJson(RunSchema, execution);
    },

    /**
     * Reads the session's harness_state_id (the Cursor agentId stored by
     * ExecuteCursor on first run; Agent.resume needs it on HITL
     * re-invocations). Empty sessionId answers "" without error.
     */
    [READ_HARNESS_STATE_ID_ACTIVITY_NAME]: async (
      sessionId: string,
    ): Promise<string> => {
      if (sessionId === "") {
        return "";
      }
      let session;
      try {
        session = await store.getResource(
          ApiResourceKind.session,
          sessionId,
          SessionSchema,
        );
      } catch (error) {
        logger.error("Failed to load session for harness_state_id", {
          session_id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `load session ${sessionId} for harness_state_id: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return session.spec?.harnessStateId ?? "";
    },

    /** The server's own delete of the run's context, a local activity. */
    [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: async (
      executionId: string,
    ): Promise<void> => {
      await deleteExecutionContextForExecution(
        { store, deleter: deps.executionContextDeleter, logger },
        executionId,
        "run-end",
      );
    },
  };
}
