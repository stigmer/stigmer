/**
 * Subscribe — ports controller/subscribe.go: the real-time
 * workflow-execution stream (the broker's read path), streaming full
 * WorkflowExecution snapshots. The generator shape follows the sibling
 * agentexecution subscribe (itself derived from transport/health.ts
 * watch); every delivery rule ports verbatim:
 *
 *   - REGISTER-BEFORE-SNAPSHOT (the gap fix): the broker registration
 *     happens before the snapshot read. Store writes serialize under the
 *     per-resource write lock and UpdateStatus/lifecycle broadcast only
 *     after their persist commits, so any commit the snapshot missed
 *     broadcasts after our registration — nothing lands in the old lossy
 *     window (Go keeps registration and the loop in ONE step for the same
 *     reason; here the generator's finally owns the unsubscribe).
 *   - The overlap frame (a commit the snapshot DID observe) arrives
 *     value-equal to the snapshot; the consecutive-duplicate guard drops
 *     it (Go sameFrame/proto.Equal) so clients never re-render an
 *     identical state.
 *   - The stream ends on a terminal BROADCAST frame; a terminal SNAPSHOT
 *     leaves the stream open (Go sends the snapshot and parks in the
 *     loop). Faithful port.
 *   - The terminal set is COMPLETED/FAILED/CANCELLED — it OMITS
 *     TERMINATED, so a stream over a terminated execution never
 *     self-closes. Known Go quirk (isWorkflowTerminalPhase,
 *     subscribe.go:216), ported byte-faithfully, as agentexecution's
 *     subscribe does.
 */
import { equals } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import type { SubscribeWorkflowRunRequest } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { WorkflowRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import type { StreamBroker } from "./stream-broker.js";

export interface SubscribeDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly broker: StreamBroker;
  /** The composed authorization seam — the pre-stream check below. */
  readonly authorizer: Authorizer;
}

/**
 * Go isWorkflowTerminalPhase (subscribe.go): the stream-closing set.
 * Deliberately narrower than "the execution can never run again" —
 * TERMINATED and PAUSED are absent (TERMINATED being the disclosed
 * quirk).
 */
export function isWorkflowTerminalPhase(phase: RunPhase): boolean {
  return (
    phase === RunPhase.RUN_COMPLETED ||
    phase === RunPhase.RUN_FAILED ||
    phase === RunPhase.RUN_CANCELLED
  );
}

export async function* subscribeExecution(
  deps: SubscribeDeps,
  request: SubscribeWorkflowRunRequest,
  context: HandlerContext,
): AsyncGenerator<WorkflowRun> {
  // Go ValidateSubscribeInputStep.
  if (request.runId === "") {
    throw invalidArgumentError("run_id is required");
  }
  // The annotation's can_view check, once at subscription start — the
  // stream cannot run inside the pipeline executor, so the Authorize
  // evaluation runs here directly (the Java subscribe handlers' validate →
  // authorize order).
  await authorizeDirect(
    WorkflowRunQueryController.method.subscribe,
    deps.authorizer,
    callerIdentityOf(context),
    request,
  );
  const id = request.runId;
  deps.logger.info("Starting workflow execution subscription", {
    executionId: id,
  });

  // Register FIRST so no broadcast can slip through the window before the
  // snapshot read (the happens-before argument in the module header).
  const subscription = deps.broker.subscribe(id);
  try {
    let snapshot: WorkflowRun;
    try {
      snapshot = await deps.store.getResource(
        ApiResourceKind.workflow_run,
        id,
        WorkflowRunSchema,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw notFoundError("WorkflowRun", id);
      }
      throw internalError(error, "failed to load workflow execution");
    }

    yield snapshot;
    deps.logger.debug(
      "Sent initial workflow execution state, streaming live updates",
      { executionId: id },
    );

    // The consecutive-duplicate anchor (Go lastSent).
    let lastSent = snapshot;

    const abort = new Promise<void>((resolve) => {
      context.signal.addEventListener("abort", () => resolve(), {
        once: true,
      });
    });

    while (!context.signal.aborted) {
      if (subscription.closed) {
        // Go's closed-channel arm: end quietly.
        deps.logger.warn("Updates channel closed unexpectedly", {
          executionId: id,
        });
        return;
      }
      if (subscription.queue.length === 0) {
        await Promise.race([
          abort,
          new Promise<void>((resolve) => (subscription.notify = resolve)),
        ]);
        subscription.notify = undefined;
        continue;
      }

      const updated = subscription.queue.shift();
      if (updated === undefined) {
        continue;
      }
      // Suppress the at-or-before-snapshot overlap frame (and any other
      // exact repeat) so the client never re-renders an identical state.
      if (equals(WorkflowRunSchema, updated, lastSent)) {
        continue;
      }

      yield updated;
      lastSent = updated;

      const phase =
        updated.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
      if (isWorkflowTerminalPhase(phase)) {
        deps.logger.info(
          "Workflow execution reached terminal state, ending subscription",
          { executionId: id, phase: RunPhase[phase] },
        );
        return;
      }
    }
    deps.logger.info("Workflow execution subscription cancelled by client", {
      executionId: id,
    });
  } finally {
    deps.broker.unsubscribe(id, subscription);
  }
}
