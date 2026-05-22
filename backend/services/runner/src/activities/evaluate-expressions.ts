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

import { evaluateExpressionBatch } from "../workflow-engine/expression.js";

export function createEvaluateExpressionsActivities() {
  return {
    EvaluateExpressions: async (
      expressions: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      return evaluateExpressionBatch(expressions, input, stateVars);
    },
  };
}
