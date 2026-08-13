/**
 * Sub-agent middleware composition for ExecuteDeepAgent.
 *
 * Each sub-agent gets its own middleware stack with:
 * - Path normalization (issue #429), FIRST and only on permission-rule-
 *   bearing graphs (plan mode) — workspace-relative paths are rewritten to
 *   workspace-absolute before deepagents' permission validation refuses
 *   them, exactly as on the parent. `compileSubagents` derives it from the
 *   same `permissions` option it bakes into the graph, keeping the rules
 *   and their normalization shim coupled.
 * - Fresh loop detection (independent cycle tracking)
 * - Tool intent (issue #276) — the shell tool's bind-time schema gains the
 *   optional model-authored `description`, so sub-agent shell rows carry
 *   intent titles exactly like the parent's
 * - Fresh tool truncation (same limits as parent)
 * - Periodic execution budget (interval=30, max=4 advisories)
 * - Approval gate (so a mutating tool *inside* a sub-agent is gated, not
 *   bypassed) — installed only when the parent itself is gated
 *   (`approvalGate` present; absent under auto-approve-all)
 * - Shared cost cap view (parent's budget, no reset on sub-agent start)
 * - Error hints (issue #255): a thrown tool error becomes a recoverable
 *   ToolMessage exactly as on the parent. Without it, any tool throw — a
 *   plan-mode permission denial, an MCP hiccup — propagated out of the
 *   sub-agent graph and killed the whole delegated task, losing all its
 *   accumulated work, where the parent's identical error is one failed
 *   tool round the model adapts to.
 *
 * The sub-agent middleware stack does NOT include:
 * - Graceful stop (parent handles STOP signal propagation)
 * - OTel spans (parent's OTel context propagates automatically)
 *
 * Approval-gate note: the gate is what *creates* the LangGraph `interrupt()`.
 * A sub-agent's interrupt does surface at the parent checkpoint and resumes
 * correctly (verified in subagent-approval-propagation.test.ts), but only if
 * the gate runs inside the sub-agent in the first place — omitting it here was
 * the live HITL bypass this wiring closes.
 */

import type {
  StigmerMiddleware,
  ToolTruncationConfig,
  PathNormalizationConfig,
} from "../../middleware/types.js";
import type { CostCapMiddleware } from "../../middleware/index.js";
import { createPathNormalizationMiddleware } from "../../middleware/path-normalization.js";
import { createLoopDetectionMiddleware } from "../../middleware/loop-detection.js";
import { createToolTruncationMiddleware } from "../../middleware/tool-truncation.js";
import { createExecutionBudgetMiddleware } from "../../middleware/execution-budget.js";
import { createToolIntentMiddleware } from "../../middleware/tool-intent.js";
import {
  createApprovalGateMiddleware,
  type ApprovalGateConfig,
} from "../../middleware/approval-gate.js";
import { createErrorHintsMiddleware } from "../../middleware/error-hints.js";

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
  /**
   * Route the sub-agent's gitignored writes into CAS capture (apply-then-review)
   * instead of the interrupt gate. TRUE iff a CAS observer backs the sub-agent's
   * filesystem backend (DD-19) — `compileSubagents` derives it from
   * `!!casObserver`, keeping the gate and the backend coupled. Default false =
   * the classic gitignored deny-gate, because flowing a gitignored edit on an
   * unobserved backend would apply unreviewable bytes.
   */
  readonly captureIgnored?: boolean;
  /**
   * Workspace-relative path normalization (issue #429). Present iff this
   * sub-agent's graph carries filesystem permission rules — the caller
   * derives it from the same `permissions` value it bakes into the graph.
   */
  readonly pathNormalization?: PathNormalizationConfig;
}

/**
 * Build the middleware stack for a single sub-agent.
 *
 * Returns an ordered array mirroring the parent composition:
 * [path normalization] → loop detection → execution budget (periodic) →
 * tool intent → tool truncation → [approval gate] → cost cap view →
 * error hints.
 * Normalization is outermost so everything downstream observes canonical
 * workspace-absolute paths (matching the parent). The gate sits before the
 * cost-cap view so an approval pause happens before budget accounting, and
 * error hints come after the gate — both matching the parent order
 * (…→ truncation → graceful-stop → approval gate → cost cap → error hints …),
 * which keeps the gate's HITL interrupt outside the hints' try/catch.
 */
export function buildSubAgentMiddleware(
  options: SubAgentMiddlewareOptions = {},
): StigmerMiddleware[] {
  const stack: StigmerMiddleware[] = [];

  if (options.pathNormalization) {
    stack.push(createPathNormalizationMiddleware(options.pathNormalization));
  }

  stack.push(createLoopDetectionMiddleware({ enabled: true }));

  stack.push(createExecutionBudgetMiddleware({
    warningInterval: SUB_AGENT_ADVISORY_INTERVAL,
    maxWarnings: SUB_AGENT_MAX_ADVISORIES,
  }));

  // Sub-agent shell rows render in the same thread as the parent's and must
  // carry the same model-authored intent titles (issue #276).
  stack.push(createToolIntentMiddleware());

  stack.push(createToolTruncationMiddleware(options.toolTruncation));

  if (options.approvalGate) {
    // captureIgnored (DD-19): a sub-agent flows gitignored writes — and, since
    // issue #303, non-secret CAS-owned deletes — into CAS iff a CAS observer
    // backs its filesystem backend (compileSubagents passes this as
    // `!!casObserver`). When true, inherit the parent gate verbatim so its
    // captureIgnored + recordBlockedSecret + captureDeleteBefore feed the SAME
    // shared observer that backs the sub-agent's writes. When false (default;
    // non-capture mode, or no observer), force CAS routing off and drop both
    // observer sinks so gitignored paths stay on the interrupt gate — a flowed
    // gitignored edit on an unobserved backend would apply unobserved,
    // unreviewable bytes. Sub-agent git-tracked edits are always captured by
    // the backend-agnostic boundary diff.
    stack.push(createApprovalGateMiddleware(
      options.captureIgnored
        ? options.approvalGate
        : {
            ...options.approvalGate,
            captureIgnored: false,
            recordBlockedSecret: undefined,
            captureDeleteBefore: undefined,
          },
    ));
  }

  if (options.costCap) {
    stack.push(options.costCap.forSubAgent());
  }

  stack.push(createErrorHintsMiddleware());

  return stack;
}
