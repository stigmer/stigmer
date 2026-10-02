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
 *   pricing is #1121), and accumulates the running total. The call that
 *   takes the total to `warningPct` of the cap marks the run crossed, once.
 *   From then on every conversation in the run, the parent's and each
 *   sub-agent invocation's, is advised once, on its next model call
 *   (`advisory-message.ts`): the warning rides that one request and never
 *   enters the graph's state. Its text is written as it is delivered, so a
 *   copy read after further spend quotes the spend as it stands. Until
 *   stigmer/stigmer#1354 the warning was a SystemMessage returned from
 *   `afterModel`, which landed between the model's tool calls and their
 *   results, failed the next Anthropic call, and was replayed into every
 *   later turn of the session from its checkpoint.
 *
 * Who is told (stigmer/stigmer#1679): until then only the graph whose call
 *   crossed was told. When that call was a sub-agent's last, nobody was; when
 *   a sub-agent was told mid-task, it wrapped up while the parent, which
 *   decides whether to delegate again and writes the answer the user reads,
 *   never heard. Now the parent always hears it, on its call after its
 *   sub-agents return, and a sub-agent invoked after the crossing hears it on
 *   its first call, before it spends.
 *
 * forSubAgent — a view over the same running total, so a sub-agent's calls
 *   advance the figure every warning reads, with its own record of whether
 *   its conversation has been told. Each invocation of a sub-agent gets its
 *   own view (`compileSubagents` builds the stack per invocation), so two
 *   invocations running at once are each told once; its `beforeAgent` starts
 *   a conversation that has heard nothing, and never resets the shared total.
 *   Until stigmer/stigmer#1699 one view served every invocation in the turn,
 *   and of two running at once usually only the first to call was told.
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
  let crossed = false;
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

  /** Prices one model response into the running total; marks the run crossed when this call takes it past the threshold. */
  function priceResponse(response: unknown): void {
    if (!AIMessage.isInstance(response)) return;

    const { totalInput, output, cacheRead } = extractUsage(response);
    if (totalInput === 0 && output === 0) return;

    runningCost += computeCallCost(totalInput, output, cacheRead);
    modelCallCount++;

    const warningThreshold = maxCostUsd * warningPct / 100;
    if (crossed || runningCost < warningThreshold) return;
    crossed = true;
    console.warn(
      `[CostAdvisory] WARNING: $${runningCost.toFixed(4)} >= $${warningThreshold.toFixed(4)} ` +
      `(${warningPct}% of $${maxCostUsd.toFixed(2)}) after ${modelCallCount} calls.`,
    );
  }

  /**
   * One conversation's model-call wrapper: once the run has crossed, advises
   * the first call this conversation makes after it, then prices the
   * response. The parent and each sub-agent view hold one each, over the one
   * shared running total. `told` is set before the call is handed on, so a
   * second call that starts while the first is in flight is not advised again.
   */
  function advisingConversation(): { wrapModelCall: WrapModelCall; reset(): void } {
    let told = false;
    return {
      async wrapModelCall(request: ModelCallRequest, handler) {
        const advise = crossed && !told;
        if (advise) told = true;
        const response = await handler(withAdvisories(request, advise ? [createWarningText()] : []));
        priceResponse(response);
        return response;
      },
      reset() {
        told = false;
      },
    };
  }

  const parent = advisingConversation();

  const middleware: CostAdvisoryMiddleware = {
    name: "CostAdvisoryMiddleware",

    get runningCost() { return runningCost; },

    beforeAgent() {
      runningCost = 0;
      crossed = false;
      modelCallCount = 0;
      parent.reset();
    },

    wrapModelCall: parent.wrapModelCall,

    afterAgent() {
      const pctUsed = maxCostUsd > 0
        ? (runningCost / maxCostUsd * 100)
        : 0;
      console.log(
        `[CostAdvisory] Summary: $${runningCost.toFixed(4)} of $${maxCostUsd.toFixed(2)} ` +
        `(~${pctUsed.toFixed(0)}%) across ${modelCallCount} calls, crossed=${crossed}`,
      );
    },

    forSubAgent(): StigmerMiddleware {
      const view = advisingConversation();
      return {
        name: "CostAdvisorySubAgentView",
        // A new invocation is a new conversation, told nothing yet. The
        // running total is the parent's and is never reset here: a
        // sub-agent's calls advance it.
        beforeAgent() {
          view.reset();
        },
        wrapModelCall: view.wrapModelCall,
      };
    },
  };

  return middleware;
}
