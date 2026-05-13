"use client";

import { create } from "@bufbuild/protobuf";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ListPendingApprovalsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { useFetch } from "../internal/useFetch";

export interface UsePendingApprovalsOptions {
  /** Organization slug. When empty, the hook does not fetch. */
  readonly org: string | null | undefined;
  /** Maximum results per page. @default 20 */
  readonly pageSize?: number;
  /** Refetch interval in milliseconds. `0` or `false` disables. @default 30000 */
  readonly refetchInterval?: number | false;
}

export interface UsePendingApprovalsReturn {
  readonly approvals: readonly PendingApproval[];
  readonly totalCount: number;
  readonly isLoading: boolean;
  readonly isRefetching: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

interface PendingApprovalsData {
  approvals: readonly PendingApproval[];
  totalCount: number;
}

const INITIAL_DATA: PendingApprovalsData = {
  approvals: [],
  totalCount: 0,
};

/**
 * Data hook that fetches pending human_input approvals for an organization.
 *
 * Returns workflow executions with active human_input tasks awaiting
 * reviewer decisions. Includes task name, requester, and timeout info.
 *
 * Auto-refreshes every 30 seconds by default since pending approvals
 * are time-sensitive.
 *
 * @example
 * ```tsx
 * const { approvals, totalCount, isLoading } = usePendingApprovals({
 *   org: "acme",
 * });
 * ```
 */
export function usePendingApprovals(
  options: UsePendingApprovalsOptions,
): UsePendingApprovalsReturn {
  const stigmer = useStigmer();
  const org = options.org ?? "";
  const pageSize = options.pageSize ?? 20;
  const refetchInterval = options.refetchInterval ?? 30_000;

  const fetchFn = org
    ? async () => {
        const resp = await stigmer.workflowExecution.listPendingApprovals(
          create(ListPendingApprovalsRequestSchema, { org, pageSize }),
        );
        return {
          approvals: [...resp.entries],
          totalCount: resp.totalCount,
        };
      }
    : null;

  const { data, isLoading, isRefetching, error, refetch } =
    useFetch<PendingApprovalsData>(
      fetchFn,
      [stigmer, org, pageSize],
      INITIAL_DATA,
      { refetchInterval: refetchInterval || false },
    );

  return {
    approvals: data.approvals,
    totalCount: data.totalCount,
    isLoading,
    isRefetching,
    error,
    refetch,
  };
}
