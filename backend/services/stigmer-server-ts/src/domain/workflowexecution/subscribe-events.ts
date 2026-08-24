/**
 * SubscribeEvents — ports controller/subscribe_events.go: the incremental
 * event stream for the execution viewer timeline (replay + live tail).
 * Unlike Subscribe (full snapshots via the broker), this reads the
 * persisted event log directly:
 *
 *   - Replays events with sequence_number > after_sequence, then polls
 *     the store every EVENT_POLL_INTERVAL_MS for new ones — the first
 *     server-side poll loop in this codebase, ported from Go's own
 *     ticker design (all other TS streams are notify-based; the event
 *     WRITER is the store, not the broker, so polling is the mechanism
 *     here in both editions).
 *   - The existence check runs BEFORE streaming: unknown id → NotFound
 *     (the deliberate opposite of getEventLog's no-existence-check
 *     empty-page contract; the Class A suite pins both arms).
 *   - The cursor advances past type-filtered and malformed records too,
 *     so a poisoned row cannot wedge the stream.
 *   - Terminal check every iteration: on COMPLETED/FAILED/CANCELLED the
 *     remaining events after the cursor are drained (one page, same
 *     filter, malformed skipped) and the stream closes. TERMINATED is
 *     absent from that set — the disclosed Go quirk shared with
 *     subscribe.ts.
 *   - Client disconnect surfaces as the abort signal; Go's stream.Send
 *     error arm returns nil the same way.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowExecutionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { SubscribeEventsRequest } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type {
  Store,
  WorkflowExecutionEventRecord,
} from "../../store/interface.js";

import {
  DEFAULT_EVENT_PAGE_SIZE,
  EVENT_POLL_INTERVAL_MS,
} from "./constants.js";
import { eventTypeName } from "./get-event-log.js";
import { isWorkflowTerminalPhase } from "./subscribe.js";

export interface SubscribeEventsDeps {
  readonly store: Store;
  readonly logger: Logger;
}

export async function* subscribeEvents(
  deps: SubscribeEventsDeps,
  request: SubscribeEventsRequest,
  context: HandlerContext,
): AsyncGenerator<WorkflowExecutionEvent> {
  if (request.executionId === "") {
    throw invalidArgumentError("execution_id is required");
  }
  const executionId = request.executionId;

  // Verify the execution exists (the opposite of getEventLog's contract).
  try {
    await deps.store.getResource(
      ApiResourceKind.workflow_execution,
      executionId,
      WorkflowExecutionSchema,
    );
  } catch {
    throw notFoundError("WorkflowExecution", executionId);
  }

  let typeFilter: Set<string> | undefined;
  if (request.eventTypes.length > 0) {
    typeFilter = new Set(request.eventTypes.map(eventTypeName));
  }

  let cursor = Number(request.afterSequence);
  deps.logger.info("Starting event subscription", {
    executionId,
    afterSequence: cursor,
  });

  const abort = new Promise<void>((resolve) => {
    context.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  while (!context.signal.aborted) {
    // Poll for new events.
    let records: WorkflowExecutionEventRecord[];
    try {
      records = await deps.store.getWorkflowExecutionEvents(
        executionId,
        cursor,
        "",
        "",
        DEFAULT_EVENT_PAGE_SIZE,
      );
    } catch (error) {
      deps.logger.error("Failed to poll execution events", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "failed to poll execution events");
    }

    for (const record of records) {
      // The cursor advances past filtered and malformed records too, so a
      // poisoned row cannot wedge the stream.
      if (typeFilter !== undefined && !typeFilter.has(record.eventType)) {
        cursor = record.sequenceNumber;
        continue;
      }
      let event: WorkflowExecutionEvent;
      try {
        event = fromBinary(WorkflowExecutionEventSchema, record.data);
      } catch {
        deps.logger.warn("Skipping malformed event record", {
          executionId,
          sequenceNumber: record.sequenceNumber,
        });
        cursor = record.sequenceNumber;
        continue;
      }
      if (context.signal.aborted) {
        // Go's stream.Send error arm: the client is gone, end quietly.
        return;
      }
      yield event;
      cursor = record.sequenceNumber;
    }

    // Terminal check: Go tolerates a failed re-read (skips the check and
    // keeps polling), so load errors here are deliberately swallowed.
    try {
      const execution = await deps.store.getResource(
        ApiResourceKind.workflow_execution,
        executionId,
        WorkflowExecutionSchema,
      );
      const phase =
        execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      if (isWorkflowTerminalPhase(phase)) {
        // Drain any remaining events after terminal state (one page, Go's
        // best-effort drain — its read error is ignored the same way).
        let remaining: WorkflowExecutionEventRecord[] = [];
        try {
          remaining = await deps.store.getWorkflowExecutionEvents(
            executionId,
            cursor,
            "",
            "",
            DEFAULT_EVENT_PAGE_SIZE,
          );
        } catch {
          remaining = [];
        }
        for (const record of remaining) {
          if (typeFilter !== undefined && !typeFilter.has(record.eventType)) {
            continue;
          }
          let event: WorkflowExecutionEvent;
          try {
            event = fromBinary(WorkflowExecutionEventSchema, record.data);
          } catch {
            continue;
          }
          if (context.signal.aborted) {
            return;
          }
          yield event;
        }
        deps.logger.info(
          "Execution reached terminal state, closing event stream",
          { executionId, phase: ExecutionPhase[phase] },
        );
        return;
      }
    } catch {
      // Execution re-read failed — keep polling (Go's `if err == nil`).
    }

    // Wait for the next poll tick or client cancellation.
    await Promise.race([abort, sleep(EVENT_POLL_INTERVAL_MS)]);
  }
  deps.logger.info("Event subscription cancelled by client", { executionId });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A parked poll timer must never hold the process open (Go tickers
    // live in goroutines; Node timers pin the event loop unless unref'd).
    timer.unref();
  });
}
