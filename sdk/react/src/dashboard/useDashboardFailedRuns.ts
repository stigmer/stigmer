"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { RunPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { ListAgentRunsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { ListWorkflowRunsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { DashboardFailedRun } from "./types.js";

const EPOCH = new Date(0);
const EMPTY: readonly DashboardFailedRun[] = [];
const MAX_TOTAL = 5;
const PAGE_SIZE = 5;

/** Return value of {@link useDashboardFailedRuns}. */
export interface UseDashboardFailedRunsReturn {
  readonly failedRuns: readonly DashboardFailedRun[];
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Composition hook that fetches recent failed executions from both
 * agent and workflow domains, normalizes them into {@link DashboardFailedRun}
 * entries, and interleaves them by timestamp (newest first).
 *
 * Returns at most 5 total entries to keep the widget compact.
 */
export function useDashboardFailedRuns(
  org: string | null | undefined,
): UseDashboardFailedRunsReturn {
  const stigmer = useStigmer();
  const orgVal = org ?? "";

  const agentFetchFn = useMemo(
    () =>
      orgVal
        ? async () => {
            const resp = await stigmer.agentRun.list(
              create(ListAgentRunsRequestSchema, {
                pageSize: PAGE_SIZE,
                phase: AgentPhase.RUN_FAILED,
                org: orgVal,
              }),
            );
            return [...resp.entries] as readonly AgentRun[];
          }
        : null,
    [stigmer, orgVal],
  );

  const workflowFetchFn = useMemo(
    () =>
      orgVal
        ? async () => {
            const resp = await stigmer.workflowRun.list(
              create(ListWorkflowRunsRequestSchema, {
                pageSize: PAGE_SIZE,
                phase: WorkflowPhase.RUN_FAILED,
                org: orgVal,
              }),
            );
            return [...resp.entries] as readonly WorkflowRun[];
          }
        : null,
    [stigmer, orgVal],
  );

  const { data: agentFailed, isLoading: agLoading, error: agError } =
    useFetch<readonly AgentRun[]>(agentFetchFn, [stigmer, orgVal], [], {
      refetchInterval: 60_000,
    });

  const { data: workflowFailed, isLoading: wfLoading, error: wfError } =
    useFetch<readonly WorkflowRun[]>(workflowFetchFn, [stigmer, orgVal], [], {
      refetchInterval: 60_000,
    });

  const failedRuns = useMemo(() => {
    if (!agentFailed.length && !workflowFailed.length) return EMPTY;

    const agentEntries: DashboardFailedRun[] = agentFailed.map((exec) => {
      const ts = exec.status?.audit?.specAudit?.createdAt;
      return {
        id: exec.metadata?.id ?? "",
        type: "agent_execution" as const,
        name: exec.metadata?.name || "Untitled execution",
        error: exec.status?.error ?? "",
        failedAt: ts ? timestampDate(ts) : EPOCH,
        // The agent the turn ran, as the server recorded it.
        resourceName: exec.status?.agentId ?? "",
      };
    });

    const workflowEntries: DashboardFailedRun[] = workflowFailed.map((exec) => {
      const ts = exec.status?.audit?.specAudit?.createdAt;
      return {
        id: exec.metadata?.id ?? "",
        type: "workflow_execution" as const,
        name: exec.metadata?.name || "Untitled execution",
        error: exec.status?.error ?? "",
        failedAt: ts ? timestampDate(ts) : EPOCH,
        resourceName: exec.metadata?.slug ?? "",
      };
    });

    const merged = [...agentEntries, ...workflowEntries];
    merged.sort((a, b) => b.failedAt.getTime() - a.failedAt.getTime());
    return merged.slice(0, MAX_TOTAL);
  }, [agentFailed, workflowFailed]);

  return {
    failedRuns,
    isLoading: agLoading || wfLoading,
    error: agError ?? wfError,
  };
}
