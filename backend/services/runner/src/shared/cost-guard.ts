/**
 * ExecutionConfig.max_cost_usd enforcement as a hard stop on a harness turn.
 *
 * The one enforcement of the cap, for every harness: the turn runtime
 * (`harness/run-turn.ts`) calls `costCapExceeded` on each usage delta an
 * adapter reports, and on an overrun stops the turn through the same abort
 * the stall watchdog and a platform STOP use, then settles `costCapArm`
 * (`harness/terminal-table.ts`): EXECUTION_TERMINATED, work checkpointed, the
 * conversation continuing on the next message — the recursion-limit
 * precedent, `toolCallLimitArm`.
 *
 * Why a hard stop rather than a middleware: the Cursor activity was the
 * guard's only caller until the turn runtime took it over in #1070, and
 * Cursor's only control point is cancelling the in-flight run. The runtime
 * kept that shape for every engine, because it is where the running estimate
 * advances. Until #1096 the native harness also capped inside its graph
 * (`cost-cap.ts`: tools blocked at the threshold, one final tool-free round
 * to summarize); that middleware now only advises, near the cap
 * (`middleware/cost-advisory.ts`).
 *
 * The running figure is the runtime usage accumulator's local pricing-table
 * estimate (`harness/usage-accumulator.ts`; authoritative billing is the
 * BiDi proxy) — acceptable for a safety net. The cost advisory warns from
 * its own tally on the same estimation basis, which can differ slightly: it
 * prices cache writes at the input rate.
 */

/**
 * Whether the per-execution cost budget has been exhausted.
 *
 * `maxCostUsd <= 0` means "no cap" (the proto contract: 0/unset disables the
 * ceiling). The boundary is inclusive: reaching the cap exactly stops the run.
 */
export function costCapExceeded(maxCostUsd: number, estimatedCostUsd: number): boolean {
  return maxCostUsd > 0 && estimatedCostUsd >= maxCostUsd;
}

/**
 * Stable prefix of the cost-limit terminal error. Mirrors the cross-repo
 * pattern of TOOL_CALL_LIMIT_ERROR_PREFIX (tool-rounds.ts): consumers
 * that need to distinguish "ran out of cost budget" from other TERMINATED
 * causes can match on this prefix, because AgentExecutionStatus carries no
 * structured termination reason. Do not reword without checking consumers.
 */
export const COST_LIMIT_ERROR_PREFIX = "Agent reached the cost limit";

/** The terminal `status.error` for a cost-cap stop. */
export function formatCostLimitError(maxCostUsd: number, estimatedCostUsd: number): string {
  return (
    `${COST_LIMIT_ERROR_PREFIX} for this message ` +
    `(~$${estimatedCostUsd.toFixed(4)} of the $${maxCostUsd.toFixed(2)} budget). ` +
    `Send another message to continue.`
  );
}

/**
 * User-facing system message for a cost-cap stop. Parallel to the
 * recursion-limit copy: honest about the limit, clear that nothing is lost.
 */
export const COST_LIMIT_USER_COPY =
  "The agent reached the cost limit for this message. " +
  "Work completed so far has been saved. " +
  "Send another message to continue where the agent left off.";
