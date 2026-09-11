/**
 * The turn runtime's usage accounting: the priced deltas an adapter reports
 * through `TurnSink.reportUsage`, summed into the `streaming_usage` summary
 * the persist chokepoint writes before every status write, and the running
 * cost the `max_cost_usd` cap is enforced against.
 *
 * Who owns what (Q-S2-12): the ADAPTER prices, because only it has its
 * vendor's rate table and variant semantics (`execute-cursor/usage-pricing.ts`
 * for Cursor); the RUNTIME accounts and enforces, because the cap and the
 * summary are the platform's, the same for every engine. A delta therefore
 * arrives already priced, naming the basis it was priced against (`model`,
 * `requestedModelParams`), and this class adds — it never multiplies. The
 * tier and thinking mode it records are the runtime's own effective
 * preferences (`TurnInput.model`), the audit trail that the account default
 * was never left in control (#357, #772).
 *
 * Moved from `activities/execute-cursor/usage-accumulator.ts` at S2 M3, the
 * pricing call split out; the sums, the snapshot shape and the empty
 * snapshot are unchanged, so `streamingUsage` is byte-for-byte what the
 * Cursor orchestrator wrote.
 *
 * This data is display-only. The authoritative billing source is the BiDi
 * proxy, which records usage from the wire.
 */

import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { UsageDelta } from "./types.js";

export interface UsageSnapshot {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cacheReadTokens: bigint;
  readonly cacheWriteTokens: bigint;
  readonly totalTokens: bigint;
  readonly turnCount: number;
  readonly estimatedCostUsd: number;
  /** The basis the adapter last priced against (its catalog-validated model id); `""` until a delta names one. */
  readonly model: string;
  readonly observedAt: string;
  /** Tier the runner requested — always explicit post-translation (#357). */
  readonly requestedServiceTier: ServiceTier;
  /** JSON-encoded params the adapter sent with its model selection; "" when none. */
  readonly requestedModelParams: string;
  /** Thinking mode the runner requested — always explicit post-translation (#772). */
  readonly requestedThinkingMode: ThinkingMode;
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
  requestedThinkingMode: ThinkingMode.UNSPECIFIED,
};

export class UsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private turnCount = 0;
  private estimatedCostUsd = 0;
  private observedAt = "";
  private model = "";
  private requestedModelParams = "";

  constructor(
    /** The effective tier the runtime resolved (never UNSPECIFIED on a real turn; the default keeps the empty snapshot honest). */
    private readonly requestedServiceTier: ServiceTier = ServiceTier.UNSPECIFIED,
    /** The effective thinking mode the runtime resolved. Price-neutral (#772); recorded purely as the audit trail twin of the tier. */
    private readonly requestedThinkingMode: ThinkingMode = ThinkingMode.UNSPECIFIED,
  ) {}

  /** Add one priced delta. A delta without a basis inherits the previous one; a missing count is zero. */
  addTurn(delta: UsageDelta): void {
    this.inputTokens += delta.inputTokens ?? 0;
    this.outputTokens += delta.outputTokens ?? 0;
    this.cacheReadTokens += delta.cacheReadTokens ?? 0;
    this.cacheWriteTokens += delta.cacheWriteTokens ?? 0;
    this.estimatedCostUsd += delta.estimatedCostUsd ?? 0;
    if (delta.model !== undefined) this.model = delta.model;
    if (delta.requestedModelParams !== undefined) this.requestedModelParams = delta.requestedModelParams;
    this.turnCount++;
    this.observedAt = new Date().toISOString();
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
      requestedThinkingMode: this.requestedThinkingMode,
    };
  }
}
