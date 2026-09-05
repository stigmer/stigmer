/**
 * Server-side activity implementations for the agent-execution worker —
 * ports pkg/domain/agentexecution/temporal/activities (update_status_impl,
 * load_execution, read_harness_state_id, complete_external_activity) and
 * registers #15's DeleteExecutionContext seam.
 *
 * Payload boundary (sub-project 20260824.03 design rule): statuses and
 * executions cross as proto-JSON — the TS default payload converter
 * cannot serialize the bigint int64 fields of typed messages. These
 * payloads are SERVER-INTERNAL (this worker's workflow is the only
 * caller; histories never cross editions per OD-6), so only the activity
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
 * Authorize step honors (O2 ruling Q4) and whose chain runs the runner's
 * exact updateStatus handler: the domain's single atomic merge
 * chokepoint plus the composed status hooks and the StreamBroker
 * broadcast, so the activity and the runner's gRPC path can never
 * diverge on merge semantics (Go's activity impl shared the merge helpers
 * for the same reason). The activity therefore builds NO identity of its
 * own. Its predecessor called the domain function directly with the
 * chassis's trusted-local WIRE identity (`user`-class), which an
 * enforcing Authorizer has no grant for — every runner failure on the
 * cloud composition left a hung, never-FAILED execution
 * (stigmer-cloud#610, stigmer#979).
 *
 * The reads (LoadAgentExecution, ReadHarnessStateId) and the
 * ExecutionContext delete stay store-direct: pure reads with Java
 * `findById` parity and #15's idempotent seam — no chain to bypass.
 *
 * CompleteExternalActivity receives a live client PROVIDER instead of
 * Go's package-global (re-set on every reconnect); the input carries the
 * error as a serializable message string — sub-project DD-001 (Option A,
 * owner-ratified): Go's `Error error` field cannot survive its own JSON
 * round-trip, so its error-completion lane never delivers (oss#861). The
 * TS lane works; the divergence is disclosed.
 */
import { Buffer } from "node:buffer";
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import type { Client } from "@temporalio/client";

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  AgentExecutionUpdateStatusInput,
  UpdateStatusResponse,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
  deleteExecutionContextForExecution,
} from "../../domain/executioncontext/temporal/delete-execution-context.js";
import type { Store } from "../../store/interface.js";
import {
  COMPLETE_EXTERNAL_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "./names.js";

/**
 * The worker's own-behalf status edge — the agentexecution UpdateStatus
 * RPC reached over the in-process transport (the `InProcessClients`
 * surface in boot/inprocess.ts satisfies it). Method-segregated like the
 * other in-process edges (Go's narrow client interfaces): the worker
 * needs exactly this one RPC.
 */
export interface ExecutionStatusWriter {
  updateStatus(
    input: AgentExecutionUpdateStatusInput,
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
  /** Live Temporal client (reads the manager's CURRENT client). */
  readonly client: () => Client;
}

/** The input for stigmer/system/complete-external-activity (DD-001 shape). */
export interface CompleteExternalActivityInput {
  /** Base64-encoded Temporal task token from the external activity. */
  readonly callbackToken: string;
  /** The success result (ignored when errorMessage is set). */
  readonly result?: unknown;
  /** Failure message; takes precedence over result (Go's contract). */
  readonly errorMessage?: string;
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
      const status = fromJson(AgentExecutionStatusSchema, statusJson);
      await deps.statusWriter().updateStatus(
        create(AgentExecutionUpdateStatusInputSchema, {
          executionId,
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
          ApiResourceKind.agent_execution,
          executionId,
          AgentExecutionSchema,
        );
      } catch (error) {
        // Go load_execution.go wraps with this exact text — keeps the
        // inner diagnostic chain byte-comparable across editions.
        throw new Error(
          `load agent execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      return toJson(AgentExecutionSchema, execution);
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

    /** #15's seam, registered as a local activity (shared with #21). */
    [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: async (
      executionId: string,
    ): Promise<void> => {
      await deleteExecutionContextForExecution(store, logger, executionId);
    },

    /**
     * Completes an external Temporal activity via its task token (the
     * async activity completion pattern — token handshake ADR). Empty
     * token is a warn-and-skip (backward compatibility, Go parity).
     */
    [COMPLETE_EXTERNAL_ACTIVITY_NAME]: async (
      input: CompleteExternalActivityInput,
    ): Promise<void> => {
      if (input.callbackToken === "") {
        logger.warn(
          "CompleteExternalActivity called with empty token - skipping (backward compatibility)",
        );
        return;
      }

      const taskToken = Buffer.from(input.callbackToken, "base64");
      logger.info("Completing external activity", {
        token_preview:
          input.callbackToken.length > 20
            ? `${input.callbackToken.slice(0, 20)}...`
            : input.callbackToken,
        token_length: taskToken.length,
        has_result: input.result !== undefined,
        has_error: input.errorMessage !== undefined,
      });

      const client = deps.client();
      if (input.errorMessage !== undefined) {
        logger.info("Reporting failure to external activity", {
          error: input.errorMessage,
        });
        await client.activity.fail(taskToken, new Error(input.errorMessage));
      } else {
        logger.info("Reporting success to external activity");
        await client.activity.complete(taskToken, input.result ?? null);
      }
      logger.info("Successfully completed external activity");
    },
  };
}
