/**
 * Accumulates per-turn token usage from Cursor SDK onDelta callbacks.
 *
 * Designed for the empty {@code turn-ended} handler in execute-cursor.ts.
 * Each call to {@link addTurn} sums token counts and computes a running
 * estimated cost from the cursor-runner's local pricing table.
 *
 * The snapshot is written to {@code AgentExecutionStatus.streaming_usage}
 * on every heartbeat, giving the UI real-time streaming visibility.
 *
 * This data is display-only. The authoritative billing source is the
 * BiDi proxy (CursorBidiStreamHandler) which will record usage from the
 * wire via ProxyUsageReporter once traffic routing (Task 5B) is complete.
 */

import type { ModelParameterValue } from "@cursor/sdk";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { getCursorModelPricingForVariant, computeTurnCost } from "./model-pricing.js";

export interface TurnUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface UsageSnapshot {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cacheReadTokens: bigint;
  readonly cacheWriteTokens: bigint;
  readonly totalTokens: bigint;
  readonly turnCount: number;
  readonly estimatedCostUsd: number;
  readonly model: string;
  readonly observedAt: string;
  /** Tier the runner requested — always explicit post-translation (#357). */
  readonly requestedServiceTier: ServiceTier;
  /** JSON-encoded ModelSelection.params the runner sent; "" when none. */
  readonly requestedModelParams: string;
}

const EMPTY_SNAPSHOT: UsageSnapshot = {
  inputTokens: 0n,
  outputTokens: 0n,
  cacheReadTokens: 0n,
  cacheWriteTokens: 0n,
  totalTokens: 0n,
  turnCount: 0,
  estimatedCostUsd: 0,
  model: "",
  observedAt: "",
  requestedServiceTier: ServiceTier.UNSPECIFIED,
  requestedModelParams: "",
};

export interface TurnRecord {
  readonly sequence: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export class UsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private turnCount = 0;
  private estimatedCostUsd = 0;
  private observedAt = "";
  private readonly turnRecords: TurnRecord[] = [];

  /** JSON-encoded params the runner sent with the model selection (#357). */
  private readonly requestedModelParams: string;

  constructor(
    private readonly model: string,
    /**
     * The explicit tier the runner requested from the provider. Recorded
     * verbatim into status as the audit trail that the account default was
     * never left in control (#357).
     */
    private readonly requestedServiceTier: ServiceTier = ServiceTier.UNSPECIFIED,
    requestedModelParams: readonly ModelParameterValue[] = [],
  ) {
    this.requestedModelParams =
      requestedModelParams.length > 0 ? JSON.stringify(requestedModelParams) : "";
  }

  addTurn(usage: TurnUsage): void {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheWrite = usage.cacheWriteTokens ?? 0;

    this.inputTokens += input;
    this.outputTokens += output;
    this.cacheReadTokens += cacheRead;
    this.cacheWriteTokens += cacheWrite;
    this.turnCount++;
    this.observedAt = new Date().toISOString();
    this.turnRecords.push({
      sequence: this.turnCount,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    });

    // Estimate at the rates of the variant we explicitly requested — a
    // FAST run priced at base rates would understate the display estimate
    // ~4x relative to the authoritative bill (#357).
    const pricing = getCursorModelPricingForVariant(
      this.model,
      this.requestedServiceTier === ServiceTier.FAST ? "fast" : null,
    );
    this.estimatedCostUsd += computeTurnCost(
      pricing, input, output, cacheWrite, cacheRead,
    );
  }

  get hasTurns(): boolean {
    return this.turnCount > 0;
  }

  get modelName(): string {
    return this.model;
  }

  turns(): readonly TurnRecord[] {
    return this.turnRecords;
  }

  snapshot(): UsageSnapshot {
    if (this.turnCount === 0) return EMPTY_SNAPSHOT;

    return {
      inputTokens: BigInt(this.inputTokens),
      outputTokens: BigInt(this.outputTokens),
      cacheReadTokens: BigInt(this.cacheReadTokens),
      cacheWriteTokens: BigInt(this.cacheWriteTokens),
      // The Cursor SDK follows Anthropic's convention: inputTokens already
      // INCLUDES the cached portions (cacheReadTokens/cacheWriteTokens are
      // subsets of it, not additive). The true total throughput is therefore
      // inputTokens + outputTokens. Adding the cache buckets again would
      // double-count them and inflate the figure the Usage widget shows.
      totalTokens: BigInt(this.inputTokens + this.outputTokens),
      turnCount: this.turnCount,
      estimatedCostUsd: this.estimatedCostUsd,
      model: this.model,
      observedAt: this.observedAt,
      requestedServiceTier: this.requestedServiceTier,
      requestedModelParams: this.requestedModelParams,
    };
  }
}
