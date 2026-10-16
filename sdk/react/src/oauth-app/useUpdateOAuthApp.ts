"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { OAuthApp, OAuthAppSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateOAuthApp}. */
export interface UseUpdateOAuthAppReturn {
  /**
   * Update an OAuth app: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: OAuthApp | MessageInitShape<typeof OAuthAppSchema>,
    paths: string[],
  ) => Promise<OAuthApp>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `oauthapp.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the OAuth app by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.scopes`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A OAuth app read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the OAuth app changed since it was read.
 *
 * A secret the update does not name keeps its stored value: name
 * `spec.client_secret` only to replace it.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateOAuthApp();
 *
 * await update(
 *   {
 *     metadata: { id: app.metadata!.id, etag: app.metadata!.etag },
 *     spec: { scopes: ["chat:write", "users:read"] },
 *   },
 *   ["spec.scopes"],
 * );
 * ```
 */
export function useUpdateOAuthApp(): UseUpdateOAuthAppReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: OAuthApp | MessageInitShape<typeof OAuthAppSchema>,
      paths: string[],
    ): Promise<OAuthApp> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.oauthapp.update(resource, paths);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
