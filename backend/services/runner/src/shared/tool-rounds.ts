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
