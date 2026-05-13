/**
 * Accumulates per-turn token usage from Cursor SDK onDelta callbacks.
 *
 * Designed for the empty {@code turn-ended} handler in execute-cursor.ts.
 * Each call to {@link addTurn} sums token counts and computes a running
 * estimated cost from the cursor-runner's local pricing table.
 *
 * The snapshot is written to {@code AgentExecutionStatus.runner_usage}
 * on every heartbeat, giving the UI real-time streaming visibility.
 *
 * Trust level: DISPLAY_ONLY. This data is runner-reported and must NOT
 * be used for billing. Billing-authoritative usage comes from the
 * server-side proxy or future Cursor Admin API reconciliation.
 */

import { getCursorModelPricing, computeTurnCost } from "./model-pricing.js";

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
};

export class UsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private turnCount = 0;
  private estimatedCostUsd = 0;
  private observedAt = "";

  constructor(private readonly model: string) {}

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

    const pricing = getCursorModelPricing(this.model);
    this.estimatedCostUsd += computeTurnCost(
      pricing, input, output, cacheWrite, cacheRead,
    );
  }

  get hasTurns(): boolean {
    return this.turnCount > 0;
  }

  snapshot(): UsageSnapshot {
    if (this.turnCount === 0) return EMPTY_SNAPSHOT;

    return {
      inputTokens: BigInt(this.inputTokens),
      outputTokens: BigInt(this.outputTokens),
      cacheReadTokens: BigInt(this.cacheReadTokens),
      cacheWriteTokens: BigInt(this.cacheWriteTokens),
      totalTokens: BigInt(
        this.inputTokens +
        this.outputTokens +
        this.cacheReadTokens +
        this.cacheWriteTokens),
      turnCount: this.turnCount,
      estimatedCostUsd: this.estimatedCostUsd,
      model: this.model,
      observedAt: this.observedAt,
    };
  }
}
