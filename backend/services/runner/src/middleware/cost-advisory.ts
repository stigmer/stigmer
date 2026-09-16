/**
 * Cost advisory middleware: warns the model once as the execution's estimated
 * spend nears `max_cost_usd`, so it can wrap up before the cap.
 *
 * It ADVISES; it does not cap. The one enforcement of `max_cost_usd` is the
 * turn runtime's (`harness/run-turn.ts` over `shared/cost-guard.ts`): every
 * usage delta the adapter reports moves the runtime's estimate, and when the
 * estimate crosses the cap the runtime stops the turn and settles TERMINATED
 * with the cost-limit copy. The graph learns of the stop through its abort
 * signal, the same way it learns of a platform STOP or a stall. This is the
 * shape `execution-budget.ts` already has beside LangGraph's `recursionLimit`:
 * the middleware warns inside the graph, the engine's own limit enforces.
 *
 * Until #1096 this module was `cost-cap.ts` and did both: it also
 * blocked every tool call once the running cost passed the cap and gave the
 * model one tool-free round to summarize. That second enforcement lived
 * inside the graph, where the runtime could not see it, and a platform STOP
 * had a sibling (`graceful-stop.ts`, deleted with it) that let the run spend
 * a summary round after the platform said stop. Both went when the runtime
 * became the one place a turn is stopped.
 *
 * afterModel — reads `usage_metadata` off the latest AIMessage, prices the
 *   call at the parent's rates (a sub-agent on its own model is priced the
 *   same way the enforcement prices it; per-sub-agent pricing is #1121),
 *   accumulates the running total, and injects the warning SystemMessage once
 *   at `warningPct` of the cap.
 *
 * forSubAgent — a view that shares the running total, so a sub-agent's calls
 *   advance the same figure the parent's warning reads.
 *
 * Only built when `max_cost_usd > 0` is explicitly configured.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, CostAdvisoryConfig } from "./types.js";

const DEFAULT_WARNING_PCT = 80;
const MIN_WARNING_PCT = 50;
const MAX_WARNING_PCT = 95;

export interface CostAdvisoryMiddleware extends StigmerMiddleware {
  /** The running estimate this advisory has priced, in USD. */
  readonly runningCost: number;
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

export function createCostAdvisoryMiddleware(config: CostAdvisoryConfig): CostAdvisoryMiddleware {
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

  function processAfterModel(state: Record<string, unknown>): { messages: SystemMessage[] } | void {
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

    runningCost += computeCallCost(totalInput, output, cacheRead);
    modelCallCount++;

    const warningThreshold = maxCostUsd * warningPct / 100;
    if (!warned && runningCost >= warningThreshold) {
      warned = true;
      console.warn(
        `[CostAdvisory] WARNING: $${runningCost.toFixed(4)} >= $${warningThreshold.toFixed(4)} ` +
        `(${warningPct}% of $${maxCostUsd.toFixed(2)}) after ${modelCallCount} calls.`,
      );
      return { messages: [createWarningMessage()] };
    }
  }

  const middleware: CostAdvisoryMiddleware = {
    name: "CostAdvisoryMiddleware",

    get runningCost() { return runningCost; },

    beforeAgent() {
      runningCost = 0;
      warned = false;
      modelCallCount = 0;
    },

    afterModel(state) {
      return processAfterModel(state);
    },

    afterAgent() {
      const pctUsed = maxCostUsd > 0
        ? (runningCost / maxCostUsd * 100)
        : 0;
      console.log(
        `[CostAdvisory] Summary: $${runningCost.toFixed(4)} of $${maxCostUsd.toFixed(2)} ` +
        `(~${pctUsed.toFixed(0)}%) across ${modelCallCount} calls, warned=${warned}`,
      );
    },

    forSubAgent(): StigmerMiddleware {
      return {
        name: "CostAdvisorySubAgentView",
        // The view does NOT reset the running total on beforeAgent: a
        // sub-agent's calls advance the parent's figure.
        afterModel(state) { return processAfterModel(state); },
      };
    },
  };

  return middleware;
}
