"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  GetSessionUsageReportInputSchema,
  type GetSessionUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { ModelUsage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

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

const EMPTY: UseSessionUsageReturn = {
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
};

function microsToUsd(micros: bigint): number {
  return Number(micros) / 1_000_000;
}

function mapModelUsage(m: ModelUsage): ModelCostEntry {
  return {
    model: m.model,
    provider: m.provider,
    estimatedCostUsd: microsToUsd(m.billableCostMicros),
    inputTokens: Number(m.inputTokens),
    outputTokens: Number(m.outputTokens),
    cacheCreationTokens: Number(m.cacheCreationInputTokens),
    cacheReadTokens: Number(m.cacheReadInputTokens),
    callCount: m.callCount,
  };
}

function mapReport(report: GetSessionUsageReportOutput): UseSessionUsageReturn {
  const agg = report.totalUsage;
  if (!agg) return EMPTY;

  return {
    totalCostUsd: microsToUsd(agg.billableCostMicros),
    totalTokens: Number(agg.totalTokens),
    inputTokens: Number(agg.inputTokens),
    outputTokens: Number(agg.outputTokens),
    cacheReadTokens: Number(agg.cacheReadInputTokens),
    cacheCreationTokens: Number(agg.cacheCreationInputTokens),
    llmCallCount: agg.llmCallCount,
    modelBreakdown: report.modelBreakdown.map(mapModelUsage),
    primaryModel: agg.primaryModel,
    primaryProvider: agg.primaryProvider,
    hasUsage: true,
  };
}

/**
 * Usage hook for session-level cost and token aggregation.
 *
 * Calls `getSessionUsageReport` to fetch real usage data from the
 * billing domain. Returns zeros while loading or when no session is
 * available.
 *
 * @param executions - All executions for a session (used to derive session ID).
 */
export function useSessionUsage(
  executions: readonly AgentExecution[],
): UseSessionUsageReturn {
  const stigmer = useStigmer();

  const sessionId = useMemo(
    () => executions[0]?.spec?.sessionId ?? null,
    [executions],
  );

  const { data: report } = useFetch(
    sessionId
      ? () =>
          stigmer.agentExecution.getSessionUsageReport(
            create(GetSessionUsageReportInputSchema, { sessionId }),
          )
      : null,
    [sessionId, stigmer],
    null as GetSessionUsageReportOutput | null,
    { cacheKey: sessionId ? `session-usage:${sessionId}` : undefined },
  );

  return useMemo(() => {
    if (!report) return EMPTY;
    return mapReport(report);
  }, [report]);
}
