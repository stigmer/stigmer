"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { InvitationPreview } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { InvitationTokenInputSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useInvitationPreview}. */
export interface UseInvitationPreviewReturn {
  /** The invitation preview, or `null` while loading or on error. */
  readonly preview: InvitationPreview | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the preview from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches an {@link InvitationPreview} by its
 * shareable token.
 *
 * Pass `null` to skip fetching (stable no-op). When the `token`
 * changes, the previous in-flight request is discarded and a fresh
 * fetch begins.
 *
 * This hook calls the `getByToken` endpoint, which is **public** —
 * it requires no authentication. The server returns a safe projection
 * containing only the information needed to render the invite
 * acceptance page: organization name/logo, the role being offered,
 * expiry, and whether the invitation is still valid.
 *
 * Check `preview.isValid` before offering the redemption action.
 * When `false`, `preview.invalidReason` contains a human-readable
 * explanation (expired, revoked, or fully redeemed).
 *
 * **Note**: Although authentication is not required by the server,
 * the hook still requires a `StigmerProvider` ancestor because it
 * needs the transport configuration (API base URL) to make the
 * request.
 *
 * @param token - The invitation token from the invite URL, or `null`
 *   to skip fetching.
 *
 * @example
 * ```tsx
 * const { preview, isLoading, error } = useInvitationPreview(token);
 *
 * if (isLoading) return <Spinner />;
 * if (!preview) return <NotFound />;
 * if (!preview.isValid) return <Expired reason={preview.invalidReason} />;
 *
 * return <p>Join {preview.organizationName} as {preview.role}</p>;
 * ```
 */
export function useInvitationPreview(
  token: string | null,
): UseInvitationPreviewReturn {
  const stigmer = useStigmer();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.invitation
      .getByToken(create(InvitationTokenInputSchema, { token }))
      .then(
        (result) => {
          if (cancelled.current) return;
          setPreview(result);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [token, stigmer, fetchKey]);

  return { preview, isLoading, error, refetch };
}
