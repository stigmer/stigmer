/**
 * Cost cap middleware for agent execution budget enforcement.
 *
 * Tracks running estimated cost of LLM calls and enforces a
 * configurable cost ceiling:
 *
 * afterModel — extracts usage_metadata from the latest AIMessage,
 *   computes incremental cost, accumulates a running total. Injects
 *   a warning SystemMessage at ~80% and a termination message at 100%.
 *
 * wrapToolCall — blocks all tool execution when the budget is exceeded,
 *   giving the model one final tool-free round to produce a summary.
 *
 * Only injected when maxCostUsd > 0 is explicitly configured.
 */

import { ToolMessage, SystemMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, CostCapConfig } from "./types.js";

const DEFAULT_WARNING_PCT = 80;
const MIN_WARNING_PCT = 50;
const MAX_WARNING_PCT = 95;

export interface CostCapMiddleware extends StigmerMiddleware {
  readonly runningCost: number;
  readonly exceeded: boolean;
  forSubAgent(): StigmerMiddleware;
}

interface UsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number } | null;
}

function extractUsage(aiMessage: Record<string, unknown>): {
  totalInput: number; output: number; cacheRead: number;
} {
  const usage = (aiMessage as { usage_metadata?: UsageMetadata }).usage_metadata;
  if (!usage) return { totalInput: 0, output: 0, cacheRead: 0 };

  const totalInput = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const details = usage.input_token_details;
  const cacheRead = (details && typeof details === "object")
    ? (details.cache_read ?? 0)
    : 0;

  return { totalInput, output, cacheRead };
}

export function createCostCapMiddleware(config: CostCapConfig): CostCapMiddleware {
  const {
    maxCostUsd,
    inputPricePerMillion,
    outputPricePerMillion,
    cacheReadPricePerMillion,
  } = config;
  const warningPct = config.warningPct ?? DEFAULT_WARNING_PCT;

  if (maxCostUsd <= 0) throw new Error(`maxCostUsd must be positive, got ${maxCostUsd}`);
  if (warningPct < MIN_WARNING_PCT || warningPct > MAX_WARNING_PCT) {
    throw new Error(`warningPct must be between ${MIN_WARNING_PCT} and ${MAX_WARNING_PCT}, got ${warningPct}`);
  }

  let runningCost = 0;
  let warned = false;
  let exceeded = false;
  let modelCallCount = 0;

  function computeCallCost(totalInput: number, output: number, cacheRead: number): number {
    let inputCost: number;
    let cacheCost: number;

    if (cacheReadPricePerMillion > 0 && cacheRead > 0) {
      const regularInput = Math.max(totalInput - cacheRead, 0);
      inputCost = regularInput * inputPricePerMillion;
      cacheCost = cacheRead * cacheReadPricePerMillion;
    } else {
      inputCost = totalInput * inputPricePerMillion;
      cacheCost = 0;
    }

    const outputCost = output * outputPricePerMillion;
    return (inputCost + cacheCost + outputCost) / 1_000_000;
  }

  function createWarningMessage(): SystemMessage {
    const pct = maxCostUsd > 0 ? (runningCost / maxCostUsd * 100) : 0;
    const remaining = Math.max(maxCostUsd - runningCost, 0);
    return new SystemMessage({
      content:
        `Budget warning: This execution has consumed ` +
        `$${runningCost.toFixed(4)} of the $${maxCostUsd.toFixed(2)} ` +
        `budget (${pct.toFixed(0)}%). ` +
        `Approximately $${remaining.toFixed(4)} remaining. ` +
        `Prioritize completing your current task. Summarize results ` +
        `and any remaining work so the user can continue in the next message.`,
    });
  }

  function createExceededMessage(): SystemMessage {
    return new SystemMessage({
      content:
        `Budget exceeded: This execution has consumed ` +
        `$${runningCost.toFixed(4)}, exceeding the ` +
        `$${maxCostUsd.toFixed(2)} budget. ` +
        `All tool calls are now blocked. ` +
        `Respond with a summary of what you accomplished and ` +
        `what work remains so the user can continue.`,
    });
  }

  function processAfterModel(state: Record<string, unknown>): { messages: SystemMessage[] } | void {
    if (exceeded) return;

    const messages = (state.messages ?? []) as unknown[];
    let lastAi: Record<string, unknown> | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { _getType?: () => string };
      if (msg?._getType?.() === "ai") {
        lastAi = msg as Record<string, unknown>;
        break;
      }
    }
    if (!lastAi) return;

    const { totalInput, output, cacheRead } = extractUsage(lastAi);
    if (totalInput === 0 && output === 0) return;

    const callCost = computeCallCost(totalInput, output, cacheRead);
    runningCost += callCost;
    modelCallCount++;

    const warningThreshold = maxCostUsd * warningPct / 100;

    if (runningCost >= maxCostUsd) {
      exceeded = true;
      console.warn(
        `[CostCap] EXCEEDED: $${runningCost.toFixed(4)} >= $${maxCostUsd.toFixed(2)} ` +
        `after ${modelCallCount} calls. Tool execution will be blocked.`,
      );
      return { messages: [createExceededMessage()] };
    }

    if (!warned && runningCost >= warningThreshold) {
      warned = true;
      console.warn(
        `[CostCap] WARNING: $${runningCost.toFixed(4)} >= $${warningThreshold.toFixed(4)} ` +
        `(${warningPct}% of $${maxCostUsd.toFixed(2)}) after ${modelCallCount} calls.`,
      );
      return { messages: [createWarningMessage()] };
    }
  }

  async function processWrapToolCall(
    request: Parameters<NonNullable<StigmerMiddleware["wrapToolCall"]>>[0],
    handler: Parameters<NonNullable<StigmerMiddleware["wrapToolCall"]>>[1],
  ) {
    if (exceeded) {
      return new ToolMessage({
        content:
          `[Budget exceeded: tool execution blocked. ` +
          `Summarize your progress for the user.]`,
        tool_call_id: request.toolCall.id,
        name: request.toolCall.name,
      });
    }
    return await handler(request);
  }

  const middleware: CostCapMiddleware = {
    name: "CostCapMiddleware",

    get runningCost() { return runningCost; },
    get exceeded() { return exceeded; },

    beforeAgent() {
      runningCost = 0;
      warned = false;
      exceeded = false;
      modelCallCount = 0;
    },

    afterModel(state) {
      return processAfterModel(state);
    },

    wrapToolCall: processWrapToolCall,

    afterAgent() {
      const pctUsed = maxCostUsd > 0
        ? (runningCost / maxCostUsd * 100)
        : 0;
      console.log(
        `[CostCap] Summary: $${runningCost.toFixed(4)} of $${maxCostUsd.toFixed(2)} ` +
        `(~${pctUsed.toFixed(0)}%) across ${modelCallCount} calls, ` +
        `warned=${warned}, exceeded=${exceeded}`,
      );
    },

    forSubAgent(): StigmerMiddleware {
      return {
        name: "CostCapSubAgentView",
        // Sub-agent view does NOT reset state on beforeAgent
        afterModel(state) { return processAfterModel(state); },
        wrapToolCall: processWrapToolCall,
      };
    },
  };

  return middleware;
}
