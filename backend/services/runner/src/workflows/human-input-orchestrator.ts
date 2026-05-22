/**
 * Human input orchestrator — Temporal workflow-layer HITL signal handler.
 *
 * Registers a signal handler for the human_input task, then blocks until
 * either the signal arrives or the timeout fires. Timeout behavior is
 * determined by the `onTimeout` policy:
 * - "fail": throws an error
 * - "approve": returns auto-approved output
 * - "deny": returns auto-denied output
 *
 * Signal payload shape: { outcome, form_data?, reviewer, responded_at }
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow isolate.
 */

import { defineSignal, setHandler, condition } from "@temporalio/workflow";

import type { HumanInputExecutionConfig, HumanInputResult } from "../workflow-engine/types.js";

/**
 * Orchestrates a human_input task — blocks until signal or timeout.
 */
export async function orchestrateHumanInput(
  config: HumanInputExecutionConfig,
): Promise<HumanInputResult> {
  const { signalName, timeoutSeconds, onTimeout } = config;

  let payload: HumanInputResult | undefined;
  let received = false;

  const signal = defineSignal<[HumanInputResult]>(signalName);
  setHandler(signal, (data: HumanInputResult) => {
    payload = data;
    received = true;
  });

  if (timeoutSeconds > 0) {
    const timeoutMs = timeoutSeconds * 1000;
    const completed = await condition(() => received, timeoutMs);

    if (!completed) {
      return handleTimeout(signalName, onTimeout);
    }
  } else {
    await condition(() => received);
  }

  return payload!;
}

function handleTimeout(
  signalName: string,
  policy: "fail" | "approve" | "deny",
): HumanInputResult {
  switch (policy) {
    case "approve":
      return {
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      };

    case "deny":
      return {
        outcome: "deny",
        auto_resolved: true,
        reason: "timeout",
      };

    case "fail":
    default:
      throw new Error(
        `human_input task timed out waiting for signal '${signalName}'`,
      );
  }
}
