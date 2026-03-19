"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  UsageMetrics,
  ModelUsage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import {
  UsageMetricsSchema,
  ModelUsageSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";

export interface UseExecutionUsageReturn {
  /** Aggregated usage (main agent + sub-agents). Null before usage data arrives. */
  readonly usage: UsageMetrics | null;
  /** Whether any sub-agent contributed usage to the aggregated total. */
  readonly hasSubAgentUsage: boolean;
  /** Count of sub-agents that have non-null usage data. */
  readonly subAgentUsageCount: number;
}

/**
 * Pure derivation hook that aggregates {@link UsageMetrics} across the
 * main agent and all sub-agents into a single {@link UsageMetrics} total.
 *
 * The proto scoping rule is:
 * > `status.usage` = main agent's direct LLM usage (excludes sub-agents)
 * > `subAgentExecutions[].usage` = each sub-agent's LLM usage
 * > Total cost = `status.usage` + sum(`subAgentExecutions[].usage`)
 *
 * This hook performs that summation, merges `modelBreakdown` entries by
 * `model+provider` key, and concatenates `llmCalls` sorted by timestamp.
 *
 * Returns `null` when the execution is absent or usage data has not yet
 * arrived from the agent runner.
 *
 * @example
 * ```tsx
 * const { execution } = useExecutionStream(executionId);
 * const { usage, hasSubAgentUsage } = useExecutionUsage(execution);
 *
 * if (usage) {
 *   console.log(`Cost: $${usage.estimatedCostUsd}`);
 *   console.log(`Tokens: ${usage.totalTokens}`);
 * }
 * ```
 */
export function useExecutionUsage(
  execution: AgentExecution | null,
): UseExecutionUsageReturn {
  return useMemo(() => {
    const usage = aggregateUsage(execution);

    if (!usage) {
      return { usage: null, hasSubAgentUsage: false, subAgentUsageCount: 0 };
    }

    const subAgents = execution?.status?.subAgentExecutions ?? [];
    let subAgentUsageCount = 0;
    for (const sub of subAgents) {
      if (sub.usage) subAgentUsageCount++;
    }

    return {
      usage,
      hasSubAgentUsage: subAgentUsageCount > 0,
      subAgentUsageCount,
    };
  }, [execution]);
}

// ---------------------------------------------------------------------------
// Pure aggregation function — testable without React
// ---------------------------------------------------------------------------

/**
 * Aggregates usage metrics from the main agent and all sub-agents into
 * a single {@link UsageMetrics} proto object.
 *
 * Returns `null` when the execution or its usage data is not yet available.
 */
export function aggregateUsage(
  execution: AgentExecution | null,
): UsageMetrics | null {
  const mainUsage = execution?.status?.usage;
  if (!mainUsage) return null;

  const subAgents = execution?.status?.subAgentExecutions ?? [];
  const subUsages: UsageMetrics[] = [];
  for (const sub of subAgents) {
    if (sub.usage) subUsages.push(sub.usage);
  }

  if (subUsages.length === 0) return mainUsage;

  const allUsages = [mainUsage, ...subUsages];

  return create(UsageMetricsSchema, {
    promptTokens: sumField(allUsages, "promptTokens"),
    completionTokens: sumField(allUsages, "completionTokens"),
    totalTokens: sumField(allUsages, "totalTokens"),
    llmCallCount: sumField(allUsages, "llmCallCount"),
    cacheCreationTokens: sumField(allUsages, "cacheCreationTokens"),
    cacheReadTokens: sumField(allUsages, "cacheReadTokens"),
    estimatedCostUsd: sumField(allUsages, "estimatedCostUsd"),
    totalDurationMs: sumField(allUsages, "totalDurationMs"),
    llmDurationMs: sumField(allUsages, "llmDurationMs"),
    toolDurationMs: sumField(allUsages, "toolDurationMs"),
    approvalWaitDurationMs: sumField(allUsages, "approvalWaitDurationMs"),
    toolResultCharsTruncated: sumBigIntField(allUsages),
    primaryModel: mainUsage.primaryModel,
    primaryProvider: mainUsage.primaryProvider,
    modelBreakdown: mergeModelBreakdowns(allUsages),
    llmCalls: mergeLlmCalls(allUsages),
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type NumericField = keyof {
  [K in keyof UsageMetrics as UsageMetrics[K] extends number ? K : never]: true;
};

function sumField(usages: UsageMetrics[], field: NumericField): number {
  let total = 0;
  for (const u of usages) {
    total += u[field] as number;
  }
  return total;
}

function sumBigIntField(usages: UsageMetrics[]): bigint {
  let total = BigInt(0);
  for (const u of usages) {
    total += u.toolResultCharsTruncated;
  }
  return total;
}

/**
 * Merges model breakdown entries across all usages by `model+provider` key.
 * Entries for the same model and provider are combined into a single
 * {@link ModelUsage} with summed numeric fields. Pricing rates are taken
 * from the first entry encountered for each key (rates are stamped at
 * execution time and are identical for the same model).
 */
function mergeModelBreakdowns(usages: UsageMetrics[]): ModelUsage[] {
  const merged = new Map<
    string,
    {
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      callCount: number;
      estimatedCostUsd: number;
      inputPricePerMillion: number;
      outputPricePerMillion: number;
      cacheCreationPricePerMillion: number;
      cacheReadPricePerMillion: number;
    }
  >();

  for (const usage of usages) {
    for (const entry of usage.modelBreakdown) {
      const key = `${entry.model}\0${entry.provider}`;
      const existing = merged.get(key);

      if (existing) {
        existing.inputTokens += entry.inputTokens;
        existing.outputTokens += entry.outputTokens;
        existing.cacheCreationTokens += entry.cacheCreationTokens;
        existing.cacheReadTokens += entry.cacheReadTokens;
        existing.callCount += entry.callCount;
        existing.estimatedCostUsd += entry.estimatedCostUsd;
      } else {
        merged.set(key, {
          model: entry.model,
          provider: entry.provider,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheCreationTokens: entry.cacheCreationTokens,
          cacheReadTokens: entry.cacheReadTokens,
          callCount: entry.callCount,
          estimatedCostUsd: entry.estimatedCostUsd,
          inputPricePerMillion: entry.inputPricePerMillion,
          outputPricePerMillion: entry.outputPricePerMillion,
          cacheCreationPricePerMillion: entry.cacheCreationPricePerMillion,
          cacheReadPricePerMillion: entry.cacheReadPricePerMillion,
        });
      }
    }
  }

  return Array.from(merged.values()).map((m) => create(ModelUsageSchema, m));
}

/**
 * Concatenates `llmCalls` from all usages, sorted by ISO 8601 timestamp.
 * This gives a globally chronological view across main agent and sub-agents,
 * since per-agent `sequence` numbers overlap.
 */
function mergeLlmCalls(usages: UsageMetrics[]): UsageMetrics["llmCalls"] {
  const all = usages.flatMap((u) => u.llmCalls);
  if (all.length <= 1) return all;
  return all.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
