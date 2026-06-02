/**
 * EvaluateExpressions Temporal local activity — evaluates batched jq
 * expressions using jq-wasm.
 *
 * Runs OUTSIDE the Temporal workflow sandbox (local activity on the
 * worker) because jq-wasm's Emscripten loader requires Node.js
 * built-ins (fs, path, crypto) that are blocked in the deterministic
 * V8 isolate.
 *
 * Local activity results are recorded in workflow history, providing
 * deterministic replay for all expression evaluation — including
 * non-deterministic operations like uuid generation.
 *
 * Activity contract:
 *   Name:   "EvaluateExpressions"
 *   Input:  (expressions: Record<string, string>, input: unknown, stateVars: Record<string, unknown>)
 *   Output: Record<string, unknown>
 */

import { ApplicationFailure } from "@temporalio/activity";

import { evaluateExpressionBatch } from "../workflow-engine/expression.js";

export function createEvaluateExpressionsActivities() {
  return {
    EvaluateExpressions: async (
      expressions: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      try {
        return await evaluateExpressionBatch(expressions, input, stateVars);
      } catch (err) {
        // jq expression evaluation is deterministic and side-effect free:
        // a failure (parse/compile/syntax/runtime error) is a property of the
        // expression + input and will never succeed on retry. Surface it as a
        // non-retryable failure so the workflow reaches a terminal FAILED phase
        // instead of being retried forever by the local-activity retry policy.
        const message = err instanceof Error ? err.message : String(err);
        throw ApplicationFailure.nonRetryable(
          `Expression evaluation failed: ${message}`,
          "EXPRESSION_EVALUATION_FAILED",
        );
      }
    },
  };
}
