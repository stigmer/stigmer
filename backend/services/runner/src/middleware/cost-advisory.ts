/**
 * Cost advisory middleware: warns the model once as the execution's estimated
 * spend nears `max_cost_usd`, so it can wrap up before the cap.
 *
 * It ADVISES; it does not cap. The one enforcement of `max_cost_usd` is the
 * turn runtime's (`harness/run-turn.ts` over `shared/cost-guard.ts`): every
 * usage delta the adapter reports moves the runtime's estimate, and when the
 * estimate crosses the cap the runtime stops the turn and settles TERMINATED
 * with the cost-limit copy. The graph learns of the stop through its abort
 * signal, the same way it learns of a platform STOP or a stall. The
 * middleware warns inside the graph; the runtime enforces, because the
 * running estimate advances only in its usage accumulator. The round budget
 * is the one budget enforced where it is counted (`execution-budget.ts`): a
 * round is visible only at the model call, and stopping there is what makes
 * it exact.
 *
 * Until #1096 this module was `cost-cap.ts` and did both: it also
 * blocked every tool call once the running cost passed the cap and gave the
 * model one tool-free round to summarize. That second enforcement lived
 * inside the graph, where the runtime could not see it, and a platform STOP
 * had a sibling (`graceful-stop.ts`, deleted with it) that let the run spend
 * a summary round after the platform said stop. Both went when the runtime
 * became the one place a turn is stopped.
 *
 * wrapModelCall — after the model answers, reads `usage_metadata` off its
 *   response, prices the call at the parent's rates (a sub-agent on its own
 *   model is priced the same way the enforcement prices it; per-sub-agent
 *   pricing is #1121), and accumulates the running total. Once the total
 *   reaches `warningPct` of the cap, the stack that made the call advises the
 *   model on its next call (`advisory-message.ts`): the warning rides that
 *   one request and never enters the graph's state. Until
 *   stigmer/stigmer#1354 the warning was a SystemMessage returned from
 *   `afterModel`, which landed between the model's tool calls and their
 *   results, failed the next Anthropic call, and was replayed into every
 *   later turn of the session from its checkpoint.
 *
 * forSubAgent — a view that shares the running total, so a sub-agent's calls
 *   advance the same figure the parent's warning reads. The view keeps its
 *   own pending advisory, delivered on that sub-agent's next model call. One
 *   view serves every invocation of its sub-agent in the turn (the stack is
 *   built once per sub-agent spec), so its `beforeAgent` drops a warning the
 *   previous invocation left undelivered, and never resets the shared total.
 *   The warning is given once per run, so when the crossing call is a
 *   sub-agent's last, nobody is warned: the sub-agent makes no further call
 *   and the parent's flag is already spent (#1679). Concurrent invocations of
 *   one sub-agent share the view, as they share its loop and budget
 *   middleware.
 *
 * Only built when `max_cost_usd > 0` is explicitly configured.
 */

import { AIMessage } from "@langchain/core/messages";
import type { StigmerMiddleware, CostAdvisoryConfig, ModelCallRequest } from "./types.js";
import { withAdvisories } from "./advisory-message.js";

const DEFAULT_WARNING_PCT = 80;
const MIN_WARNING_PCT = 50;
const MAX_WARNING_PCT = 95;

export interface CostAdvisoryMiddleware extends StigmerMiddleware {
  /** The running estimate this advisory has priced, in USD. */
  readonly runningCost: number;
  forSubAgent(): StigmerMiddleware;
}

type WrapModelCall = NonNullable<StigmerMiddleware["wrapModelCall"]>;

function extractUsage(response: AIMessage): {
  totalInput: number; output: number; cacheRead: number;
} {
  const usage = response.usage_metadata;
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

  function createWarningText(): string {
    const pct = maxCostUsd > 0 ? (runningCost / maxCostUsd * 100) : 0;
    const remaining = Math.max(maxCostUsd - runningCost, 0);
    return (
      `Budget warning: This execution has consumed ` +
      `$${runningCost.toFixed(4)} of the $${maxCostUsd.toFixed(2)} ` +
      `budget (${pct.toFixed(0)}%). ` +
      `Approximately $${remaining.toFixed(4)} remaining. ` +
      `Prioritize completing your current task. Summarize results ` +
      `and any remaining work so the user can continue in the next message.`
    );
  }

  /** Prices one model response; returns the warning when this call crossed the threshold, else null. */
  function priceResponse(response: unknown): string | null {
    if (!AIMessage.isInstance(response)) return null;

    const { totalInput, output, cacheRead } = extractUsage(response);
    if (totalInput === 0 && output === 0) return null;

    runningCost += computeCallCost(totalInput, output, cacheRead);
    modelCallCount++;

    const warningThreshold = maxCostUsd * warningPct / 100;
    if (warned || runningCost < warningThreshold) return null;
    warned = true;
    console.warn(
      `[CostAdvisory] WARNING: $${runningCost.toFixed(4)} >= $${warningThreshold.toFixed(4)} ` +
      `(${warningPct}% of $${maxCostUsd.toFixed(2)}) after ${modelCallCount} calls.`,
    );
    return createWarningText();
  }

  /**
   * One graph's model-call wrapper: delivers that graph's pending advisory,
   * then prices the response. Each graph (the parent, each sub-agent view)
   * holds its own pending slot over the one shared running total; a slot
   * still pending when its graph stops calling the model is never delivered.
   */
  function advisingWrapper(): { wrapModelCall: WrapModelCall; clear(): void } {
    let pending: string | null = null;
    return {
      async wrapModelCall(request: ModelCallRequest, handler) {
        const advisories = pending !== null ? [pending] : [];
        pending = null;
        const response = await handler(withAdvisories(request, advisories));
        const warning = priceResponse(response);
        if (warning !== null) pending = warning;
        return response;
      },
      clear() {
        pending = null;
      },
    };
  }

  const parent = advisingWrapper();

  const middleware: CostAdvisoryMiddleware = {
    name: "CostAdvisoryMiddleware",

    get runningCost() { return runningCost; },

    beforeAgent() {
      runningCost = 0;
      warned = false;
      modelCallCount = 0;
      parent.clear();
    },

    wrapModelCall: parent.wrapModelCall,

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
      const view = advisingWrapper();
      return {
        name: "CostAdvisorySubAgentView",
        // Drops only this view's undelivered warning. The running total is the
        // parent's and is never reset here: a sub-agent's calls advance it.
        beforeAgent() {
          view.clear();
        },
        wrapModelCall: view.wrapModelCall,
      };
    },
  };

  return middleware;
}
