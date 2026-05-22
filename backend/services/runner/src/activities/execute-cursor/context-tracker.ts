/**
 * Tracks approximate context window utilization for Cursor SDK sessions.
 *
 * The Cursor SDK does not expose ContextInfo or summarization events.
 * This tracker infers context state from per-turn input token counts
 * available in TurnEndedUpdate.usage:
 *
 * - inputTokens approximates the current context size (it includes the
 *   full prompt sent to the model for that turn)
 * - A significant drop in inputTokens between consecutive turns signals
 *   that Cursor internally summarized/compacted the context
 *
 * Confidence: LOW — all values are estimates. The ContextGauge UI renders
 * these with an "Estimated" badge to set user expectations.
 */

import { create } from "@bufbuild/protobuf";
import { ContextInfoSchema, SummarizationEventSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import type { ContextInfo } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import { SummarizationSource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const DROP_RATIO_THRESHOLD = 0.30;

/**
 * Well-known context window sizes for Cursor-supported models.
 * Used when the model registry doesn't provide contextWindowTokens.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-haiku": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4.1-nano": 1_047_576,
  "o3": 200_000,
  "o3-mini": 200_000,
  "o4-mini": 200_000,
  "gemini-2.5-pro": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "default": 200_000,
};

export function lookupContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? MODEL_CONTEXT_WINDOWS["default"];
}

export class ContextTracker {
  private readonly contextWindowLimit: number;
  private lastInputTokens = 0;
  private currentTokenCount = 0;
  private readonly detectedEvents: Array<{
    timestamp: string;
    tokensBefore: number;
    tokensAfter: number;
  }> = [];

  constructor(
    private readonly model: string,
    contextWindowLimit?: number,
  ) {
    this.contextWindowLimit = contextWindowLimit ?? lookupContextWindow(model);
  }

  /**
   * Record a turn's input token count. Detects summarization when
   * input tokens drop more than {@link DROP_RATIO_THRESHOLD} from the
   * previous turn.
   */
  recordTurn(inputTokens: number): void {
    if (inputTokens <= 0) return;

    if (
      this.lastInputTokens > 0 &&
      inputTokens < this.lastInputTokens * (1 - DROP_RATIO_THRESHOLD)
    ) {
      this.detectedEvents.push({
        timestamp: new Date().toISOString(),
        tokensBefore: this.lastInputTokens,
        tokensAfter: inputTokens,
      });
    }

    this.lastInputTokens = inputTokens;
    this.currentTokenCount = inputTokens;
  }

  get hasData(): boolean {
    return this.currentTokenCount > 0;
  }

  /**
   * Build a ContextInfo proto snapshot with approximate values.
   *
   * Summarization thresholds are set to 0 because we don't know
   * Cursor's internal configuration. summarizationEnabled is true
   * because Cursor manages context internally.
   */
  snapshot(): ContextInfo {
    const info = create(ContextInfoSchema, {
      currentTokenCount: this.currentTokenCount,
      contextWindowLimit: this.contextWindowLimit,
      summarizationTriggerThreshold: 0,
      summarizationTargetTokens: 0,
      summarizationEnabled: true,
      utilizationPercent:
        this.contextWindowLimit > 0
          ? (this.currentTokenCount / this.contextWindowLimit) * 100
          : 0,
    });

    for (const evt of this.detectedEvents) {
      const ratio = 1 - evt.tokensAfter / evt.tokensBefore;
      info.summarizationEvents.push(
        create(SummarizationEventSchema, {
          timestamp: evt.timestamp,
          tokensBefore: evt.tokensBefore,
          tokensAfter: evt.tokensAfter,
          compressionRatio: ratio,
          durationMs: 0,
          summarizationModel: "",
          messagesBefore: 0,
          messagesAfter: 0,
          source: SummarizationSource.SUMMARIZATION_SOURCE_UNSPECIFIED,
          summarizationInputTokens: 0,
          summarizationOutputTokens: 0,
          summarizationCostUsd: 0,
        }),
      );
    }

    return info;
  }
}
