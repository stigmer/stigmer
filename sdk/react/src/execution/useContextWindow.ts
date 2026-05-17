"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { SummarizationEvent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";

/**
 * Context window health state derived from utilization percentage.
 *
 * Matches the thresholds documented in context.proto (ContextInfo.utilization_percent):
 * - 0-70%:  healthy (green)
 * - 70-90%: warning (yellow, approaching summarization threshold)
 * - 90%+:   critical (red, at or above trigger threshold)
 */
export type ContextHealth = "healthy" | "warning" | "critical";

/** Normalized view of a single summarization event for rendering. */
export interface SummarizationEventView {
  readonly timestamp: string;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly compressionRatio: number;
  readonly durationMs: number;
  readonly model: string;
  readonly messagesBefore: number;
  readonly messagesAfter: number;
  readonly costUsd: number;
}

/** Return value of {@link useContextWindow}. */
export interface UseContextWindowReturn {
  /** `true` when real `ContextInfo` data is available (native harness). */
  readonly hasContextInfo: boolean;
  /** Current token count in the context window. 0 when unavailable. */
  readonly currentTokenCount: number;
  /** Model's maximum context window size in tokens. 0 when unavailable. */
  readonly contextWindowLimit: number;
  /** Context utilization as a percentage (0-100). 0 when unavailable. */
  readonly utilizationPercent: number;
  /** Token threshold that triggers summarization. 0 when unavailable. */
  readonly triggerThreshold: number;
  /** Target token count after summarization. 0 when unavailable. */
  readonly targetTokens: number;
  /** Whether automatic summarization is enabled for this execution. */
  readonly summarizationEnabled: boolean;
  /** Summarization events ordered chronologically (oldest first). */
  readonly summarizationEvents: readonly SummarizationEventView[];
  /** Derived health state based on utilization thresholds. */
  readonly health: ContextHealth;
  /** `true` when utilization is within 5% of the trigger threshold. */
  readonly isNearThreshold: boolean;
}

const HEALTHY_CEILING = 70;
const WARNING_CEILING = 90;
const NEAR_THRESHOLD_MARGIN = 5;

const EMPTY: UseContextWindowReturn = {
  hasContextInfo: false,
  currentTokenCount: 0,
  contextWindowLimit: 0,
  utilizationPercent: 0,
  triggerThreshold: 0,
  targetTokens: 0,
  summarizationEnabled: false,
  summarizationEvents: [],
  health: "healthy",
  isNearThreshold: false,
};

function deriveHealth(utilization: number): ContextHealth {
  if (utilization >= WARNING_CEILING) return "critical";
  if (utilization >= HEALTHY_CEILING) return "warning";
  return "healthy";
}

function mapEvent(e: SummarizationEvent): SummarizationEventView {
  return {
    timestamp: e.timestamp,
    tokensBefore: e.tokensBefore,
    tokensAfter: e.tokensAfter,
    compressionRatio: e.compressionRatio,
    durationMs: e.durationMs,
    model: e.summarizationModel,
    messagesBefore: e.messagesBefore,
    messagesAfter: e.messagesAfter,
    costUsd: e.summarizationCostUsd,
  };
}

/**
 * Extracts context window information from an execution's status.
 *
 * Provides real-time visibility into context utilization, summarization
 * thresholds, and summarization history for the native harness. Returns
 * a stable empty state when `ContextInfo` is absent (e.g., Cursor harness
 * where context is managed externally).
 *
 * The derived `health` and `isNearThreshold` fields are intended for
 * driving visual indicators (gauge color, alert badges) without coupling
 * rendering components to threshold arithmetic.
 *
 * @param execution - The execution snapshot from `useExecutionStream`, or `null`.
 *
 * @example
 * ```tsx
 * const { execution } = useExecutionStream(executionId);
 * const ctx = useContextWindow(execution);
 *
 * if (ctx.hasContextInfo) {
 *   return <ContextGauge {...ctx} />;
 * }
 * ```
 */
export function useContextWindow(
  execution: AgentExecution | null,
): UseContextWindowReturn {
  const contextInfo = execution?.status?.contextInfo ?? null;

  const events = useMemo(() => {
    if (!contextInfo?.summarizationEvents?.length) return [];
    return contextInfo.summarizationEvents.map(mapEvent);
  }, [contextInfo?.summarizationEvents]);

  return useMemo((): UseContextWindowReturn => {
    if (!contextInfo || contextInfo.contextWindowLimit === 0) return EMPTY;

    const utilization = contextInfo.utilizationPercent;
    const trigger = contextInfo.summarizationTriggerThreshold;
    const triggerPercent =
      trigger > 0 && contextInfo.contextWindowLimit > 0
        ? (trigger / contextInfo.contextWindowLimit) * 100
        : WARNING_CEILING;

    return {
      hasContextInfo: true,
      currentTokenCount: contextInfo.currentTokenCount,
      contextWindowLimit: contextInfo.contextWindowLimit,
      utilizationPercent: utilization,
      triggerThreshold: trigger,
      targetTokens: contextInfo.summarizationTargetTokens,
      summarizationEnabled: contextInfo.summarizationEnabled,
      summarizationEvents: events,
      health: deriveHealth(utilization),
      isNearThreshold: utilization >= triggerPercent - NEAR_THRESHOLD_MARGIN,
    };
  }, [contextInfo, events]);
}
