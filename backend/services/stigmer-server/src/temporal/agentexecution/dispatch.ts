/**
 * Activity-queue dispatch resolution.
 *
 * Decides which Temporal task queue an execution's runner activities route
 * to, and resolves the session's harness (STIGMER vs CLAUDE — which
 * activity type the workflow invokes) and execution target (LOCAL vs
 * CLOUD — cloud uses it for sandbox provisioning; the OSS workflow
 * ignores it).
 *
 * Proven by the agentexecution suites on local-execution and by the
 * co-located dispatch tests.
 */
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  ROUTING_SESSION,
} from "../../domain/run/temporal/config.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";

/** The per-session task queue's prefix. */
const SESSION_TASK_QUEUE_PREFIX = "session:";

/** Where an execution's runner activities go, and what they run. */
export interface DispatchResult {
  readonly taskQueue: string;
  readonly harness: Harness;
  readonly executionTarget: ExecutionTarget;
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
): Promise<DispatchResult> {
  let harness = Harness.STIGMER;
  let executionTarget = ExecutionTarget.UNSPECIFIED;

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
  const taskQueue = resolveTaskQueue(sessionId, config);

  logger.info("Dispatch resolved activity task queue", {
    session_id: sessionId,
    task_queue: taskQueue,
    routing_mode: config.activityRouting,
    execution_target: ExecutionTarget[resolvedTarget],
  });

  return { taskQueue, harness, executionTarget: resolvedTarget };
}

/** Session routing only with a session id in hand. */
function resolveTaskQueue(
  sessionId: string,
  config: AgentExecutionTemporalConfig,
): string {
  if (config.activityRouting === ROUTING_SESSION && sessionId !== "") {
    return formatSessionTaskQueue(sessionId);
  }
  return config.runnerQueue;
}
