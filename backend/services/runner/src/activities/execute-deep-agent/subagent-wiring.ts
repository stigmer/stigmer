/**
 * Sub-agent middleware composition for ExecuteDeepAgent.
 *
 * Each sub-agent gets its own middleware stack with:
 * - Fresh loop detection (independent cycle tracking)
 * - Fresh tool truncation (same limits as parent)
 * - Periodic execution budget (interval=30, max=4 advisories)
 * - Shared cost cap view (parent's budget, no reset on sub-agent start)
 *
 * The sub-agent middleware stack does NOT include:
 * - Graceful stop (parent handles STOP signal propagation)
 * - OTel spans (parent's OTel context propagates automatically)
 * - Error hints (applied at tool level, not sub-agent level)
 * - Approval gate (sub-agent interrupts propagate to parent checkpoint)
 */

import type { StigmerMiddleware, ToolTruncationConfig } from "../../middleware/types.js";
import type { CostCapMiddleware } from "../../middleware/index.js";
import { createLoopDetectionMiddleware } from "../../middleware/loop-detection.js";
import { createToolTruncationMiddleware } from "../../middleware/tool-truncation.js";
import { createExecutionBudgetMiddleware } from "../../middleware/execution-budget.js";

const SUB_AGENT_ADVISORY_INTERVAL = 30;
const SUB_AGENT_MAX_ADVISORIES = 4;

export interface SubAgentMiddlewareOptions {
  readonly costCap?: CostCapMiddleware;
  readonly toolTruncation?: Partial<ToolTruncationConfig>;
}

/**
 * Build the middleware stack for a single sub-agent.
 *
 * Returns an ordered array matching the Python `compile_subagent` composition:
 * loop detection → execution budget (periodic) → tool truncation → cost cap view.
 */
export function buildSubAgentMiddleware(
  options: SubAgentMiddlewareOptions = {},
): StigmerMiddleware[] {
  const stack: StigmerMiddleware[] = [];

  stack.push(createLoopDetectionMiddleware({ enabled: true }));

  stack.push(createExecutionBudgetMiddleware({
    warningInterval: SUB_AGENT_ADVISORY_INTERVAL,
    maxWarnings: SUB_AGENT_MAX_ADVISORIES,
  }));

  stack.push(createToolTruncationMiddleware(options.toolTruncation));

  if (options.costCap) {
    stack.push(options.costCap.forSubAgent());
  }

  return stack;
}
