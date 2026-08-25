/**
 * Activity-queue dispatch resolution — ports
 * pkg/domain/agentexecution/temporal/dispatch.go.
 *
 * Decides which Temporal task queue an execution's runner activities route
 * to, and resolves the session's harness (NATIVE vs CURSOR — which
 * activity type the workflow invokes) and execution target (LOCAL vs
 * CLOUD — cloud uses it for sandbox provisioning; the OSS workflow
 * ignores it).
 *
 * The `wfexec:{id}` override lane: a parent workflow execution passes its
 * OWN queue so child agents share its sandbox. This domain honors the
 * override as an opaque string (the prefix constant belongs to
 * workflowexecution, #21) and forces ExecutionTarget LOCAL to suppress
 * sandbox provisioning — exactly Go's contract.
 *
 * Proven by the agentexecution suites on local-ts-execution and by the
 * co-located dispatch tests (ports dispatch_test.go).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  ROUTING_SESSION,
} from "../../domain/agentexecution/temporal/config.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";

/** Go dispatch.go sessionTaskQueuePrefix. */
const SESSION_TASK_QUEUE_PREFIX = "session:";

/** Go temporal.DispatchResult. */
export interface DispatchResult {
  readonly taskQueue: string;
  readonly harness: Harness;
  readonly executionTarget: ExecutionTarget;
}

/**
 * Derives the canonical per-session task queue name (Go
 * FormatSessionTaskQueue): "session:{session_id}". Pure — usable by
 * tests and any component validating queue names.
 */
export function formatSessionTaskQueue(sessionId: string): string {
  return SESSION_TASK_QUEUE_PREFIX + sessionId;
}

/**
 * Resolves the activity task queue, harness, and execution target for one
 * execution (Go ResolveActivityTaskQueue). Error message text is pinned:
 * the create step surfaces it verbatim as FailedPrecondition (Go create.go
 * startWorkflowStep).
 */
export async function resolveActivityTaskQueue(
  store: Store,
  sessionId: string,
  config: AgentExecutionTemporalConfig,
  activityTaskQueueOverride: string,
  logger: Logger,
): Promise<DispatchResult> {
  // Sandbox affinity: the parent workflow already has a sandbox on this
  // queue — route there directly, no session routing, no provisioning.
  if (activityTaskQueueOverride !== "") {
    let harness = Harness.NATIVE;
    if (sessionId !== "") {
      try {
        const session = await store.getResource(
          ApiResourceKind.session,
          sessionId,
          SessionSchema,
        );
        // A LOADED session with a nil spec resolves UNSPECIFIED (Go's
        // GetSpec().GetHarness() nil-chain); NATIVE is only the pre-load
        // default.
        harness = session.spec?.harness ?? Harness.UNSPECIFIED;
      } catch {
        // Best-effort read (Go ignores the error and keeps NATIVE).
      }
    }

    logger.info("Dispatch using activity_task_queue override (sandbox affinity)", {
      session_id: sessionId,
      task_queue: activityTaskQueueOverride,
      override_source: "parent_workflow_sandbox",
    });

    return {
      taskQueue: activityTaskQueueOverride,
      harness,
      executionTarget: ExecutionTarget.LOCAL,
    };
  }

  let harness = Harness.NATIVE;
  let executionTarget = ExecutionTarget.UNSPECIFIED;

  if (sessionId !== "") {
    try {
      const session = await store.getResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
      );
      // Loaded-session nil-spec resolves UNSPECIFIED, exactly as the
      // override arm above.
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

/** Go resolveTaskQueue: session routing only with a session id in hand. */
function resolveTaskQueue(
  sessionId: string,
  config: AgentExecutionTemporalConfig,
): string {
  if (config.activityRouting === ROUTING_SESSION && sessionId !== "") {
    return formatSessionTaskQueue(sessionId);
  }
  return config.runnerQueue;
}
