/**
 * The Claude engine's usage, one report per main-loop model call, priced the
 * way the native engine prices its own.
 *
 * Measured on the engine: each model call of the main loop is counted
 * exactly by its streamed `message_start` (the input, written and read cache
 * buckets) and `message_delta` (the output so far, the last one the call's
 * total); the whole assistant messages carry an output of zero, and the
 * engine's own result totals are per query and cover the main loop only. So
 * a call is reported once, when its `message_stop` arrives, and the cost cap
 * holds from the first call. A sub-agent's calls are not on the main loop's
 * stream; they arrive as the agent's own totals when it ends, which is the
 * sub-agents' half (not yet: a turn with sub-agents is refused).
 *
 * Counts are reported as the native engine reports them (`input` including
 * the cache buckets, `execute-deep-agent/turn-stream.ts`) and priced over the
 * disjoint buckets by the shared table (`shared/model-pricing.ts`), keyed by
 * the model id the turn names. The runtime accounts and enforces; this only
 * reports (`harness/usage-accumulator.ts`). The bill is the proxy's, from
 * the wire.
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

/** The usage of one turn's main loop (the header). */
export class ClaudeUsage {
  private current: CallCounts | undefined;

  constructor(
    private readonly pricing: ModelPricing,
    private readonly model: string,
  ) {}

  /** The priced usage a message completes, or undefined when it completes none. */
  observe(message: SDKMessage): UsageDelta | undefined {
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

  private priced(call: CallCounts): UsageDelta {
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
