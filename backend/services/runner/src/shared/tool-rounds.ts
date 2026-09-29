/**
 * ExecutionConfig.max_tool_rounds: the round budget, its backstop, and the
 * signal that the budget ended a turn.
 *
 * Implements the proto contract (agentexecution/v1/spec.proto):
 *   - 0 / unset = unlimited: no round limit and no recursionLimit, preserving
 *     the run-until-done + loop-detection posture.
 *   - When set, valid range is 10–1000 rounds; out-of-range values are
 *     clamped to the nearest bound with a warning log.
 *   - A round is one model response that proposes one or more tool calls,
 *     followed by their execution; parallel calls are one round.
 *
 * The budget is COUNTED, not estimated. `middleware/execution-budget.ts`
 * counts rounds where the model is called and throws
 * {@link ToolRoundLimitError} before round N+1's model call, so N rounds
 * run on every middleware stack. The count and the "~80% of budget"
 * advisory live in that one middleware, so they can never disagree. Until
 * #1113 the budget was LangGraph's recursion limit at rounds × 6 super-steps,
 * and because every middleware hook is its own graph node, how many rounds
 * fitted moved whenever the stack did.
 *
 * LangGraph's recursion limit stays only as a backstop
 * ({@link backstopRecursionLimit}): generous enough never to bind before the
 * round count on any stack, it halts a graph that loops without calling the
 * model. Either stop is the same outcome ({@link isToolCallBudgetStop}).
 *
 * The knob and its terminal copy live together (the `cost-guard.ts` shape):
 * when the budget is exhausted the adapter ends its turn `tool_call_limit`
 * and the runtime's `toolCallLimitArm` writes TERMINATED with the copy
 * below — the platform deliberately stopped the run, work is checkpointed,
 * and the conversation continues on the next message.
 */

import { unwrapModelError } from "./model-error.js";

export const MIN_TOOL_ROUNDS = 10;
export const MAX_TOOL_ROUNDS = 1000;

/**
 * Super-steps per round the backstop allows: well above the graph nodes one
 * round costs on any stack the runner builds (about five today), so the
 * round count, never the backstop, is what a bounded run meets.
 */
export const SUPER_STEPS_BACKSTOP_PER_ROUND = 20;

/**
 * The advisory-only round budget used when max_tool_rounds is unset: high
 * enough to never fire on a healthy run. Deliberately NOT enforced — unset
 * means unlimited per the proto contract.
 */
export const UNBOUNDED_ADVISORY_TOOL_ROUNDS = MAX_TOOL_ROUNDS;

/**
 * The round budget for a turn, clamped to the valid range, or null when the
 * execution is unbounded (max_tool_rounds 0/unset — the default posture).
 */
export function resolveToolRoundLimit(maxToolRounds: number | undefined): number | null {
  if (!maxToolRounds || maxToolRounds <= 0) {
    return null;
  }
  return clampToolRounds(maxToolRounds);
}

/** The recursionLimit backstop for a bounded turn's invoke config; see {@link SUPER_STEPS_BACKSTOP_PER_ROUND}. */
export function backstopRecursionLimit(toolRoundLimit: number): number {
  return toolRoundLimit * SUPER_STEPS_BACKSTOP_PER_ROUND;
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

/**
 * The execution budget's stop: thrown by `middleware/execution-budget.ts` in
 * place of round N+1's model call, so the graph ends on round N's tool
 * results with no proposed call left unexecuted.
 */
export class ToolRoundLimitError extends Error {
  constructor(readonly toolRoundLimit: number) {
    super(`Tool-round limit reached: ${toolRoundLimit} rounds`);
    this.name = "ToolRoundLimitError";
  }
}

/**
 * Whether an error thrown out of a LangGraph run is the tool-call budget
 * ending the turn — the budget's own signal, not a failure: the adapter ends
 * the turn `tool_call_limit`. Two producers, one outcome: the round count's
 * {@link ToolRoundLimitError}, which reaches the turn wrapped in LangChain's
 * `MiddlewareError` once per `wrapModelCall` layer (so the cause chain is
 * walked, as `unwrapModelError` does for a model error), and the backstop's
 * `GraphRecursionError`.
 */
export function isToolCallBudgetStop(err: unknown): boolean {
  return unwrapModelError(err) instanceof ToolRoundLimitError || isRecursionLimitError(err);
}

/**
 * LangGraph exhausting the backstop recursion limit. Matched by class name and
 * message because the error class is not exported on a stable path across
 * `@langchain/langgraph` versions.
 */
function isRecursionLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.constructor.name === "GraphRecursionError" ||
      err.message.includes("GraphRecursionError") ||
      err.message.includes("Recursion limit");
  }
  return false;
}
