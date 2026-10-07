"use client";

/**
 * useCredential: one credential by id, with secret values redacted. The
 * field editor and the edit form read through it, so a save elsewhere is
 * picked up by `refetch()`.
 */
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useCredential}. */
export interface UseCredentialReturn {
  /** The credential, or `null` while loading or on error. */
  readonly credential: Credential | null;
  /** `true` while the first fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-read the credential. */
  readonly refetch: () => void;
}

/**
 * Data hook that reads one credential by id. Pass `null` to skip.
 *
 * @example
 * ```tsx
 * const { credential, isLoading } = useCredential(credentialId);
 * ```
 */
export function useCredential(id: string | null): UseCredentialReturn {
  const stigmer = useStigmer();
  const { data, isLoading, isRefetching, error, refetch } = useFetch(
    id ? () => stigmer.credential.get(id) : null,
    [id, stigmer],
    null as Credential | null,
  );
  return { credential: data, isLoading, isRefetching, error, refetch };
}
