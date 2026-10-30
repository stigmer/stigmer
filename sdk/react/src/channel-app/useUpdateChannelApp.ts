"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ChannelApp, ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useUpdateChannelApp}. */
export interface UseUpdateChannelAppReturn {
  /**
   * Update a channel app: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: ChannelApp | MessageInitShape<typeof ChannelAppSchema>,
    paths: string[],
  ) => Promise<ChannelApp>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `channelapp.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the channel app by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.slack`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A channel app read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the channel app changed since it was read.
 *
 * Typically used to rotate a secret. A read shows each secret as the
 * redaction marker (`***REDACTED***`); sending the marker back under a
 * named path keeps the stored value, so a form prefilled from a fetched
 * app can rotate one secret without re-entering the other.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateChannelApp();
 *
 * await update(
 *   {
 *     metadata: { id: app.metadata!.id, etag: app.metadata!.etag },
 *     spec: { slack: { clientId: "123456.789012", clientSecret: "***REDACTED***", signingSecret: "new-signing-secret" } },
 *   },
 *   ["spec.slack"],
 * );
 * ```
 */
export function useUpdateChannelApp(): UseUpdateChannelAppReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: ChannelApp | MessageInitShape<typeof ChannelAppSchema>,
      paths: string[],
    ): Promise<ChannelApp> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.channelapp.update(resource, paths);
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
