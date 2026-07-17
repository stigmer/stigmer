/**
 * ExecutionConfig.max_cost_usd enforcement for the Cursor harness.
 *
 * The native harness enforces the cap in middleware (cost-cap.ts): tools are
 * blocked at the threshold and the model gets one final tool-free round to
 * summarize. Cursor's only control point is cancelling the in-flight run, so
 * here the cap is a HARD stop — the shared onDelta flags the overrun when a
 * turn-ended usage delta lands, and the stream loop ends the run through the
 * same clean-cancel pattern the stall watchdog and first-denial stop use.
 * Slightly harsher than native by construction; both harnesses terminate with
 * the same honesty semantics (EXECUTION_TERMINATED, work checkpointed, the
 * conversation continues on the next message — the recursion-limit precedent
 * in execute-deep-agent/streaming-terminal.ts).
 *
 * The running figure is the usage accumulator's local pricing-table estimate
 * (authoritative billing is the BiDi proxy). That is the same estimation
 * basis the native cost-cap middleware uses — acceptable for a safety net.
 */

/**
 * Whether the per-execution cost budget has been exhausted.
 *
 * `maxCostUsd <= 0` means "no cap" (the proto contract: 0/unset disables the
 * ceiling). The boundary is inclusive: reaching the cap exactly stops the run,
 * matching the native middleware's `runningCost >= maxCostUsd` check.
 */
export function costCapExceeded(maxCostUsd: number, estimatedCostUsd: number): boolean {
  return maxCostUsd > 0 && estimatedCostUsd >= maxCostUsd;
}

/**
 * Stable prefix of the cost-limit terminal error. Mirrors the cross-repo
 * pattern of TOOL_CALL_LIMIT_ERROR_PREFIX (streaming-terminal.ts): consumers
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
