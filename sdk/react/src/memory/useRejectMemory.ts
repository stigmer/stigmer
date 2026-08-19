"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useRejectMemory}. */
export interface UseRejectMemoryReturn {
  /** Reject a proposed memory by its resource ID. Resolves with the rejected record. */
  readonly rejectMemory: (id: string) => Promise<Memory>;
  /** `true` while the reject request is in flight. */
  readonly isRejecting: boolean;
  /** Error from the last failed reject, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `memory.reject()`. A rejected memory is never
 * recalled; the record is kept as an audit trail until deleted.
 *
 * Rejecting an already-rejected memory succeeds and changes nothing.
 * Rejecting a confirmed memory fails with FAILED_PRECONDITION —
 * deleting a confirmed memory is how it is revoked.
 *
 * Rejection is deliberately one click on every surface, with no
 * confirmation dialog (DD-005 D4): expensive review teaches users to
 * ignore the proposal queue.
 *
 * @example
 * ```tsx
 * const { rejectMemory, isRejecting } = useRejectMemory();
 *
 * await rejectMemory(memory.metadata?.id ?? "");
 * refetch(); // refresh the list after the decision
 * ```
 */
export function useRejectMemory(): UseRejectMemoryReturn {
  const stigmer = useStigmer();
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const rejectMemory = useCallback(
    async (id: string): Promise<Memory> => {
      setIsRejecting(true);
      setError(null);

      try {
        return await stigmer.memory.reject(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRejecting(false);
      }
    },
    [stigmer],
  );

  return { rejectMemory, isRejecting, error, clearError };
}
