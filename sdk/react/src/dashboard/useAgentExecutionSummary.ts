"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  AgentExecutionSummaryTimeWindow,
  GetAgentExecutionSummaryRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

export { AgentExecutionSummaryTimeWindow };

/** Options for {@link useAgentExecutionSummary}. */
export interface UseAgentExecutionSummaryOptions {
  /** Organization slug. When empty/null, the hook does not fetch. */
  readonly org: string | null | undefined;
  /** Time window for aggregation. @default LAST_7D */
  readonly timeWindow?: AgentExecutionSummaryTimeWindow;
  /** Refetch interval in milliseconds. `0` or `false` disables. @default 0 */
  readonly refetchInterval?: number | false;
}

/** Return value of {@link useAgentExecutionSummary}. */
export interface UseAgentExecutionSummaryReturn {
  readonly summary: AgentExecutionSummary | null;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches aggregated agent execution statistics for an
 * organization. Returns phase counts, active count, average duration,
 * and top failing agents.
 *
 * Cost is intentionally excluded from this response — the dashboard
 * sources cost from `useOrgUsageReport` (billing source of truth) to
 * prevent double-counting. See AD-DASH-005.
 *
 * @since Unified Platform Dashboard
 */
export function useAgentExecutionSummary(
  options: UseAgentExecutionSummaryOptions,
): UseAgentExecutionSummaryReturn {
  const stigmer = useStigmer();
  const org = options.org ?? "";
  const timeWindow =
    options.timeWindow ??
    AgentExecutionSummaryTimeWindow.LAST_7D;
  const refetchInterval = options.refetchInterval ?? 0;

  const fetchFn = org
    ? async () => {
        return await stigmer.agentExecution.getExecutionSummary(
          create(GetAgentExecutionSummaryRequestSchema, { org, timeWindow }),
        );
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<AgentExecutionSummary | null>(
      fetchFn,
      [stigmer, org, timeWindow],
      null,
      { refetchInterval: refetchInterval || false },
    );

  return { summary: data, isLoading, isRefetching, error, refetch };
}
