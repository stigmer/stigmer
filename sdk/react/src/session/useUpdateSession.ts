"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Session, SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { useStigmer } from "../hooks.js";

/** Return value of {@link useUpdateSession}. */
export interface UseUpdateSessionReturn {
  /**
   * Update a session: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: Session | MessageInitShape<typeof SessionSchema>,
    paths: string[],
  ) => Promise<Session>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error message from the last failed update, or `null` when healthy. */
  readonly error: string | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `session.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the session by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.metadata`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A session read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the session changed since it was read.
 *
 * To change only the subject, prefer the field-level
 * `session.updateSubject()` RPC.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateSession();
 *
 * await update(
 *   {
 *     metadata: { id: session.metadata!.id, etag: session.metadata!.etag },
 *     spec: { metadata: { ...session.spec?.metadata, "acme/reviewed": "true" } },
 *   },
 *   ["spec.metadata"],
 * );
 * ```
 */
export function useUpdateSession(): UseUpdateSessionReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: Session | MessageInitShape<typeof SessionSchema>,
      paths: string[],
    ): Promise<Session> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.session.update(resource, paths);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update session";
        setError(message);
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
