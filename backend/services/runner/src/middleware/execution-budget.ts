/**
 * Execution budget middleware for autonomous agents: `max_tool_rounds`' own
 * enforcement, and the advisories that warn the model before it.
 *
 * The stop (whenever `maxToolRounds` is set):
 *   A round is one model response that proposes one or more tool calls
 *   (parallel calls are one round), counted here as each response returns.
 *   Once N rounds have been proposed, the next model call does not happen:
 *   `wrapModelCall` throws `ToolRoundLimitError` in its place, the graph
 *   ends on round N's tool results, and the native turn reads the error as
 *   the `tool_call_limit` outcome (`shared/tool-rounds.ts`
 *   `isToolCallBudgetStop`). Stopping before a model call, never between a
 *   model call and its tools, is what makes N exact and leaves no proposed
 *   call unexecuted in the checkpoint. It is the one stop a middleware makes
 *   (`middleware/index.ts`): the runtime still sees it, as an outcome.
 *
 * Two advisory modes:
 *
 * Threshold mode (default, warningInterval=null):
 *   Fires a single advisory at a percentage of the round budget
 *   (`maxToolRounds`, or the unbounded advisory figure when unset).
 *
 * Periodic mode (warningInterval set):
 *   Fires an advisory every N model calls with escalating urgency,
 *   up to maxWarnings times. Sub-agent stacks use it, with no stop.
 *
 * Uses wrapModelCall (not afterModel) so the advisory rides the next model
 * request alone, as a user-role message after the latest tool results
 * (`advisory-message.ts` says why that is the one shape every provider
 * accepts), and never enters the graph's state; and so that the count and
 * the stop add no graph node of their own: a node per round is exactly the
 * cost that made the old super-step budget drift. Until stigmer/stigmer#1354
 * the advisory was a SystemMessage appended to the request, which Anthropic
 * refuses anywhere but first: every Anthropic run that reached 80% of its
 * budget failed instead of running to the limit.
 */

import { AIMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, ExecutionBudgetConfig } from "./types.js";
import { withAdvisories } from "./advisory-message.js";
import { ToolRoundLimitError, UNBOUNDED_ADVISORY_TOOL_ROUNDS } from "../shared/tool-rounds.js";

const DEFAULT_WARNING_PCT = 80;
const MIN_WARNING_PCT = 50;
const MAX_WARNING_PCT = 95;
const MIN_ROUNDS_BEFORE_WARNING = 3;

const PERIODIC_MESSAGES: readonly string[] = [
  "You have been working for {rounds} model rounds. " +
    "If your task is nearing completion, start wrapping up. " +
    "Summarize progress so far and outline any remaining steps.",

  "Extended execution: {rounds} model rounds. " +
    "Prioritize completing your current task now. " +
    "Summarize results and any remaining work so the user can " +
    "continue in the next message.",

  "Long-running execution: {rounds} model rounds. " +
    "Wrap up your work — provide your findings and conclude. " +
    "If you cannot finish, summarize what you accomplished and what remains.",

  "Critical: {rounds} model rounds reached. " +
    "Provide your final answer immediately with whatever " +
    "information you have gathered. Do not start new tool calls " +
    "unless absolutely essential to your conclusion.",
];

function computeWarningRound(roundBudget: number, warningPct: number): number {
  const threshold = Math.floor(roundBudget * warningPct / 100);
  return Math.max(threshold, MIN_ROUNDS_BEFORE_WARNING);
}

/** Whether a model call's response proposed tools: the round definition (a `Command` response is not one). */
function isToolRound(response: unknown): boolean {
  return AIMessage.isInstance(response) && (response.tool_calls?.length ?? 0) > 0;
}

