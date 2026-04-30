/**
 * Tracks Cursor SDK per-turn usage and produces Stigmer LlmCallMetrics protos.
 *
 * Follows the same per-message pattern as the Python agent-runner: each
 * turn produces an LlmCallMetrics proto that is stamped onto the
 * corresponding AgentMessage.llm_metrics field. Server-side aggregation
 * (usage_aggregation.go / UsageAggregationService.java) and the frontend
 * useSessionUsage hook walk those per-message metrics to compute totals.
 *
 * This module does NOT build aggregate UsageMetrics — that is a computed
 * projection done by downstream consumers.
 */

import { create } from "@bufbuild/protobuf";
import { LlmCallMetricsSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb.js";
import type { LlmCallMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb.js";
import { getCursorModelPricing, computeTurnCost } from "./model-pricing.js";

export interface CursorTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Records per-turn usage from Cursor SDK TurnEndedUpdate events and
 * produces LlmCallMetrics protos with pricing stamped at call time.
 *
 * Typical lifecycle:
 *
 *     const tracker = new UsageTracker("composer-2");
 *
 *     // In the onDelta callback when turn-ended fires:
 *     const metrics = tracker.recordTurn(usage);
 *     lastAiMessage.llmMetrics = metrics;
 */
export class UsageTracker {
  private sequence = 0;
  private cumulativeCostUsd = 0;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  /**
   * Record a single Cursor turn and return its LlmCallMetrics proto.
   *
   * The caller stamps the returned proto onto the most recent MESSAGE_AI
   * message's llm_metrics field — the single source of truth for cost data.
   */
  recordTurn(usage: CursorTurnUsage): LlmCallMetrics {
    this.sequence++;
    const pricing = getCursorModelPricing(this.model);

    const cost = computeTurnCost(
      pricing,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheWriteTokens,
      usage.cacheReadTokens,
    );
    this.cumulativeCostUsd += cost;

    const totalTokens =
      usage.inputTokens
      + usage.outputTokens
      + usage.cacheWriteTokens
      + usage.cacheReadTokens;

    const metrics = create(LlmCallMetricsSchema, {
      sequence: this.sequence,
      model: this.model,
      provider: "cursor",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheWriteTokens,
      cacheReadTokens: usage.cacheReadTokens,
      estimatedCostUsd: cost,
      durationMs: 0,
      timestamp: new Date().toISOString().replace("+00:00", "Z"),
      totalTokens,
    });

    console.log(
      "[COST] seq=%d model=%s input=%d output=%d cache_write=%d cache_read=%d cost=$%.6f cumulative=$%.6f",
      this.sequence,
      this.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheWriteTokens,
      usage.cacheReadTokens,
      cost,
      this.cumulativeCostUsd,
    );

    return metrics;
  }

  get estimatedCostUsd(): number {
    return this.cumulativeCostUsd;
  }

  get turnCount(): number {
    return this.sequence;
  }
}
