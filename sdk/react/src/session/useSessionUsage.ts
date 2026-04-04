"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { LlmCallMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";

/**
 * Per-model cost breakdown computed from per-message {@link LlmCallMetrics}.
 */
export interface ModelCostEntry {
  /** Model identifier (e.g., `"claude-3-5-sonnet-20241022"`). */
  readonly model: string;
  /** Provider that served the model (e.g., `"anthropic"`). */
  readonly provider: string;
  /** Estimated cost in USD for all calls to this model. */
  readonly estimatedCostUsd: number;
  /** Total non-cached input tokens across all calls to this model. */
  readonly inputTokens: number;
  /** Total output tokens across all calls to this model. */
  readonly outputTokens: number;
  /** Total cache creation tokens across all calls to this model. */
  readonly cacheCreationTokens: number;
  /** Total cache read tokens across all calls to this model. */
  readonly cacheReadTokens: number;
  /** Number of LLM calls made to this model. */
  readonly callCount: number;
}

/** Return value of {@link useSessionUsage}. */
export interface UseSessionUsageReturn {
  /** Total estimated cost across all executions in the session. */
  readonly totalCostUsd: number;
  /** Total tokens (all types) across all executions. */
  readonly totalTokens: number;
  /** Total input tokens (non-cached) across all executions. */
  readonly inputTokens: number;
  /** Total output tokens across all executions. */
  readonly outputTokens: number;
  /** Total cache read tokens across all executions. */
  readonly cacheReadTokens: number;
  /** Total cache creation tokens across all executions. */
  readonly cacheCreationTokens: number;
  /** Total number of LLM calls across all executions. */
  readonly llmCallCount: number;
  /** Per-model breakdown, sorted by cost descending. */
  readonly modelBreakdown: readonly ModelCostEntry[];
  /** Primary model (first model encountered). */
  readonly primaryModel: string;
  /** Primary provider (first provider encountered). */
  readonly primaryProvider: string;
  /** `true` when at least one execution has cost data. */
  readonly hasUsage: boolean;
}

/**
 * Pure derivation hook that aggregates usage data across all executions
 * in a session from per-message {@link LlmCallMetrics}.
 *
 * Follows the same pattern as {@link useSessionArtifacts} and
 * {@link useSessionWriteBacks}: `useMemo`-based derivation, no side
 * effects, no data fetching. Takes the same `executions` array input.
 *
 * Per-message `llm_metrics` on `AgentMessage` (type == MESSAGE_AI) is
 * the single source of truth for cost data. This hook walks all messages
 * (main agent + sub-agents) across all executions and sums the fields.
 *
 * @param executions - All executions for a session, in chronological
 *   order. Pass both completed and active-stream executions.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * const allExecutions = [
 *   ...conv.completedExecutions,
 *   ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 * ];
 * const { totalCostUsd, totalTokens, hasUsage } = useSessionUsage(allExecutions);
 * ```
 */
export function useSessionUsage(
  executions: readonly AgentExecution[],
): UseSessionUsageReturn {
  return useMemo(() => {
    let totalCostUsd = 0;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let llmCallCount = 0;
    let primaryModel = "";
    let primaryProvider = "";
    const modelMap = new Map<string, ModelCostEntry>();

    const processMessage = (msg: { type: MessageType; llmMetrics?: LlmCallMetrics }) => {
      const m = msg.llmMetrics;
      if (!m) return;

      totalCostUsd += m.estimatedCostUsd;
      totalTokens += m.totalTokens;
      inputTokens += m.inputTokens;
      outputTokens += m.outputTokens;
      cacheReadTokens += m.cacheReadTokens;
      cacheCreationTokens += m.cacheCreationTokens;
      llmCallCount++;

      if (!primaryModel && m.model) {
        primaryModel = m.model;
        primaryProvider = m.provider;
      }

      const key = `${m.model}\0${m.provider}`;
      const existing = modelMap.get(key);
      if (existing) {
        modelMap.set(key, {
          ...existing,
          estimatedCostUsd: existing.estimatedCostUsd + m.estimatedCostUsd,
          inputTokens: existing.inputTokens + m.inputTokens,
          outputTokens: existing.outputTokens + m.outputTokens,
          cacheCreationTokens: existing.cacheCreationTokens + m.cacheCreationTokens,
          cacheReadTokens: existing.cacheReadTokens + m.cacheReadTokens,
          callCount: existing.callCount + 1,
        });
      } else {
        modelMap.set(key, {
          model: m.model,
          provider: m.provider,
          estimatedCostUsd: m.estimatedCostUsd,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheCreationTokens: m.cacheCreationTokens,
          cacheReadTokens: m.cacheReadTokens,
          callCount: 1,
        });
      }
    };

    for (const execution of executions) {
      for (const msg of execution.status?.messages ?? []) {
        processMessage(msg);
      }
      for (const sub of execution.status?.subAgentExecutions ?? []) {
        for (const msg of sub.messages) {
          processMessage(msg);
        }
      }
    }

    const modelBreakdown = Array.from(modelMap.values()).sort(
      (a, b) => b.estimatedCostUsd - a.estimatedCostUsd,
    );

    return {
      totalCostUsd,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      llmCallCount,
      modelBreakdown,
      primaryModel,
      primaryProvider,
      hasUsage: llmCallCount > 0,
    };
  }, [executions]);
}