export function createExecutionBudgetMiddleware(
  config: Partial<ExecutionBudgetConfig> = {},
): StigmerMiddleware {
  const maxToolRounds = config.maxToolRounds ?? null;
  const roundBudget = maxToolRounds ?? UNBOUNDED_ADVISORY_TOOL_ROUNDS;
  const warningPct = config.warningPct ?? DEFAULT_WARNING_PCT;
  const warningInterval = config.warningInterval ?? null;
  const maxWarnings = config.maxWarnings ?? 4;

  const isPeriodic = warningInterval !== null;

  if (maxToolRounds !== null && maxToolRounds <= 0) {
    throw new Error(`maxToolRounds must be positive or null, got ${maxToolRounds}`);
  }
  if (isPeriodic) {
    if (warningInterval <= 0) throw new Error(`warningInterval must be positive, got ${warningInterval}`);
    if (maxWarnings <= 0) throw new Error(`maxWarnings must be positive, got ${maxWarnings}`);
  } else if (warningPct < MIN_WARNING_PCT || warningPct > MAX_WARNING_PCT) {
    throw new Error(`warningPct must be between ${MIN_WARNING_PCT} and ${MAX_WARNING_PCT}, got ${warningPct}`);
  }

  let modelRoundCount = 0;
  let toolRoundCount = 0;
  let warningCount = 0;
  let nextWarningRound = isPeriodic
    ? warningInterval!
    : computeWarningRound(roundBudget, warningPct);
  let pendingAdvisory: string | null = null;

  function createThresholdWarning(): string {
    const remaining = Math.max(roundBudget - toolRoundCount, 0);
    return (
      `You are approaching the tool-round limit for this message ` +
      `(${toolRoundCount} of ${roundBudget} tool rounds used, ${remaining} remaining). ` +
      `Prioritize completing your current task. Summarize results ` +
      `and any remaining work so the user can continue in the next message.`
    );
  }

  function createPeriodicWarning(): string {
    const idx = Math.min(warningCount, PERIODIC_MESSAGES.length) - 1;
    const template = PERIODIC_MESSAGES[Math.max(idx, 0)];
    return template.replace("{rounds}", String(modelRoundCount));
  }

  function evaluateBudget(): void {
    if (isPeriodic) {
      if (warningCount >= maxWarnings) return;
      if (modelRoundCount >= nextWarningRound) {
        warningCount++;
        nextWarningRound += warningInterval!;
        console.warn(
          `[ExecutionBudget] Advisory ${warningCount}/${maxWarnings}: ` +
          `round ${modelRoundCount} (interval=${warningInterval})`,
        );
        pendingAdvisory = createPeriodicWarning();
      }
    } else {
      if (warningCount > 0) return;
      if (toolRoundCount >= nextWarningRound) {
        warningCount = 1;
        console.warn(
          `[ExecutionBudget] WARNING: tool round ${toolRoundCount} of ${roundBudget} ` +
          `(${warningPct}% threshold)`,
        );
        pendingAdvisory = createThresholdWarning();
      }
    }
  }

  return {
    name: "ExecutionBudgetMiddleware",

    beforeAgent() {
      modelRoundCount = 0;
      toolRoundCount = 0;
      warningCount = 0;
      pendingAdvisory = null;
      nextWarningRound = isPeriodic
        ? warningInterval!
        : computeWarningRound(roundBudget, warningPct);
    },

    async wrapModelCall(request, handler) {
      if (maxToolRounds !== null && toolRoundCount >= maxToolRounds) {
        console.log(
          `[ExecutionBudget] Tool-round limit reached: ${toolRoundCount}/${maxToolRounds}; ` +
          `ending the turn before the next model call`,
        );
        throw new ToolRoundLimitError(maxToolRounds);
      }

      const advisories = pendingAdvisory !== null ? [pendingAdvisory] : [];
      pendingAdvisory = null;

      const response = await handler(withAdvisories(request, advisories));

      modelRoundCount++;
      if (isToolRound(response)) toolRoundCount++;
      evaluateBudget();

      return response;
    },

    afterAgent() {
      if (isPeriodic) {
        console.log(
          `[ExecutionBudget] Summary (periodic): ${modelRoundCount} model rounds, ` +
          `${warningCount}/${maxWarnings} advisories (interval=${warningInterval})`,
        );
      } else {
        const pctUsed = Math.floor(toolRoundCount * 100 / roundBudget);
        console.log(
          `[ExecutionBudget] Summary (threshold): ${toolRoundCount} tool rounds ` +
          `of ${roundBudget} (${pctUsed}% used), warnings=${warningCount}`,
        );
      }
    },
  };
}
