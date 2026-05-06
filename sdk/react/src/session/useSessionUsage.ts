"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

/**
 * Per-model cost breakdown.
 */
export interface ModelCostEntry {
  readonly model: string;
  readonly provider: string;
  readonly estimatedCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly callCount: number;
}

/** Return value of {@link useSessionUsage}. */
export interface UseSessionUsageReturn {
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly llmCallCount: number;
  readonly modelBreakdown: readonly ModelCostEntry[];
  readonly primaryModel: string;
  readonly primaryProvider: string;
  readonly hasUsage: boolean;
}

/**
 * Usage derivation hook for session-level cost and token aggregation.
 *
 * Usage data is now sourced from the {@code llm_call_usage_record} collection
 * (billing domain) via server-side usage report RPCs. This hook currently
 * returns empty data — real-time usage display will be rewired in a follow-up
 * to query a usage endpoint.
 *
 * The hook interface is preserved so existing consumers (UsageWidget,
 * SessionPage) continue to compile and render gracefully (hasUsage: false
 * causes the widget to render nothing).
 *
 * @param executions - All executions for a session (unused until rewired).
 */
export function useSessionUsage(
  executions: readonly AgentExecution[],
): UseSessionUsageReturn {
  return useMemo(
    () => ({
      totalCostUsd: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      llmCallCount: 0,
      modelBreakdown: [],
      primaryModel: "",
      primaryProvider: "",
      hasUsage: false,
    }),
    [executions],
  );
}
