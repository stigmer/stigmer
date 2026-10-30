"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/apis/ai/stigmer/agentic/memory/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useUpdateMemoryContent}. */
export interface UseUpdateMemoryContentReturn {
  /** Replace a memory's fact text. Resolves with the updated record. */
  readonly updateContent: (memory: Memory, content: string) => Promise<Memory>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that edits a memory's fact text — the one field the
 * subject owns after capture.
 *
 * The update names `spec.content` alone, on the record as loaded (its id
 * and the etag it was read at): subject, provenance and the consent
 * lifecycle keep their stored values, and a memory changed since it was
 * read refuses the save (ABORTED, reason `ETAG_MISMATCH`).
 *
 * @example
 * ```tsx
 * const { updateContent, isUpdating } = useUpdateMemoryContent();
 *
 * await updateContent(memory, editedText);
 * refetch(); // refresh the list after the edit
 * ```
 */
export function useUpdateMemoryContent(): UseUpdateMemoryContentReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateContent = useCallback(
    async (memory: Memory, content: string): Promise<Memory> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.memory.update(
          {
            metadata: { id: memory.metadata?.id ?? "", etag: memory.metadata?.etag ?? "" },
            spec: { content },
          },
          ["spec.content"],
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { updateContent, isUpdating, error, clearError };
}
