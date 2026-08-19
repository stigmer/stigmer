"use client";

import { useCallback, useState } from "react";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useConfirmMemory}. */
export interface UseConfirmMemoryReturn {
  /** Confirm a proposed memory by its resource ID. Resolves with the confirmed record. */
  readonly confirmMemory: (id: string) => Promise<Memory>;
  /** `true` while the confirm request is in flight. */
  readonly isConfirming: boolean;
  /** Error from the last failed confirm, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `memory.confirm()` — the consent act
 * (DD-005 D3). A confirmed memory is recalled into the caller's future
 * sessions as background context.
 *
 * Confirming an already-confirmed memory succeeds and changes nothing.
 * Confirming a rejected memory fails with FAILED_PRECONDITION: the
 * rejection stands — delete the record and let the agent propose again.
 *
 * @example
 * ```tsx
 * const { confirmMemory, isConfirming } = useConfirmMemory();
 *
 * await confirmMemory(memory.metadata?.id ?? "");
 * refetch(); // refresh the list after the decision
 * ```
 */
export function useConfirmMemory(): UseConfirmMemoryReturn {
  const stigmer = useStigmer();
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const confirmMemory = useCallback(
    async (id: string): Promise<Memory> => {
      setIsConfirming(true);
      setError(null);

      try {
        return await stigmer.memory.confirm(id);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsConfirming(false);
      }
    },
    [stigmer],
  );

  return { confirmMemory, isConfirming, error, clearError };
}
