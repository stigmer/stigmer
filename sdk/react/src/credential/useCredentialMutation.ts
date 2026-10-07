"use client";

/**
 * The pending and error state every credential write hook shares: one
 * call in flight at a time is not enforced (the server orders writes),
 * the error is the last failure's, and a failure is both recorded and
 * rethrown so a caller can await the outcome and still render the state.
 *
 * Internal; the public hooks are the named ones beside it.
 */
import { useCallback, useMemo, useState } from "react";
import { toError } from "../internal/toError.js";

/** What a credential write hook returns around its call. */
export interface CredentialMutation<I, O> {
  readonly run: (input: I) => Promise<O>;
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
}

/** Wraps `call` with pending and error state. `call` must be stable. */
export function useCredentialMutation<I, O>(
  call: (input: I) => Promise<O>,
): CredentialMutation<I, O> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async (input: I): Promise<O> => {
      setIsPending(true);
      setError(null);
      try {
        return await call(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [call],
  );

  return useMemo(
    () => ({ run, isPending, error, clearError }),
    [run, isPending, error, clearError],
  );
}
