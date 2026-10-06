"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { ListAgentRunsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { DashboardFailedRun } from "./types.js";

const EPOCH = new Date(0);
const EMPTY: readonly DashboardFailedRun[] = [];
const PAGE_SIZE = 5;

/** Return value of {@link useDashboardFailedRuns}. */
export interface UseDashboardFailedRunsReturn {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Data hook that fetches an organization's recent failed agent runs,
 * normalizes them into {@link DashboardFailedRun} entries, and orders
 * them newest first.
 *
 * Returns at most 5 entries to keep the widget compact.
 */
export function useDashboardFailedRuns(
  org: string | null | undefined,
): UseDashboardFailedRunsReturn {
  const stigmer = useStigmer();
  const orgVal = org ?? "";

  const fetchFn = useMemo(
    () =>
      orgVal
        ? async () => {
            const resp = await stigmer.agentRun.list(
              create(ListAgentRunsRequestSchema, {
                pageSize: PAGE_SIZE,
                phase: RunPhase.RUN_FAILED,
                org: orgVal,
              }),
            );
            return [...resp.entries] as readonly AgentRun[];
          }
        : null,
    [stigmer, orgVal],
  );

  const { data: failed, isLoading, error } =
    useFetch<readonly AgentRun[]>(fetchFn, [stigmer, orgVal], [], {
      refetchInterval: 60_000,
    });

  const failedRuns = useMemo(() => {
    if (!failed.length) return EMPTY;

    const entries: DashboardFailedRun[] = failed.map((exec) => {
      const ts = exec.status?.audit?.specAudit?.createdAt;
      return {
        id: exec.metadata?.id ?? "",
        name: exec.metadata?.name || "Untitled run",
        error: exec.status?.error ?? "",
        failedAt: ts ? timestampDate(ts) : EPOCH,
        // The agent the turn ran, as the server recorded it.
        resourceName: exec.status?.agentId ?? "",
      };
    });

    entries.sort((a, b) => b.failedAt.getTime() - a.failedAt.getTime());
    return entries.slice(0, PAGE_SIZE);
  }, [failed]);

  return { failedRuns, isLoading, error };
}
