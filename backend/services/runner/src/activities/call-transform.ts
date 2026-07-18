/**
 * Transform action — evaluates a JQ expression against input data.
 *
 * Called by `call: transform` tasks in the CNCF workflow DSL. The Go
 * converter emits:
 *   call: transform
 *   with:
 *     engine: TRANSFORM_ENGINE_JQ
 *     expression: '{full_name: (.first_name + " " + .last_name)}'
 *     input: "${ $context.triage }"  (optional, already resolved)
 *
 * Currently only JQ is supported. JSONATA and TEMPLATE engines will
 * throw a non-retryable error until implemented.
 */

import { ApplicationFailure } from "@temporalio/activity";
import {
  evaluateExpression,
  isStrictExpr,
  sanitizeExpr,
} from "../workflow-engine/expression.js";

export interface TransformConfig {
  readonly engine: string;
  readonly expression: string;
  readonly input?: unknown;
}

function normalizeEngine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^TRANSFORM_ENGINE_/, "");
}

export async function transformAction(
  config: TransformConfig,
  taskInput?: unknown,
): Promise<unknown> {
  if (!config.expression) {
    throw ApplicationFailure.nonRetryable(
      "transform: 'expression' is required",
      "TRANSFORM_MISSING_EXPRESSION",
    );
  }
  if (typeof config.expression !== "string") {
    throw ApplicationFailure.nonRetryable(
      `transform: 'expression' must be a jq string, got ${typeof config.expression}. ` +
        "Fix the expression in the workflow's transform task_config.",
      "TRANSFORM_INVALID_EXPRESSION",
    );
  }

  const engine = normalizeEngine(config.engine || "JQ");

  if (engine !== "JQ") {
    throw ApplicationFailure.nonRetryable(
      `transform: engine '${config.engine}' is not yet supported. Only JQ is currently implemented.`,
      "TRANSFORM_UNSUPPORTED_ENGINE",
    );
  }

  const data = config.input !== undefined ? config.input : taskInput;

  // The expression arrives unresolved (deferred code — see the
  // call-function builder). Accept both the strict `${ ... }` wrapper
  // and the bare jq form the converter emits.
  const expression = isStrictExpr(config.expression)
    ? sanitizeExpr(config.expression)
    : config.expression;

  return evaluateExpression(expression, data, {});
}
