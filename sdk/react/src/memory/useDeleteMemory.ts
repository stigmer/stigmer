"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useDeleteMemory}. */
export interface UseDeleteMemoryReturn {
  /** Delete a memory by its resource ID, in any lifecycle state. Resolves with the deleted record. */
  readonly deleteMemory: (id: string) => Promise<Memory>;
  /** `true` while the delete request is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `memory.delete()`.
 *
 * Deletion works in any lifecycle state — it is never refused on
 * lifecycle grounds (DD-004) — and is the revocation mechanism for
 * confirmed facts: the fact stops reaching future sessions immediately.
 * Past executions keep their immutable recall snapshots.
 *
 * @example
 * ```tsx
 * const { deleteMemory, isDeleting, error } = useDeleteMemory();
 *
 * await deleteMemory(memory.metadata?.id ?? "");
 * refetch(); // refresh the list after deletion
 * ```
 */
export function useDeleteMemory(): UseDeleteMemoryReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteMemory = useCallback(
    async (id: string): Promise<Memory> => {
      setIsDeleting(true);
      setError(null);

      try {
        return await stigmer.memory.delete(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteMemory, isDeleting, error, clearError };
}
