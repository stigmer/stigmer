/**
 * Listen task orchestrator — Temporal workflow-layer implementation.
 *
 * Registers signal handlers for each event in the listen configuration,
 * then blocks until the consumption strategy is satisfied (all signals
 * received for "all" mode, or first signal received for "any" mode).
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow
 * isolate. Only @temporalio/workflow APIs are allowed.
 */

import { defineSignal, setHandler, condition } from "@temporalio/workflow";

import type { ListenExecutionConfig, ListenEventDef } from "../workflow-engine/types.js";

/**
 * Orchestrates a listen task within the Temporal workflow sandbox.
 * Called by the workflow function's `ctx.listen` callback wiring.
 *
 * Returns the signal payload for single-event listeners, or a map
 * of { eventId: payload } for multi-event listeners.
 */
export async function orchestrateListenTask(
  config: ListenExecutionConfig,
): Promise<unknown> {
  const { events, mode, timeoutMs } = config;

  if (events.length === 1) {
    return waitForSingleSignal(events[0], timeoutMs);
  }

  if (mode === "any") {
    return waitForAnySignal(events, timeoutMs);
  }

  return waitForAllSignals(events, timeoutMs);
}

async function waitForSingleSignal(
  event: ListenEventDef,
  timeoutMs: number,
): Promise<unknown> {
  let payload: unknown = undefined;
  let received = false;

  const signal = defineSignal<[unknown]>(event.id);
  setHandler(signal, (data: unknown) => {
    payload = data;
    received = true;
  });

  const completed = await condition(() => received, timeoutMs);
  if (!completed) {
    throw new Error(
      `Listen task timed out waiting for signal '${event.id}' after ${timeoutMs}ms`,
    );
  }

  return payload;
}

async function waitForAnySignal(
  events: ListenEventDef[],
  timeoutMs: number,
): Promise<unknown> {
  let winningPayload: unknown = undefined;
  let winningEventId: string | undefined = undefined;
  let anyReceived = false;

  for (const event of events) {
    const signal = defineSignal<[unknown]>(event.id);
    setHandler(signal, (data: unknown) => {
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
      `Listen task timed out waiting for any signal from [${ids}] after ${timeoutMs}ms`,
    );
  }

  return { __event_id__: winningEventId, payload: winningPayload };
}

async function waitForAllSignals(
  events: ListenEventDef[],
  timeoutMs: number,
): Promise<unknown> {
  const received: Record<string, unknown> = {};
  const completionFlags = new Map<string, boolean>();

  for (const event of events) {
    completionFlags.set(event.id, false);

    const signal = defineSignal<[unknown]>(event.id);
    setHandler(signal, (data: unknown) => {
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
      `Listen task timed out waiting for signals [${pending}] after ${timeoutMs}ms`,
    );
  }

  return received;
}
