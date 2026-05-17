"use client";

import { useMemo } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { resolvedSubject } from "@stigmer/sdk";
import { useSessionList } from "../session/useSessionList";
import { useWorkflowExecutionList } from "../workflow/useWorkflowExecutionList";
import type { RecentActivityEntry } from "./types";

/** Options for {@link useRecentActivity}. */
export interface UseRecentActivityOptions {
  /**
   * Maximum entries per source. The hook fetches up to `pageSize`
   * sessions and `pageSize` workflow executions, then merges and
   * trims to `pageSize` total entries.
   *
   * @default 30
   */
  readonly pageSize?: number;
}

/** Return value of {@link useRecentActivity}. */
export interface UseRecentActivityReturn {
  /** Merged entries sorted by `updatedAt` descending. */
  readonly entries: readonly RecentActivityEntry[];
  /** `true` while either source is loading for the first time. */
  readonly isLoading: boolean;
  /** First non-null error from either source. */
  readonly error: Error | null;
  /** Re-fetch both sources. */
  readonly refetch: () => void;
}

const DEFAULT_PAGE_SIZE = 30;
const EPOCH = new Date(0);

/**
 * Fetches recent agent sessions and workflow executions, merges them
 * into a single list sorted by most-recent-first, and exposes a
 * unified {@link RecentActivityEntry} array.
 *
 * Implementation uses client-side merge of two existing data hooks
 * (`useSessionList` and `useWorkflowExecutionList`), keeping the
 * backend contract unchanged. A dedicated `listRecentActivity` RPC
 * can replace this approach later without changing consumers.
 */
export function useRecentActivity(
  options?: UseRecentActivityOptions,
): UseRecentActivityReturn {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;

  const sessionResult = useSessionList({ pageSize });
  const executionResult = useWorkflowExecutionList({ pageSize });

  const entries = useMemo(
    () =>
      mergeAndSort(
        sessionResult.sessions,
        executionResult.executions,
        pageSize,
      ),
    [sessionResult.sessions, executionResult.executions, pageSize],
  );

  const isLoading = sessionResult.isLoading || executionResult.isLoading;
  const error = sessionResult.error ?? executionResult.error;

  const refetch = useMemo(() => {
    const sessionRefetch = sessionResult.refetch;
    const executionRefetch = executionResult.refetch;
    return () => {
      sessionRefetch();
      executionRefetch();
    };
  }, [sessionResult.refetch, executionResult.refetch]);

  return { entries, isLoading, error, refetch };
}

function mergeAndSort(
  sessions: readonly Session[],
  executions: readonly WorkflowExecution[],
  limit: number,
): readonly RecentActivityEntry[] {
  const sessionEntries = sessions.map(normalizeSession);
  const executionEntries = executions.map(normalizeExecution);

  const merged = [...sessionEntries, ...executionEntries];
  merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return merged.slice(0, limit);
}

function normalizeSession(session: Session): RecentActivityEntry {
  const id = session.metadata?.id ?? "";
  const rawSubject = session.spec?.subject;
  const subject = resolvedSubject(rawSubject) ?? "Untitled session";
  const ts = session.status?.audit?.specAudit?.createdAt;
  const updatedAt = ts ? timestampDate(ts) : EPOCH;

  return { id, type: "session", subject, updatedAt };
}

function normalizeExecution(
  execution: WorkflowExecution,
): RecentActivityEntry {
  const id = execution.metadata?.id ?? "";
  const subject = execution.metadata?.name || "Untitled execution";
  const ts = execution.status?.audit?.specAudit?.createdAt;
  const updatedAt = ts ? timestampDate(ts) : EPOCH;
  const status = execution.status?.phase !== undefined
    ? phaseLabel(execution.status.phase)
    : undefined;

  return { id, type: "workflow_execution", subject, updatedAt, status };
}

function phaseLabel(phase: number): string {
  switch (phase) {
    case 1: return "pending";
    case 2: return "running";
    case 3: return "completed";
    case 4: return "failed";
    case 5: return "cancelled";
    case 6: return "terminated";
    case 7: return "paused";
    default: return "unknown";
  }
}
