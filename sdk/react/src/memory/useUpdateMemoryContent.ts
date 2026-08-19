"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { toMemoryUpdateInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

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
 * subject owns after capture (DD-004).
 *
 * The update RPC replaces the entire spec, so the loaded record is
 * mapped through the generated `toMemoryUpdateInput` and only `content`
 * is overridden — the wipe-safe editing rule. Subject and provenance
 * ride along verbatim (they are update-immutable server-side), and the
 * consent lifecycle is never touched by updates.
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
        return await stigmer.memory.update({
          ...toMemoryUpdateInput(memory),
          content,
        });
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
