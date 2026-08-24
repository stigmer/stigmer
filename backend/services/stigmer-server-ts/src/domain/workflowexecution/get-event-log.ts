/**
 * GetEventLog — ports get_event_log.go: cursor-paginated reads over the
 * workflow_execution_events side table (sequence_number ascending,
 * strictly after the cursor). The asymmetry the Class A suite pins: an
 * empty execution_id refuses InvalidArgument, but an UNKNOWN id answers
 * an empty page — there is deliberately no existence check (the opposite
 * of the subscribe lanes).
 *
 * The store filters by at most one event type; multi-type requests fetch
 * unfiltered and filter in memory — which can under-fill a page (Go
 * accepts this: has_more is computed from the pre-filter fetch).
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import { WorkflowExecutionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { GetEventLogResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type {
  GetEventLogRequest,
  GetEventLogResponse,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError, invalidArgumentError } from "../../pipeline/errors.js";
import type { Store, WorkflowExecutionEventRecord } from "../../store/interface.js";

import { DEFAULT_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE } from "./constants.js";

export interface EventLogDeps {
  readonly store: Store;
  readonly logger: Logger;
}

/** The proto enum's value NAME — exactly Go's WorkflowEventType.String(). */
export function eventTypeName(eventType: WorkflowEventType): string {
  return WorkflowEventType[eventType] ?? "";
}

export async function getEventLog(
  deps: EventLogDeps,
  req: GetEventLogRequest,
): Promise<GetEventLogResponse> {
  if (req.executionId === "") {
    throw invalidArgumentError("execution_id is required");
  }

  let pageSize = req.pageSize;
  if (pageSize <= 0) {
    pageSize = DEFAULT_EVENT_PAGE_SIZE;
  }
  if (pageSize > MAX_EVENT_PAGE_SIZE) {
    pageSize = MAX_EVENT_PAGE_SIZE;
  }

  // The store filters by one event type; multiple requested types fall
  // back to in-memory filtering after an unfiltered fetch.
  let eventTypeFilter = "";
  if (req.eventTypes.length === 1) {
    eventTypeFilter = eventTypeName(req.eventTypes[0]);
  }

  // Fetch one extra record to compute has_more.
  let records: WorkflowExecutionEventRecord[];
  try {
    records = await deps.store.getWorkflowExecutionEvents(
      req.executionId,
      Number(req.afterSequence),
      eventTypeFilter,
      req.taskName,
      pageSize + 1,
    );
  } catch (error) {
    deps.logger.error("Failed to query execution events", {
      executionId: req.executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to query execution events");
  }

  const hasMore = records.length > pageSize;
  if (hasMore) {
    records = records.slice(0, pageSize);
  }

  let typeFilter: Set<string> | undefined;
  if (req.eventTypes.length > 1) {
    typeFilter = new Set(req.eventTypes.map(eventTypeName));
  }

  const events: WorkflowExecutionEvent[] = [];
  let latestSequence = 0n;

  for (const record of records) {
    if (typeFilter !== undefined && !typeFilter.has(record.eventType)) {
      continue;
    }

    let event: WorkflowExecutionEvent;
    try {
      event = fromBinary(WorkflowExecutionEventSchema, record.data);
    } catch {
      deps.logger.warn("Skipping malformed event record", {
        executionId: req.executionId,
        sequenceNumber: record.sequenceNumber,
      });
      continue;
    }

    events.push(event);
    if (BigInt(record.sequenceNumber) > latestSequence) {
      latestSequence = BigInt(record.sequenceNumber);
    }
  }

  return create(GetEventLogResponseSchema, {
    events,
    hasMore,
    latestSequence,
  });
}
