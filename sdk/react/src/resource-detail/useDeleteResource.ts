"use client";

import { useCallback, useMemo, useState } from "react";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import { toast } from "../feedback/toast";

/** Resource types that support deletion from detail pages. */
export type DeletableResourceKind = "agent" | "skill" | "mcpServer" | "workflow";

export interface UseDeleteResourceReturn {
  /**
   * Delete the resource. Resolves on success, rejects on failure.
   * Shows a success toast on completion and an error toast on failure.
   */
  readonly deleteResource: () => Promise<void>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Mutation hook for deleting a resource from its detail page.
 *
 * Wraps the type-specific delete RPC with loading state, toast
 * feedback, and error handling. The `resourceId` may be `null`
 * when the resource hasn't loaded yet — `deleteResource` becomes
 * a no-op in that case.
 *
 * @example
 * ```tsx
 * const { deleteResource, isDeleting } = useDeleteResource(
 *   "agent",
 *   resourceId,
 *   "PR Review Agent",
 * );
 *
 * const handleDelete = async () => {
 *   const confirmed = await confirm({ ... });
 *   if (confirmed) {
 *     await deleteResource();
 *     router.push("/library/agents");
 *   }
 * };
 * ```
 */
export function useDeleteResource(
  kind: DeletableResourceKind,
  resourceId: string | null,
  resourceName?: string,
): UseDeleteResourceReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const deleteResource = useCallback(async () => {
    if (!resourceId) return;

    setIsDeleting(true);
    setError(null);

    try {
      switch (kind) {
        case "agent":
          await stigmer.agent.delete(resourceId);
          break;
        case "skill":
          await stigmer.skill.delete(resourceId);
          break;
        case "mcpServer":
          await stigmer.mcpServer.delete({ resourceId });
          break;
        case "workflow":
          await stigmer.workflow.delete(resourceId);
          break;
      }
      toast.success(
        resourceName
          ? `${resourceName} deleted`
          : `${kindLabel(kind)} deleted`,
      );
    } catch (err) {
      const wrapped = toError(err);
      setError(wrapped);
      toast.error(`Failed to delete ${kindLabel(kind)}`);
      throw wrapped;
    } finally {
      setIsDeleting(false);
    }
  }, [stigmer, kind, resourceId, resourceName]);

  return useMemo(
    () => ({ deleteResource, isDeleting, error }),
    [deleteResource, isDeleting, error],
  );
}

function kindLabel(kind: DeletableResourceKind): string {
  switch (kind) {
    case "agent":
      return "agent";
    case "skill":
      return "skill";
    case "mcpServer":
      return "MCP server";
    case "workflow":
      return "workflow";
  }
}
