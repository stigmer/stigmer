/**
 * Maps Cursor SDK TurnEndedUpdate usage data to Stigmer UsageMetrics protos.
 *
 * Cursor reports token usage per turn via the TurnEndedUpdate.usage field
 * in the onDelta callback. This module accumulates those deltas into the
 * Stigmer UsageMetrics structure for the execution status.
 */

import { create } from "@bufbuild/protobuf";
import { UsageMetricsSchema, ModelUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb.js";
import type { UsageMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb.js";

interface CursorTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Tracks accumulated usage across all turns in a Cursor Run and produces
 * a Stigmer UsageMetrics proto for the execution status.
 */
export class UsageTracker {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheReadTokens = 0;
  private totalCacheWriteTokens = 0;
  private turnCount = 0;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  recordTurn(usage: CursorTurnUsage): void {
    this.turnCount++;
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.totalCacheReadTokens += usage.cacheReadTokens;
    this.totalCacheWriteTokens += usage.cacheWriteTokens;
  }

  toUsageMetrics(): UsageMetrics {
    const promptTokens = this.totalInputTokens + this.totalCacheReadTokens + this.totalCacheWriteTokens;
    const totalTokens = promptTokens + this.totalOutputTokens;

    return create(UsageMetricsSchema, {
      promptTokens,
      completionTokens: this.totalOutputTokens,
      totalTokens,
      llmCallCount: this.turnCount,
      primaryModel: this.model,
      primaryProvider: "cursor",
      cacheCreationTokens: this.totalCacheWriteTokens,
      cacheReadTokens: this.totalCacheReadTokens,
      modelBreakdown: [
        create(ModelUsageSchema, {
          model: this.model,
          provider: "cursor",
          inputTokens: this.totalInputTokens,
          outputTokens: this.totalOutputTokens,
          cacheCreationTokens: this.totalCacheWriteTokens,
          cacheReadTokens: this.totalCacheReadTokens,
          callCount: this.turnCount,
        }),
      ],
    });
  }
}
