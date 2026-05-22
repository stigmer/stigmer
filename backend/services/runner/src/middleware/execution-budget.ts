/**
 * Execution budget middleware for autonomous agents.
 *
 * Two operating modes:
 *
 * Threshold mode (default, warningInterval=null):
 *   Fires a single SystemMessage at a computed percentage of the
 *   LangGraph recursion limit.
 *
 * Periodic mode (warningInterval set):
 *   Fires a SystemMessage every N model rounds with escalating urgency,
 *   up to maxWarnings times.
 *
 * Uses wrapModelCall (not afterModel) to safely prepend advisory
 * messages to the model's input, avoiding the AIMessage/ToolMessage
 * ordering violation that would occur if we injected between a
 * tool_use AIMessage and its corresponding ToolMessage.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, ExecutionBudgetConfig } from "./types.js";

const DEFAULT_RECURSION_LIMIT = 6000;
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

function computeWarningRound(recursionLimit: number, warningPct: number): number {
  const estimatedTotalRounds = Math.floor(recursionLimit / 6);
  const threshold = Math.floor(estimatedTotalRounds * warningPct / 100);
  return Math.max(threshold, MIN_ROUNDS_BEFORE_WARNING);
}

export function createExecutionBudgetMiddleware(
  config: Partial<ExecutionBudgetConfig> = {},
): StigmerMiddleware {
  const recursionLimit = config.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
  const warningPct = config.warningPct ?? DEFAULT_WARNING_PCT;
  const warningInterval = config.warningInterval ?? null;
  const maxWarnings = config.maxWarnings ?? 4;

  const isPeriodic = warningInterval !== null;

  if (isPeriodic) {
    if (warningInterval <= 0) throw new Error(`warningInterval must be positive, got ${warningInterval}`);
    if (maxWarnings <= 0) throw new Error(`maxWarnings must be positive, got ${maxWarnings}`);
  } else {
    if (warningPct < MIN_WARNING_PCT || warningPct > MAX_WARNING_PCT) {
      throw new Error(`warningPct must be between ${MIN_WARNING_PCT} and ${MAX_WARNING_PCT}, got ${warningPct}`);
    }
    if (recursionLimit <= 0) throw new Error(`recursionLimit must be positive, got ${recursionLimit}`);
  }

  let modelRoundCount = 0;
  let warningCount = 0;
  let nextWarningRound = isPeriodic
    ? warningInterval!
    : computeWarningRound(recursionLimit, warningPct);
  let pendingAdvisory: SystemMessage | null = null;

  function createThresholdWarning(): SystemMessage {
    const estimatedTotal = Math.floor(recursionLimit / 6);
    const remaining = Math.max(estimatedTotal - modelRoundCount, 0);
    return new SystemMessage({
      content:
        `You are approaching the step limit for this message ` +
        `(approximately ${warningPct}% used, ~${remaining} rounds remaining). ` +
        `Prioritize completing your current task. Summarize results ` +
        `and any remaining work so the user can continue in the next message.`,
    });
  }

  function createPeriodicWarning(): SystemMessage {
    const idx = Math.min(warningCount, PERIODIC_MESSAGES.length) - 1;
    const template = PERIODIC_MESSAGES[Math.max(idx, 0)];
    return new SystemMessage({
      content: template.replace("{rounds}", String(modelRoundCount)),
    });
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
      if (modelRoundCount >= nextWarningRound) {
        warningCount = 1;
        const estimatedTotal = Math.floor(recursionLimit / 6);
        console.warn(
          `[ExecutionBudget] WARNING: round ${modelRoundCount} of ~${estimatedTotal} ` +
          `(~${warningPct}% of recursion_limit=${recursionLimit})`,
        );
        pendingAdvisory = createThresholdWarning();
      }
    }
  }

  return {
    name: "ExecutionBudgetMiddleware",

    beforeAgent() {
      modelRoundCount = 0;
      warningCount = 0;
      pendingAdvisory = null;
      nextWarningRound = isPeriodic
        ? warningInterval!
        : computeWarningRound(recursionLimit, warningPct);
    },

    async wrapModelCall(request, handler) {
      let effectiveRequest = request;

      if (pendingAdvisory !== null) {
        const advisory = pendingAdvisory;
        pendingAdvisory = null;
        const messages = [...(request.messages as unknown[]), advisory];
        effectiveRequest = { ...request, messages };
      }

      const response = await handler(effectiveRequest);

      modelRoundCount++;
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
        const estimatedTotal = Math.floor(recursionLimit / 6);
        const pctUsed = estimatedTotal > 0
          ? Math.floor(modelRoundCount * 100 / estimatedTotal)
          : 0;
        console.log(
          `[ExecutionBudget] Summary (threshold): ${modelRoundCount} rounds ` +
          `of ~${estimatedTotal} (~${pctUsed}% used), warnings=${warningCount}`,
        );
      }
    },
  };
}
