/**
 * ExecutionConfig.max_tool_rounds → LangGraph recursion_limit resolution.
 *
 * Implements the proto contract (agentexecution/v1/spec.proto):
 *   - 0 / unset = unlimited — no recursionLimit is placed on the invoke
 *     config, preserving the run-until-done + loop-detection posture.
 *   - When set, valid range is 10–1000 rounds; out-of-range values are
 *     clamped to the nearest bound with a warning log.
 *   - recursion_limit = rounds × 6: each model-tool round consumes multiple
 *     graph super-steps because every active middleware hook is its own
 *     node; ×6 is the contract's floor estimate.
 *
 * The SAME resolved limit must feed both LangGraph's hard stop (the invoke
 * config) and the ExecutionBudgetMiddleware's wrap-up advisory, so the
 * "~80% of budget" warning and the enforcement point can never disagree.
 *
 * The knob and its terminal copy live together (the `cost-guard.ts` shape):
 * when the budget is exhausted the adapter ends its turn `tool_call_limit`
 * and the runtime's `toolCallLimitArm` writes TERMINATED with the copy
 * below — the platform deliberately stopped the run, work is checkpointed,
 * and the conversation continues on the next message.
 */

export const SUPER_STEPS_PER_ROUND = 6;
export const MIN_TOOL_ROUNDS = 10;
export const MAX_TOOL_ROUNDS = 1000;

/**
 * The advisory-only budget used when max_tool_rounds is unset: high enough
 * to never fire on a healthy run. Deliberately NOT enforced as a hard
 * recursionLimit — unset means unlimited per the proto contract.
 */
export const UNBOUNDED_ADVISORY_RECURSION_LIMIT = 6000;

/**
 * The recursionLimit for the invoke config, or null when the execution is
 * unbounded (max_tool_rounds 0/unset — the pre-existing default posture).
 */
export function resolveRecursionLimit(maxToolRounds: number | undefined): number | null {
  if (!maxToolRounds || maxToolRounds <= 0) {
    return null;
  }
  return clampToolRounds(maxToolRounds) * SUPER_STEPS_PER_ROUND;
}

function clampToolRounds(requested: number): number {
  if (requested < MIN_TOOL_ROUNDS) {
    console.warn(
      `[tool-rounds] max_tool_rounds=${requested} below the valid range ` +
      `(${MIN_TOOL_ROUNDS}-${MAX_TOOL_ROUNDS}); clamping to ${MIN_TOOL_ROUNDS}`,
    );
    return MIN_TOOL_ROUNDS;
  }
  if (requested > MAX_TOOL_ROUNDS) {
    console.warn(
      `[tool-rounds] max_tool_rounds=${requested} above the valid range ` +
      `(${MIN_TOOL_ROUNDS}-${MAX_TOOL_ROUNDS}); clamping to ${MAX_TOOL_ROUNDS}`,
    );
    return MAX_TOOL_ROUNDS;
  }
  return requested;
}

/**
 * Stable prefix of the tool-call-limit terminal error. This is a cross-repo
 * contract: consumers that need to distinguish "ran out of tool-call budget"
 * from other TERMINATED causes (Stigmer Cloud's channel reply extractor,
 * which shows channel users a friendly limit message instead of generic
 * error copy) match on this prefix with `startsWith`, because
 * AgentExecutionStatus carries no structured termination reason. Do not
 * reword without updating them. `COST_LIMIT_ERROR_PREFIX` (`cost-guard.ts`)
 * mirrors it.
 */
export const TOOL_CALL_LIMIT_ERROR_PREFIX = "Agent reached the tool-call limit";

/** The terminal `status.error` for a tool-call-limit stop; the prefix is the contract, the rest is prose. */
export function formatToolCallLimitError(): string {
  return `${TOOL_CALL_LIMIT_ERROR_PREFIX} for this message. Send another message to continue.`;
}

/**
 * User-facing system message for a tool-call-limit stop. Honest about the
 * limit, clear that nothing is lost; the cost-cap copy is its parallel.
 */
export const TOOL_CALL_LIMIT_USER_COPY =
  "The agent reached the tool-call limit for this message. " +
  "Work completed so far has been saved. " +
  "Send another message to continue where the agent left off.";
