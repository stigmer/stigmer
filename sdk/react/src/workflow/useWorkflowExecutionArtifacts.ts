"use client";

import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { ListArtifactsByExecutionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useWorkflowExecutionArtifacts}. */
export interface UseWorkflowExecutionArtifactsReturn {
  /** Artifacts produced by this execution. */
  readonly artifacts: readonly Artifact[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches artifacts produced by a workflow execution.
 *
 * Pass `null` for `executionId` to skip fetching.
 *
 * @example
 * ```tsx
 * const { artifacts, isLoading } = useWorkflowExecutionArtifacts(executionId);
 * ```
 */
export function useWorkflowExecutionArtifacts(
  executionId: string | null,
): UseWorkflowExecutionArtifactsReturn {
  const stigmer = useStigmer();

  const fetchFn = executionId
    ? async () => {
        const resp = await stigmer.artifact.listByExecution(
          create(ListArtifactsByExecutionRequestSchema, {
            workflowExecutionId: executionId,
          }),
        );
        return [...resp.entries];
      }
    : null;

  const { data: artifacts, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [executionId, stigmer],
    [] as readonly Artifact[],
    { cacheKey: executionId ? `workflow-execution-artifacts:${executionId}` : undefined },
  );

  return { artifacts, isLoading, isRefetching, error, refetch };
}
