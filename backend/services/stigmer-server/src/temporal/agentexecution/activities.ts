/**
 * Server-side activity implementations for the agent-execution worker —
 * ports pkg/domain/agentexecution/temporal/activities (update_status_impl,
 * load_execution, read_harness_state_id), closes the previous turn's file
 * review (CloseFileReview), and
 * registers the retired DeleteExecutionContext name with a body that does
 * nothing, for the runs whose history still calls it (names.ts).
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
 * pure reads with Java `findById` parity — no chain to bypass.
 *
 * CloseFileReview is the server's own policy write, as the auto-keeps
 * inside the status merge are: once this turn's message is in the log,
 * the previous turn's still-undecided edits are kept
 * (domain/run/filereview/autokeep.ts keepOutdatedSets), in one run write
 * that commits the ledger decisions with their `decided` events
 * (domain/session/events/run-writes.ts). The previous turn is the run of
 * the `user.message` before this run's own: one read for this run's
 * message, one for the message before it. A run whose message is not in
 * the log (no session, or a reconcile turn, whose workflow never calls
 * it), a first turn and a previous turn since deleted close nothing, and
 * a previous turn with nothing undecided is not written. Idempotent, so a retry or a replay that runs
 * it again records nothing new.
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
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { keepOutdatedSets } from "../../domain/run/filereview/autokeep.js";
import { projectFileChangeSets } from "../../domain/run/filereview/project.js";
import type { SessionEventBroker } from "../../domain/session/events/broker.js";
import { updateRunAppendingEvents } from "../../domain/session/events/run-writes.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import {
  CLOSE_FILE_REVIEW_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME,
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
  /** The fan-out of each session's event log: CloseFileReview's write appends `decided` events. */
  readonly sessionEventBroker: SessionEventBroker;
}

/** The event that opens a message turn: the user message its run was created with. */
const TURN_MESSAGE_TYPE = "user.message";

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
      return session.status?.harnessStateId ?? "";
    },

    /**
     * Keeps the previous turn's still-undecided edits (module header).
     * The session is the run's own, from the workflow input.
     */
    [CLOSE_FILE_REVIEW_ACTIVITY_NAME]: async (
      executionId: string,
      sessionId: string,
    ): Promise<void> => {
      const previousRunId = await previousTurnRunId(store, sessionId, executionId);
      if (previousRunId === undefined) {
        return;
      }
      let kept = 0;
      try {
        const previous = await store.getResource(ApiResourceKind.run, previousRunId, RunSchema);
        if (!hasUndecidedSet(previous)) {
          return;
        }
        await updateRunAppendingEvents(deps, previousRunId, (run) => {
          if (run.status !== undefined) {
            kept = keepOutdatedSets(run.status, previousRunId);
            run.status.fileChangeSets = projectFileChangeSets(run.status.fileReviewEventStream);
          }
        });
      } catch (error) {
        // A previous turn deleted since its message was read has nothing
        // left to close.
        if (error instanceof ResourceNotFoundError) {
          return;
        }
        throw error;
      }
      logger.info("Closed the previous turn's file review: its undecided edits are kept", {
        executionId,
        previousExecutionId: previousRunId,
        decisions: kept,
      });
    },

    /** The retired run-end cleanup: nothing is stored to delete (names.ts). */
    [RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: async (): Promise<void> => {},
  };
}

/**
 * The run of the session's `user.message` before `executionId`'s own;
 * undefined when the run's message is not in the log or it is the first.
 */
async function previousTurnRunId(
  store: Store,
  sessionId: string,
  executionId: string,
): Promise<string | undefined> {
  if (sessionId === "") {
    return undefined;
  }
  const [own] = await store.sessionEvents.list(sessionId, {
    order: "desc",
    types: [TURN_MESSAGE_TYPE],
    runId: executionId,
    limit: 1,
  });
  if (own === undefined) {
    return undefined;
  }
  const [before] = await store.sessionEvents.list(sessionId, {
    order: "desc",
    types: [TURN_MESSAGE_TYPE],
    afterSeq: own.seq,
    limit: 1,
  });
  return before === undefined || before.runId === "" ? undefined : before.runId;
}

/** Whether a run holds a change set still awaiting a decision. */
function hasUndecidedSet(run: Run): boolean {
  return projectFileChangeSets(run.status?.fileReviewEventStream).some(
    (cs) => cs.status === FileChangeSetStatus.AWAITING_REVIEW,
  );
}
