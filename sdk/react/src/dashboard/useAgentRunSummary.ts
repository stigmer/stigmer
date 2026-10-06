"use client";

import { create } from "@bufbuild/protobuf";
import type { AgentRunSummary } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import {
  AgentRunSummaryTimeWindow,
  GetAgentRunSummaryRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

export { AgentRunSummaryTimeWindow };

/** Options for {@link useAgentRunSummary}. */
export interface UseAgentRunSummaryOptions {
  /** Organization id (a slug is also accepted). When empty/null, the hook does not fetch. */
  readonly org: string | null | undefined;
  /** Time window for aggregation. @default LAST_7D */
  readonly timeWindow?: AgentRunSummaryTimeWindow;
  /** Refetch interval in milliseconds. `0` or `false` disables. @default 0 */
  readonly refetchInterval?: number | false;
}

/** Return value of {@link useAgentRunSummary}. */
export interface UseAgentRunSummaryReturn {
  readonly summary: AgentRunSummary | null;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook that fetches aggregated agent run statistics for an
 * organization. Returns phase counts, active count, average duration,
 * and top failing agents.
 *
 * Cost is intentionally excluded from this response — the dashboard
 * sources cost from `useOrgUsageReport` (billing source of truth), so
 * cost is never counted from two sources.
 */
export function useAgentRunSummary(
  options: UseAgentRunSummaryOptions,
): UseAgentRunSummaryReturn {
  const stigmer = useStigmer();
  const org = options.org ?? "";
  const timeWindow =
    options.timeWindow ??
    AgentRunSummaryTimeWindow.LAST_7D;
  const refetchInterval = options.refetchInterval ?? 0;

  const fetchFn = org
    ? async () => {
        return await stigmer.agentRun.getRunSummary(
          create(GetAgentRunSummaryRequestSchema, { org, timeWindow }),
        );
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<AgentRunSummary | null>(
      fetchFn,
      [stigmer, org, timeWindow],
      null,
      { refetchInterval: refetchInterval || false },
    );

  return { summary: data, isLoading, isRefetching, error, refetch };
}
