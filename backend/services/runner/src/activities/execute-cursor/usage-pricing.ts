/**
 * The Cursor harness's half of usage accounting: pricing one `turn-ended`
 * delta at the rates of the variant this turn requested, and naming that
 * basis on the priced delta the runtime accumulates.
 *
 * The runtime cannot price without the vendor's table and variant semantics,
 * and it must not import them (Q-S2-12), so the adapter hands
 * `TurnSink.reportUsage` a delta that already carries `estimatedCostUsd`
 * and the basis (`model`, the catalog-validated id; `requestedModelParams`,
 * the JSON of the params sent with every create/resume) the runtime writes
 * into `streaming_usage`. Split out of the accumulator at S2 M3
 * (`harness/usage-accumulator.ts` keeps the sums); the arithmetic and the
 * rounding are unchanged, so the estimate is byte-for-byte the old one.
 *
 * Estimate at the rates of the variant we explicitly requested: a FAST run
 * priced at base rates would understate the display estimate ~4x relative
 * to the authoritative bill (#357). Thinking is price-neutral (#772) and
 * never enters the estimate.
 */

import type { ModelParameterValue } from "@cursor/sdk";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { UsageDelta } from "../../harness/types.js";
import { getCursorModelPricingForVariant, computeTurnCost } from "./model-pricing.js";

/** The token counts of one `turn-ended` delta as the Cursor SDK reports them. */
export interface TurnUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export class CursorUsagePricer {
  /** JSON-encoded params the runner sent with the model selection (#357); "" when none. */
  private readonly requestedModelParams: string;

  constructor(
    private readonly model: string,
    private readonly requestedServiceTier: ServiceTier,
    requestedModelParams: readonly ModelParameterValue[] = [],
  ) {
    this.requestedModelParams = requestedModelParams.length > 0 ? JSON.stringify(requestedModelParams) : "";
  }

  /** One SDK usage delta, priced and attributed, ready for `TurnSink.reportUsage`. */
  price(usage: TurnUsage): UsageDelta {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
    const pricing = getCursorModelPricingForVariant(
      this.model,
      this.requestedServiceTier === ServiceTier.FAST ? "fast" : null,
    );
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      estimatedCostUsd: computeTurnCost(pricing, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
      model: this.model,
      requestedModelParams: this.requestedModelParams,
    };
  }
}
