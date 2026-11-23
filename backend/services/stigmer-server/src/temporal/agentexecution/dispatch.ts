/**
 * Activity-queue dispatch resolution.
 *
 * Decides which runner serves an execution (domain/run/placement.ts, the
 * one rule) and so which Temporal task queue its runner activities route
 * to: the runner queue for a `shared` turn, the session's own queue
 * otherwise. It also resolves the session's harness (STIGMER vs CLAUDE —
 * which activity type the workflow invokes) and execution target (LOCAL vs
 * CLOUD — the workflow asks for a sandbox on CLOUD unless the turn is
 * shared). The one log line names the placement, so an operator can see
 * where each turn went.
 *
 * Proven by the agentexecution suites on local-execution and by the
 * co-located dispatch tests.
 */
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  Computer,
  ExecutionTarget,
  Harness,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import { placeTurn, type TurnPlacement } from "../../domain/run/placement.js";
import { AgentExecutionTemporalConfig } from "../../domain/run/temporal/config.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";

/** The per-session task queue's prefix. */
const SESSION_TASK_QUEUE_PREFIX = "session:";

/** Where an execution's runner activities go, and what they run. */
export interface DispatchResult {
  readonly taskQueue: string;
  readonly harness: Harness;
  readonly executionTarget: ExecutionTarget;
  /** Which runner serves the turn (domain/run/placement.ts). */
  readonly placement: TurnPlacement;
}

/**
 * Derives the canonical per-session task queue name:
 * "session:{session_id}". Pure — usable by
 * tests and any component validating queue names.
 */
export function formatSessionTaskQueue(sessionId: string): string {
  return SESSION_TASK_QUEUE_PREFIX + sessionId;
}

/**
 * Resolves the activity task queue, harness, and execution target for one
 * execution. Error message text is pinned: the create step surfaces it
 * verbatim as FailedPrecondition.
 */
export async function resolveActivityTaskQueue(
  store: Store,
  sessionId: string,
  config: AgentExecutionTemporalConfig,
  logger: Logger,
  /** Whether this server starts sandboxes (sandbox/lane.ts `enabled`); it changes only the placement's name, never the queue. */
  sandboxLane = false,
): Promise<DispatchResult> {
  let harness = Harness.STIGMER;
  let executionTarget = ExecutionTarget.UNSPECIFIED;
  let computer: Computer | undefined;

  if (sessionId !== "") {
    try {
      const session = await store.getResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
      );
      // A LOADED session with no spec resolves UNSPECIFIED; STIGMER is
      // only the pre-load default.
      harness = session.spec?.harness ?? Harness.UNSPECIFIED;
      executionTarget = session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED;
      computer = session.status?.computer;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundError)) {
        // Pinned text (create maps it to FailedPrecondition verbatim).
        throw new Error(
          `failed to load session for dispatch: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      logger.warn("Session not found during dispatch, using defaults", {
        session_id: sessionId,
      });
    }
  }

  const resolvedTarget = config.resolveExecutionTarget(executionTarget);
  const placement = placeTurn({ config, target: executionTarget, computer, sandboxLane, sessionId });
  const taskQueue = placement === "shared" ? config.runnerQueue : formatSessionTaskQueue(sessionId);

  logger.info("Dispatch resolved activity task queue", {
    session_id: sessionId,
    task_queue: taskQueue,
    routing_mode: config.activityRouting,
    execution_target: ExecutionTarget[resolvedTarget],
    placement,
  });

  return { taskQueue, harness, executionTarget: resolvedTarget, placement };
}
