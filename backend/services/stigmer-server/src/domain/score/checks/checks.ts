/**
 * The run-health checks: free, deterministic verdicts over a completed
 * run, asking no model. Each is a pure function over the run's actions
 * (actions.ts) and answers passed, failed or not applicable, with a reason
 * built from counts, tool names and step numbers only: a reason never
 * quotes what anyone typed.
 *
 * The score's value is passed exactly when every applicable check passed.
 * `RUN_HEALTH_EVALUATOR_VERSION` is the SHA-256 of the check identifiers
 * and thresholds, so a change to either makes scores from the two versions
 * distinguishable; __tests__/checks.test.ts pins its value, so the change
 * is deliberate.
 */
import { createHash } from "node:crypto";

import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import type { RunAction, RunActions } from "./actions.js";

/** How many equal calls in a row count as stuck. */
export const REPEATED_CALLS_THRESHOLD = 3;

export const NO_REPEATED_CALLS = "no-repeated-calls";
export const LAST_ACTION_SUCCEEDED = "last-action-succeeded";
export const STRUCTURED_OUTPUT_DELIVERED = "structured-output-delivered";

/** One check's verdict. */
export interface CheckVerdict {
  readonly name: string;
  readonly result: CriterionResult;
  readonly reason: string;
}

type Check = (view: RunActions) => CheckVerdict;

const passed = (name: string): CheckVerdict => ({
  name,
  result: CriterionResult.passed,
  reason: "",
});

const notApplicable = (name: string, reason: string): CheckVerdict => ({
  name,
  result: CriterionResult.not_applicable,
  reason,
});

const failed = (name: string, reason: string): CheckVerdict => ({
  name,
  result: CriterionResult.failed,
  reason,
});

/**
 * Three or more consecutive calls with the same tool, the same inputs and
 * the same result: the agent was stuck. A call whose inputs are unknown
 * never counts, and a poll that sees its result change never counts.
 */
export const noRepeatedCalls: Check = ({ actions }) => {
  if (actions.length === 0) {
    return notApplicable(NO_REPEATED_CALLS, "the run made no tool calls");
  }
  let streak = 1;
  for (let i = 1; i < actions.length; i++) {
    const current = actions[i] as RunAction;
    const previous = actions[i - 1] as RunAction;
    streak =
      current.argsKey !== "" && sameCall(current, previous) ? streak + 1 : 1;
    if (streak >= REPEATED_CALLS_THRESHOLD) {
      const first = current.step - streak + 1;
      return failed(
        NO_REPEATED_CALLS,
        `${current.name} was called ${REPEATED_CALLS_THRESHOLD} times in a row with the same inputs and the same result (steps ${first} to ${current.step})`,
      );
    }
  }
  return passed(NO_REPEATED_CALLS);
};

function sameCall(a: RunAction, b: RunAction): boolean {
  return (
    a.name === b.name && a.argsKey === b.argsKey && a.resultKey === b.resultKey
  );
}

/** The run completed, so its last action should not have failed. */
export const lastActionSucceeded: Check = ({ actions }) => {
  const last = actions[actions.length - 1];
  if (last === undefined) {
    return notApplicable(LAST_ACTION_SUCCEEDED, "the run made no tool calls");
  }
  if (
    last.status === ToolCallStatus.TOOL_CALL_FAILED ||
    last.status === ToolCallStatus.TOOL_CALL_INTERRUPTED
  ) {
    return failed(
      LAST_ACTION_SUCCEEDED,
      `ended on a failed action: ${last.name} (step ${last.step})`,
    );
  }
  return passed(LAST_ACTION_SUCCEEDED);
};

/** A run asked for an answer in a fixed shape gave one. */
export const structuredOutputDelivered: Check = ({
  schemaSet,
  outputPresent,
}) => {
  if (!schemaSet) {
    return notApplicable(
      STRUCTURED_OUTPUT_DELIVERED,
      "the run was not asked for an answer in a fixed shape",
    );
  }
  return outputPresent
    ? passed(STRUCTURED_OUTPUT_DELIVERED)
    : failed(
        STRUCTURED_OUTPUT_DELIVERED,
        "the run was asked for an answer in a fixed shape and gave none",
      );
};

/** The checks, in the order their verdicts are reported. */
const CHECKS: ReadonlyArray<Check> = [
  noRepeatedCalls,
  lastActionSucceeded,
  structuredOutputDelivered,
];

/** Identifies this set of checks and thresholds (module header). */
export const RUN_HEALTH_EVALUATOR_VERSION = createHash("sha256")
  .update(
    JSON.stringify({
      checks: [
        NO_REPEATED_CALLS,
        LAST_ACTION_SUCCEEDED,
        STRUCTURED_OUTPUT_DELIVERED,
      ],
      repeatedCallsThreshold: REPEATED_CALLS_THRESHOLD,
    }),
  )
  .digest("hex");

/** A run's run-health grade. */
export interface RunHealth {
  /** True when every applicable check passed. */
  readonly passed: boolean;
  readonly verdicts: ReadonlyArray<CheckVerdict>;
}

export function gradeRunHealth(view: RunActions): RunHealth {
  const verdicts = CHECKS.map((check) => check(view));
  return {
    passed: verdicts.every(
      (verdict) => verdict.result !== CriterionResult.failed,
    ),
    verdicts,
  };
}
