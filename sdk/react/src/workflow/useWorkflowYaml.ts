"use client";

import { useMemo } from "react";
import { useWorkflow } from "./useWorkflow";
import { serializeWorkflowYaml } from "./serialize-workflow-yaml";

/** Return value of {@link useWorkflowYaml}. */
export interface UseWorkflowYamlReturn {
  /** The workflow resource serialized as canonical YAML, or `null` while loading. */
  readonly yaml: string | null;
  /** `true` while the workflow is being fetched. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** The resource ID (needed for the save/update path). */
  readonly workflowId: string | null;
  /** Discard cached data and re-fetch the workflow from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a Workflow and returns its YAML representation.
 *
 * Composes {@link useWorkflow} with {@link serializeWorkflowYaml} to
 * provide a memoized YAML string ready for editor rendering.
 *
 * @param org - Organization slug, or `null` to skip fetching.
 * @param slug - Workflow slug, or `null` to skip fetching.
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function useWorkflowYaml(
  org: string | null,
  slug: string | null,
): UseWorkflowYamlReturn {
  const { workflow, isLoading, error, refetch } = useWorkflow(org, slug);

  const yaml = useMemo<string | null>(() => {
    if (!workflow) return null;
    return serializeWorkflowYaml(workflow);
  }, [workflow]);

  const workflowId = workflow?.metadata?.id ?? null;

  return useMemo(
    () => ({ yaml, isLoading, error, workflowId, refetch }),
    [yaml, isLoading, error, workflowId, refetch],
  );
}
