/**
 * Pins subscribeEvents' terminal drain: when the poll finds the run
 * terminal, the stream reads one more page of events and yields what landed
 * since the last poll before it closes, so a client never misses the run's
 * final events. A malformed record in that page is skipped rather than
 * ending the stream, and the request's event-type filter applies to the
 * drain as it does to the poll.
 *
 * The store is a scripted double: the run is terminal from the first
 * re-read, the poll page is empty and the drain page carries the events, so
 * every yielded event can only have come from the drain.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { HandlerContext } from "@connectrpc/connect";
import { createContextValues } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  WorkflowEventType,
  WorkflowRunEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";
import type { WorkflowRunEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";
import { SubscribeEventsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import type {
  Store,
  WorkflowExecutionEventRecord,
} from "../../../store/interface.js";

import { subscribeEvents } from "../subscribe-events.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const RUN_ID = "wex_drain";

function handlerContext(): HandlerContext {
  const values = createContextValues();
  values.set(callerIdentityKey, testCallerIdentity());
  return { signal: new AbortController().signal, values } as HandlerContext;
}

function record(
  sequenceNumber: number,
  eventType: WorkflowEventType,
  data?: Uint8Array,
): WorkflowExecutionEventRecord {
  return {
    executionId: RUN_ID,
    sequenceNumber,
    eventType: WorkflowEventType[eventType],
    taskName: "",
    data:
      data ??
      toBinary(
        WorkflowRunEventSchema,
        create(WorkflowRunEventSchema, {
          eventId: `ev-${sequenceNumber}`,
          eventType,
          sequenceNumber: BigInt(sequenceNumber),
        }),
      ),
    createdAt: "2026-10-06T00:00:00Z",
  };
}

/** A terminal run whose poll page is empty and whose drain page is `drain`. */
function terminalRunStore(drain: WorkflowExecutionEventRecord[]): Store {
  const pages = [[], drain];
  return {
    getResource: () =>
      Promise.resolve(
        create(WorkflowRunSchema, {
          metadata: { id: RUN_ID },
          status: { phase: RunPhase.RUN_COMPLETED },
        }),
      ),
    getWorkflowExecutionEvents: () => Promise.resolve(pages.shift() ?? []),
  } as unknown as Store;
}

async function drained(
  store: Store,
  eventTypes: WorkflowEventType[] = [],
): Promise<WorkflowRunEvent[]> {
  const events: WorkflowRunEvent[] = [];
  for await (const event of subscribeEvents(
    {
      store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
    },
    create(SubscribeEventsRequestSchema, { runId: RUN_ID, eventTypes }),
    handlerContext(),
  )) {
    events.push(event);
  }
  return events;
}

describe("subscribeEvents — the terminal drain", () => {
  it("yields the events that landed before the run ended, skips a malformed one, and closes", async () => {
    const events = await drained(
      terminalRunStore([
        record(1, WorkflowEventType.run_started),
        record(2, WorkflowEventType.run_started, new Uint8Array([0xff, 0xff])),
        record(3, WorkflowEventType.run_completed),
      ]),
    );

    expect(events.map((e) => e.eventId)).toEqual(["ev-1", "ev-3"]);
  });

  it("applies the request's event-type filter to the drain", async () => {
    const events = await drained(
      terminalRunStore([
        record(1, WorkflowEventType.run_started),
        record(2, WorkflowEventType.run_completed),
      ]),
      [WorkflowEventType.run_completed],
    );

    expect(events.map((e) => e.eventId)).toEqual(["ev-2"]);
  });
});
