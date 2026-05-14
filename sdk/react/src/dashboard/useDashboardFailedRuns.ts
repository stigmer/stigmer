"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ExecutionPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ListAgentExecutionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ListWorkflowExecutionsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";
import type { DashboardFailedRun } from "./types";

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
 *
 * @since Unified Platform Dashboard
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
            const resp = await stigmer.agentExecution.list(
              create(ListAgentExecutionsRequestSchema, {
                pageSize: PAGE_SIZE,
                phase: AgentPhase.EXECUTION_FAILED,
              }),
            );
            return [...resp.entries] as readonly AgentExecution[];
          }
        : null,
    [stigmer, orgVal],
  );

  const workflowFetchFn = useMemo(
    () =>
      orgVal
        ? async () => {
            const resp = await stigmer.workflowExecution.list(
              create(ListWorkflowExecutionsRequestSchema, {
                pageSize: PAGE_SIZE,
                phase: WorkflowPhase.EXECUTION_FAILED,
              }),
            );
            return [...resp.entries] as readonly WorkflowExecution[];
          }
        : null,
    [stigmer, orgVal],
  );

  const { data: agentFailed, isLoading: agLoading, error: agError } =
    useFetch<readonly AgentExecution[]>(agentFetchFn, [stigmer, orgVal], [], {
      refetchInterval: 60_000,
    });

  const { data: workflowFailed, isLoading: wfLoading, error: wfError } =
    useFetch<readonly WorkflowExecution[]>(workflowFetchFn, [stigmer, orgVal], [], {
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
        resourceName: exec.spec?.agentId ?? "",
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
