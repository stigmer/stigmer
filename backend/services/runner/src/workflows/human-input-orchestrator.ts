/**
 * Human input orchestrator — Temporal workflow-layer HITL signal handler.
 *
 * Registers a signal handler for the human_input task, then blocks until
 * either the signal arrives or the timeout fires, and reports which one
 * happened: the reviewer's payload, or a timeout. It applies no timeout
 * policy. What a timeout means (fail the task, or resolve the gate to a
 * declared outcome) is decided in the kernel (`workflow-engine/tasks/
 * human-input.ts`), which also logs how the approval ended, so the two
 * cannot drift apart across layers.
 *
 * Signal payload shape:
 * { outcome, form_data?, comment?, reviewer, reviewer_actor?, responded_at }
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow isolate.
 */

import { defineSignal, setHandler, condition } from "@temporalio/workflow";

import type {
  HumanInputExecutionConfig,
  HumanInputResponse,
  HumanInputResult,
  HumanInputTimeout,
} from "../workflow-engine/types.js";

const TIMED_OUT: HumanInputTimeout = { timedOut: true };

/**
 * Orchestrates a human_input task — blocks until signal or timeout.
 */
export async function orchestrateHumanInput(
  config: HumanInputExecutionConfig,
): Promise<HumanInputResponse> {
  const { signalName, timeoutSeconds } = config;

  let payload: HumanInputResult | undefined;
  let received = false;

  const signal = defineSignal<[HumanInputResult]>(signalName);
  setHandler(signal, (data: HumanInputResult) => {
    payload = data;
    received = true;
  });

  if (timeoutSeconds > 0) {
    const completed = await condition(() => received, timeoutSeconds * 1000);
    if (!completed) return TIMED_OUT;
  } else {
    await condition(() => received);
  }

  return payload!;
}
