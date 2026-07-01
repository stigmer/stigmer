/**
 * Sub-agent middleware composition for ExecuteDeepAgent.
 *
 * Each sub-agent gets its own middleware stack with:
 * - Fresh loop detection (independent cycle tracking)
 * - Fresh tool truncation (same limits as parent)
 * - Periodic execution budget (interval=30, max=4 advisories)
 * - Approval gate (so a mutating tool *inside* a sub-agent is gated, not
 *   bypassed) — installed only when the parent itself is gated
 *   (`approvalGate` present; absent under auto-approve-all)
 * - Shared cost cap view (parent's budget, no reset on sub-agent start)
 *
 * The sub-agent middleware stack does NOT include:
 * - Graceful stop (parent handles STOP signal propagation)
 * - OTel spans (parent's OTel context propagates automatically)
 * - Error hints (applied at tool level, not sub-agent level)
 *
 * Approval-gate note: the gate is what *creates* the LangGraph `interrupt()`.
 * A sub-agent's interrupt does surface at the parent checkpoint and resumes
 * correctly (verified in subagent-approval-propagation.test.ts), but only if
 * the gate runs inside the sub-agent in the first place — omitting it here was
 * the live HITL bypass this wiring closes.
 */

import type { StigmerMiddleware, ToolTruncationConfig } from "../../middleware/types.js";
import type { CostCapMiddleware } from "../../middleware/index.js";
import { createLoopDetectionMiddleware } from "../../middleware/loop-detection.js";
import { createToolTruncationMiddleware } from "../../middleware/tool-truncation.js";
import { createExecutionBudgetMiddleware } from "../../middleware/execution-budget.js";
import {
  createApprovalGateMiddleware,
  type ApprovalGateConfig,
} from "../../middleware/approval-gate.js";

const SUB_AGENT_ADVISORY_INTERVAL = 30;
const SUB_AGENT_MAX_ADVISORIES = 4;

export interface SubAgentMiddlewareOptions {
  readonly costCap?: CostCapMiddleware;
  readonly toolTruncation?: Partial<ToolTruncationConfig>;
  /**
   * Approval gate config inherited from the parent. When present, the sub-agent
   * gates its own mutating tool calls; when null/undefined (e.g. auto-approve-
   * all, where the parent gate is inert too) no gate is installed.
   */
  readonly approvalGate?: ApprovalGateConfig | null;
}

/**
 * Build the middleware stack for a single sub-agent.
 *
 * Returns an ordered array mirroring the parent composition:
 * loop detection → execution budget (periodic) → tool truncation →
 * [approval gate] → cost cap view. The gate sits before the cost-cap view so an
 * approval pause happens before budget accounting, matching the parent order
 * (…→ truncation → graceful-stop → approval gate → cost cap …).
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

  if (options.approvalGate) {
    // Sub-agent gates must NOT flow gitignored edits into CAS: a sub-agent runs on
    // its own filesystem backend, which the CAS observer does not wrap, so a
    // flowed gitignored edit would apply unobserved, unreviewable bytes. Force the
    // CAS routing off here (and drop the parent's blocked-secret sink) so
    // gitignored paths stay on the interrupt gate for sub-agents, exactly as
    // before. Sub-agent git-tracked edits are still captured by the
    // backend-agnostic turn-boundary git diff.
    stack.push(createApprovalGateMiddleware({
      ...options.approvalGate,
      captureIgnored: false,
      recordBlockedSecret: undefined,
    }));
  }

  if (options.costCap) {
    stack.push(options.costCap.forSubAgent());
  }

  return stack;
}
