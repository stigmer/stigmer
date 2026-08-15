/**
 * Human input orchestrator — Temporal workflow-layer HITL signal handler.
 *
 * Registers a signal handler for the human_input task, then blocks until
 * either the signal arrives or the timeout fires. Timeout behavior is
 * determined by the `onTimeout` policy:
 * - "fail": throws an error
 * - "approve": returns auto-approved output
 * - "deny": returns auto-denied output
 * - "escalate": returns the "escalate" outcome — by the outcome-by-name
 *   contract (stigmer/stigmer#781) the loader guarantees the gate declares
 *   an outcome with that exact name and a `then` branch, so the executor's
 *   ordinary outcome routing takes the escalation path.
 *
 * Signal payload shape:
 * { outcome, form_data?, reviewer, reviewer_actor?, responded_at }
 *
 * TEMPORAL SANDBOX: This file runs inside the deterministic workflow isolate.
 */

import { defineSignal, setHandler, condition } from "@temporalio/workflow";

import type {
  HumanInputExecutionConfig,
  HumanInputResult,
  HumanInputTimeoutPolicy,
} from "../workflow-engine/types.js";

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
  policy: HumanInputTimeoutPolicy,
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

    case "escalate":
      // The outcome word IS the declared outcome's name (loader-enforced),
      // so no positional remapping happens downstream — the executor's name
      // lookup routes the escalation branch directly.
      return {
        outcome: "escalate",
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
