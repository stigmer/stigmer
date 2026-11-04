"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

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
 * lifecycle grounds — and is the revocation mechanism for
 * confirmed facts: the fact stops reaching future sessions immediately.
 * Past runs keep their immutable recall snapshots.
 *
 * @example
 * ```tsx
 * import type { Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
 *
 * function ForgetMemory({ memory, onDeleted }: { memory: Memory; onDeleted: () => void }) {
 *   const { deleteMemory, isDeleting } = useDeleteMemory();
 *   const forget = async () => {
 *     await deleteMemory(memory.metadata?.id ?? "");
 *     onDeleted(); // refresh the list after deletion
 *   };
 *   return <button onClick={forget} disabled={isDeleting}>Forget</button>;
 * }
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
