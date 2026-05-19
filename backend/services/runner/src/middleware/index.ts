/**
 * Middleware stack factory.
 *
 * Assembles the ordered middleware array from a MiddlewareStackConfig.
 * The composition order matches the Python create_deep_agent injection:
 *
 *   1. Loop detection (always)
 *   2. Execution budget (always)
 *   3. Tool truncation (always)
 *   4. Graceful stop (always, inert until activated)
 *   5. Cost cap (conditional: only when maxCostUsd > 0)
 *   6. Error hints (always)
 *   7. OTel spans (always, no-op when OTel not configured)
 */

import type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";
import type { GracefulStopMiddleware } from "./graceful-stop.js";
import { createLoopDetectionMiddleware } from "./loop-detection.js";
import { createExecutionBudgetMiddleware } from "./execution-budget.js";
import { createToolTruncationMiddleware } from "./tool-truncation.js";
import { createGracefulStopMiddleware } from "./graceful-stop.js";
import { createApprovalGateMiddleware } from "./approval-gate.js";
import { createCostCapMiddleware } from "./cost-cap.js";
import { createErrorHintsMiddleware } from "./error-hints.js";
import { createOtelSpansMiddleware } from "./otel-spans.js";

export { createThinkTool } from "./think-tool.js";
export type { GracefulStopMiddleware } from "./graceful-stop.js";
export type { CostCapMiddleware } from "./cost-cap.js";
export type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";

export interface MiddlewareStackResult {
  readonly middleware: StigmerMiddleware[];
  readonly gracefulStop: GracefulStopMiddleware;
}

export function buildMiddlewareStack(
  config: MiddlewareStackConfig = {},
): MiddlewareStackResult {
  const stack: StigmerMiddleware[] = [];

  stack.push(createLoopDetectionMiddleware(config.loopDetection));

  stack.push(createExecutionBudgetMiddleware(config.executionBudget));

  stack.push(createToolTruncationMiddleware(config.toolTruncation));

  const gracefulStop = createGracefulStopMiddleware();
  stack.push(gracefulStop);

  if (config.approvalGate) {
    stack.push(createApprovalGateMiddleware(config.approvalGate));
  }

  if (config.costCap && config.costCap.maxCostUsd > 0) {
    stack.push(createCostCapMiddleware(config.costCap));
  }

  stack.push(createErrorHintsMiddleware());

  stack.push(createOtelSpansMiddleware(config.otelSpans));

  return { middleware: stack, gracefulStop };
}
