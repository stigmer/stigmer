"use client";

import { useCallback, useState } from "react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstanceInput } from "@stigmer/sdk";
import { useStigmer } from "../../hooks.js";
import { toError } from "../../internal/toError.js";

/** Return value of {@link useCreateWorkflowInstance}. */
export interface UseCreateWorkflowInstanceReturn {
  /** Submit a {@link WorkflowInstanceInput} to create a new WorkflowInstance. Resolves with the server-created resource. */
  readonly create: (input: WorkflowInstanceInput) => Promise<WorkflowInstance>;
  /** `true` while the create request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that creates a new WorkflowInstance resource.
 *
 * Wraps `stigmer.workflowInstance.create()` with loading/error state.
 * The caller is responsible for refreshing the instance list after
 * a successful create (e.g., via `refetch` from `useWorkflowInstances`).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateWorkflowInstance();
 *
 * const handleSubmit = async () => {
 *   const instance = await create({
 *     name: "prod-deploy",
 *     org: "my-org",
 *     workflowId: workflow.metadata.id,
 *     environmentRefs: [{ org: "my-org", slug: "aws-prod" }],
 *   });
 *   // instance created — refetch list
 * };
 * ```
 */
export function useCreateWorkflowInstance(): UseCreateWorkflowInstanceReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: WorkflowInstanceInput): Promise<WorkflowInstance> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.workflowInstance.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
