/**
 * Listen task orchestrator — Temporal workflow-layer implementation.
 *
 * Registers handlers for each event in the listen configuration based on
 * its transport type (signal, query, update), then blocks until the
 * consumption strategy is satisfied.
 *
 * Transport type semantics:
 * - signal: blocking; receives data via signal channel, counts toward completion
 * - query:  non-blocking; registers a read-only handler that returns data
 *           on demand. Does NOT count toward completion — the listen task
 *           returns immediately after registering query handlers (unless
 *           mixed with blocking event types).
 * - update: blocking; registers a bidirectional handler with validator.
 *           Counts toward completion like signals. Returns reply data to caller.
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow
 * isolate. Only @temporalio/workflow APIs are allowed.
 */

import {
  defineSignal,
  defineQuery,
  defineUpdate,
  setHandler,
  condition,
} from "@temporalio/workflow";

import type { ListenExecutionConfig, ListenEventDef } from "../workflow-engine/types.js";

/**
 * Orchestrates a listen task within the Temporal workflow sandbox.
 * Called by the workflow function's `ctx.listen` callback wiring.
 *
 * Returns the received payload(s). For single-event listeners, returns
 * the raw payload. For multi-event listeners, returns a map of
 * { eventId: payload }.
 */
export async function orchestrateListenTask(
  config: ListenExecutionConfig,
): Promise<unknown> {
  const { events, mode, timeoutMs } = config;

  const blockingEvents = events.filter(e => e.type !== "query");
  const queryEvents = events.filter(e => e.type === "query");

  for (const event of queryEvents) {
    registerQueryHandler(event);
  }

  if (blockingEvents.length === 0) {
    return undefined;
  }

  if (blockingEvents.length === 1 && queryEvents.length === 0) {
    return waitForSingleBlockingEvent(blockingEvents[0], timeoutMs);
  }

  if (mode === "any") {
    return waitForAnyBlockingEvent(blockingEvents, timeoutMs);
  }

  return waitForAllBlockingEvents(blockingEvents, timeoutMs);
}

function registerQueryHandler(event: ListenEventDef): void {
  const query = defineQuery<unknown>(event.id);
  setHandler(query, () => {
    if (event.data !== undefined) {
      return event.data;
    }
    return undefined;
  });
}

function registerSignalHandler(
  event: ListenEventDef,
  onReceive: (data: unknown) => void,
): void {
  const signal = defineSignal<[unknown]>(event.id);
  setHandler(signal, (data: unknown) => {
    onReceive(data);
  });
}

function registerUpdateHandler(
  event: ListenEventDef,
  onReceive: (data: unknown) => void,
): void {
  const replyData = event.data;
  // Temporal TS SDK's setHandler overloads have strict generic inference that
  // rejects [unknown] args. The runtime is correct — cast through any to bypass
  // the compile-time mismatch (same pattern used for OTel interceptor SDK gap).
  const update = defineUpdate(event.id) as any;
  setHandler(update, (data: unknown): unknown => {
    onReceive(data);
    return replyData !== undefined ? replyData : undefined;
  }, {
    validator: (_data: unknown): void => {},
  });
}

function registerBlockingHandler(
  event: ListenEventDef,
  onReceive: (data: unknown) => void,
): void {
  if (event.type === "signal") {
    registerSignalHandler(event, onReceive);
  } else if (event.type === "update") {
    registerUpdateHandler(event, onReceive);
  }
}

async function waitForSingleBlockingEvent(
  event: ListenEventDef,
  timeoutMs: number,
): Promise<unknown> {
  let payload: unknown = undefined;
  let received = false;

  registerBlockingHandler(event, (data) => {
    payload = data;
    received = true;
  });

  const completed = await condition(() => received, timeoutMs);
  if (!completed) {
    throw new Error(
      `Listen task timed out waiting for ${event.type} '${event.id}' after ${timeoutMs}ms`,
    );
  }

  return payload;
}

async function waitForAnyBlockingEvent(
  events: ListenEventDef[],
  timeoutMs: number,
): Promise<unknown> {
  let winningPayload: unknown = undefined;
  let winningEventId: string | undefined = undefined;
  let anyReceived = false;

  for (const event of events) {
    registerBlockingHandler(event, (data) => {
      if (!anyReceived) {
        winningPayload = data;
        winningEventId = event.id;
        anyReceived = true;
      }
    });
  }

  const completed = await condition(() => anyReceived, timeoutMs);
  if (!completed) {
    const ids = events.map(e => e.id).join(", ");
    throw new Error(
      `Listen task timed out waiting for any event from [${ids}] after ${timeoutMs}ms`,
    );
  }

  return { __event_id__: winningEventId, payload: winningPayload };
}

async function waitForAllBlockingEvents(
  events: ListenEventDef[],
  timeoutMs: number,
): Promise<unknown> {
  const received: Record<string, unknown> = {};
  const completionFlags = new Map<string, boolean>();

  for (const event of events) {
    completionFlags.set(event.id, false);

    registerBlockingHandler(event, (data) => {
      received[event.id] = data;
      completionFlags.set(event.id, true);
    });
  }

  const allComplete = () => {
    for (const flag of completionFlags.values()) {
      if (!flag) return false;
    }
    return true;
  };

  const completed = await condition(allComplete, timeoutMs);
  if (!completed) {
    const pending = events
      .filter(e => !completionFlags.get(e.id))
      .map(e => e.id)
      .join(", ");
    throw new Error(
      `Listen task timed out waiting for events [${pending}] after ${timeoutMs}ms`,
    );
  }

  return received;
}
