"use client";

import { useCallback, useRef, useState } from "react";
import { toError } from "../internal/toError";

/** Return value of {@link useInlineFieldSave}. */
export interface UseInlineFieldSaveReturn<TResource, TValue> {
  /** Trigger a save. Resolves `true` on success, `false` on failure. */
  readonly save: (newValue: TValue) => Promise<boolean>;
  /** `true` while the save RPC is in flight. */
  readonly isSaving: boolean;
  /** Error from the most recent failed save. */
  readonly error: string | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Generic hook that saves a single field on a resource.
 *
 * The `saveFn` receives the current resource and the new field value,
 * reconstructs the full input, and calls the update API. On success
 * the resource state is refreshed; on failure the error is captured.
 *
 * @param currentResource - Ref to the latest fetched resource (read on each save).
 * @param saveFn - Async function that performs the update and returns the new resource.
 */
export function useInlineFieldSave<TResource, TValue>(
  currentResource: TResource | null | undefined,
  saveFn: (resource: TResource, newValue: TValue) => Promise<TResource>,
): UseInlineFieldSaveReturn<TResource, TValue> {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback(
    async (newValue: TValue): Promise<boolean> => {
      if (!currentResource) return false;

      const callId = ++inflight.current;
      setIsSaving(true);
      setError(null);

      try {
        await saveFn(currentResource, newValue);
        if (inflight.current !== callId) return false;
        return true;
      } catch (err) {
        if (inflight.current !== callId) return false;
        setError(toError(err).message);
        return false;
      } finally {
        if (inflight.current === callId) setIsSaving(false);
      }
    },
    [currentResource, saveFn],
  );

  return { save, isSaving, error, clearError };
}
