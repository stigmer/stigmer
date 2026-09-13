/**
 * Middleware stack factory for the native harness's root graph.
 *
 * Assembles the ordered middleware array from a MiddlewareStackConfig. The
 * order is load-bearing and reads top to bottom:
 *
 *   0. Path normalization (conditional: only on permission-rule-bearing
 *      graphs — FIRST, so every downstream middleware observes canonical
 *      workspace-absolute paths)
 *   1. Loop detection (always)
 *   2. Execution budget (always — advises at ~80% of the tool-round budget
 *      that LangGraph's `recursionLimit` enforces)
 *   3. Tool intent (always — bind-time shell schema extension, issue #276)
 *   4. Tool truncation (always)
 *   5. Approval gate (conditional: absent under the global bypass)
 *   6. Cost advisory (conditional: only when maxCostUsd > 0 — advises at
 *      ~80% of the cap that the turn runtime enforces)
 *   7. Error hints (always)
 *   8. OTel spans (always, no-op when OTel not configured)
 *
 * Every middleware here either shapes the graph's tool surface or ADVISES
 * the model; none of them stops the run. A stop — the platform's, the
 * cost cap's, a stall's — is the turn runtime's, delivered to the graph
 * through its abort signal (harness runtime program, S3 Q-S3-3; until M2b a
 * graceful-stop middleware and the cost cap's tool block were second stops
 * inside the graph that the runtime could not see).
 *
 * The sub-agent stack is `execute-deep-agent/subagent-wiring.ts`'s: the same
 * order over the parent's shared instances where one exists (the advisory's
 * running total), fresh ones otherwise.
 */

import type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";
import { createPathNormalizationMiddleware } from "./path-normalization.js";
import { createLoopDetectionMiddleware } from "./loop-detection.js";
import { createExecutionBudgetMiddleware } from "./execution-budget.js";
import { createToolIntentMiddleware } from "./tool-intent.js";
import { createToolTruncationMiddleware } from "./tool-truncation.js";
import { createApprovalGateMiddleware } from "./approval-gate.js";
import { createCostAdvisoryMiddleware, type CostAdvisoryMiddleware } from "./cost-advisory.js";
import { createErrorHintsMiddleware } from "./error-hints.js";
import { createOtelSpansMiddleware } from "./otel-spans.js";

export type { CostAdvisoryMiddleware } from "./cost-advisory.js";
export type { StigmerMiddleware, MiddlewareStackConfig } from "./types.js";

export interface MiddlewareStackResult {
  readonly middleware: StigmerMiddleware[];
  /** The advisory's instance, for the sub-agent stacks to share its running total; null when no cap is configured. */
  readonly costAdvisory: CostAdvisoryMiddleware | null;
}

export function buildMiddlewareStack(
  config: MiddlewareStackConfig = {},
): MiddlewareStackResult {
  const stack: StigmerMiddleware[] = [];

  if (config.pathNormalization) {
    stack.push(createPathNormalizationMiddleware(config.pathNormalization));
  }

  stack.push(createLoopDetectionMiddleware(config.loopDetection));
  stack.push(createExecutionBudgetMiddleware(config.executionBudget));
  stack.push(createToolIntentMiddleware());
  stack.push(createToolTruncationMiddleware(config.toolTruncation));

  if (config.approvalGate) {
    stack.push(createApprovalGateMiddleware(config.approvalGate));
  }

  const costAdvisory =
    config.costAdvisory && config.costAdvisory.maxCostUsd > 0
      ? createCostAdvisoryMiddleware(config.costAdvisory)
      : null;
  if (costAdvisory) stack.push(costAdvisory);

  stack.push(createErrorHintsMiddleware());
  stack.push(createOtelSpansMiddleware(config.otelSpans));

  return { middleware: stack, costAdvisory };
}
