"use client";

/**
 * useDeleteCredential: delete a credential. Runs that would have used it
 * are refused when they are created until another credential gives the
 * values, so the confirmation that precedes this call says so.
 */
import { useCallback } from "react";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useCredentialMutation } from "./useCredentialMutation.js";

/** Return value of {@link useDeleteCredential}. */
export interface UseDeleteCredentialReturn {
  /** Delete the credential with this id. Resolves with it as it was. */
  readonly remove: (credentialId: string) => Promise<Credential>;
  /** `true` while the delete is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that deletes a credential.
 *
 * @example
 * ```tsx
 * const { remove, isDeleting } = useDeleteCredential();
 * await remove(credential.metadata.id);
 * ```
 */
export function useDeleteCredential(): UseDeleteCredentialReturn {
  const stigmer = useStigmer();
  const call = useCallback(
    (credentialId: string): Promise<Credential> =>
      stigmer.credential.delete({ resourceId: credentialId }),
    [stigmer],
  );
  const { run, isPending, error, clearError } = useCredentialMutation(call);
  return { remove: run, isDeleting: isPending, error, clearError };
}
