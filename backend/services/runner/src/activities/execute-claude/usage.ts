/**
 * The Claude engine's usage, reported as its model calls happen, priced the
 * way the native engine prices its own.
 *
 * Measured on the engine (SDK 0.3.310):
 *
 *  - Each model call of the main loop is counted exactly by its streamed
 *    `message_start` (the input, written and read cache buckets) and
 *    `message_delta` (the output so far, the last one the call's total);
 *    the whole assistant messages carry an output of zero. So a main-loop
 *    call is reported once, when its `message_stop` arrives, and the cost
 *    cap holds from the first call.
 *  - A sub-agent's calls are not streamed to the turn. Each arrives as a
 *    whole assistant message carrying the call's input and cache buckets
 *    exactly and an output of zero, and the engine's per-agent figure (the
 *    `Agent` call's result) covers the sub-agent's last call alone. So a
 *    sub-agent's call is reported once, by its message id, with its input,
 *    as it arrives.
 *  - Every result carries `modelUsage`, exact and cumulative over the whole
 *    engine run, main loop and sub-agents alike. So at each result the
 *    output still unreported (the sub-agents' calls') is reported, the
 *    cumulative total less what was reported: the turn's totals are exact,
 *    and the cap hears a sub-agent's output when the round ends. The figure
 *    starts at zero with each invocation, which is one engine process, and
 *    so does this count.
 *
 * Counts are reported as the native engine reports them (`input` including
 * the cache buckets, `execute-deep-agent/turn-stream.ts`) and priced over the
 * disjoint buckets by the shared table (`shared/model-pricing.ts`), keyed by
 * the model id the turn names; a sub-agent's calls are priced at the turn's
 * model, as the native engine prices them (stigmer#1121). The runtime
 * accounts and enforces; this only reports (`harness/usage-accumulator.ts`).
 * The bill is the proxy's, from the wire.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { UsageDelta } from "../../harness/types.js";
import { computeTurnCost, type ModelPricing } from "../../shared/model-pricing.js";

/** One call's counts as the stream reports them. */
interface CallCounts {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** The usage of one invocation's engine run (the header). */
export class ClaudeUsage {
  private current: CallCounts | undefined;
  /** Sub-agent messages already counted, by the API message id (one call's content may arrive as several messages). */
  private readonly counted = new Set<string>();
  /** The output reported so far this run, against the results' cumulative figure. */
  private outputReported = 0;

  constructor(
    private readonly pricing: ModelPricing,
    private readonly model: string,
  ) {}

  /** The priced usage a message completes, or undefined when it completes none. */
  observe(message: SDKMessage): UsageDelta | undefined {
    if (message.type === "assistant" && message.parent_tool_use_id !== null) return this.subagentCall(message.message.id, message.message.usage);
    if (message.type === "result") return this.atResult(message.modelUsage);
    if (message.type !== "stream_event" || message.parent_tool_use_id !== null) return undefined;
    const event = message.event;
    switch (event.type) {
      case "message_start": {
        const usage = event.message.usage;
        this.current = {
          input: usage.input_tokens ?? 0,
          cacheWrite: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
        };
        return undefined;
      }
      case "message_delta":
        if (this.current !== undefined) this.current.output = event.usage.output_tokens ?? this.current.output;
        return undefined;
      case "message_stop": {
        const call = this.current;
        this.current = undefined;
        return call === undefined ? undefined : this.priced(call);
      }
      default:
        return undefined;
    }
  }

  /** A sub-agent's call, counted once by its message id (the header). */
  private subagentCall(id: string, usage: { readonly input_tokens?: number | null; readonly cache_creation_input_tokens?: number | null; readonly cache_read_input_tokens?: number | null; readonly output_tokens?: number | null }): UsageDelta | undefined {
    if (this.counted.has(id)) return undefined;
    this.counted.add(id);
    return this.priced({ input: usage.input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, output: usage.output_tokens ?? 0 });
  }

  /** At a result: the output the cumulative figure holds and no call reported (the header). */
  private atResult(modelUsage: Readonly<Record<string, { readonly outputTokens: number }>>): UsageDelta | undefined {
    const total = Object.values(modelUsage).reduce((sum, model) => sum + model.outputTokens, 0);
    if (total <= this.outputReported) return undefined;
    return this.priced({ input: 0, cacheWrite: 0, cacheRead: 0, output: total - this.outputReported });
  }

  private priced(call: CallCounts): UsageDelta {
    this.outputReported += call.output;
    return {
      inputTokens: call.input + call.cacheWrite + call.cacheRead,
      outputTokens: call.output,
      cacheReadTokens: call.cacheRead,
      cacheWriteTokens: call.cacheWrite,
      estimatedCostUsd: computeTurnCost(this.pricing, call.input, call.output, call.cacheWrite, call.cacheRead),
      model: this.model,
    };
  }
}
