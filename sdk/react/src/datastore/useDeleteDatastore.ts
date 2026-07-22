"use client";

import { useCallback, useState } from "react";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Arguments for {@link UseDeleteDatastoreReturn.deleteDatastore}. */
export interface DeleteDatastoreArgs {
  /** Datastore resource id (`dst_…`). */
  readonly resourceId: string;
  /**
   * Acknowledgment that the datastore's records will be destroyed.
   * Required for non-empty datastores (the server's GuardNonEmpty
   * rejects without it, reporting record and collection counts);
   * meaningless for empty ones. `DeleteDatastoreDialog` arms it only
   * after the operator types the datastore slug.
   */
  readonly force?: boolean;
}

/** Return value of {@link useDeleteDatastore}. */
export interface UseDeleteDatastoreReturn {
  /**
   * Delete a datastore through its two server guards (DD-003), in
   * order:
   *
   * 1. **Agent-reference block** — a datastore referenced by any
   *    agent's `datastore_usages` cannot be deleted, force or not; the
   *    `FAILED_PRECONDITION` names the referencing agents (detach
   *    first).
   * 2. **Non-empty acknowledgment** — held records require `force`;
   *    without it the error reports current record/collection counts.
   *
   * Rejects — and sets `error` — when a guard refuses; the message is
   * the server's authoritative text with fresh counts, so on drift the
   * dialog re-renders the guard rather than pre-empting it (DD-008
   * invariant 6).
   */
  readonly deleteDatastore: (args: DeleteDatastoreArgs) => Promise<Datastore>;
  /** `true` while the delete is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last refused or failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for the platform's only record-destroying resource
 * delete.
 *
 * Deliberately domain-local rather than a new arm in the generic
 * `useDeleteResource` kind-switch: datastore deletion carries an
 * acknowledgment protocol (`force`) and guard-error rendering that the
 * generic one-shot delete contract must not absorb (DD-003 — extending
 * it would leak record-destruction semantics platform-wide). No
 * success/failure toasts here; `DeleteDatastoreDialog` owns the UX.
 */
export function useDeleteDatastore(): UseDeleteDatastoreReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteDatastore = useCallback(
    async (args: DeleteDatastoreArgs): Promise<Datastore> => {
      setIsDeleting(true);
      setError(null);
      try {
        return await stigmer.datastore.delete({
          resourceId: args.resourceId,
          force: args.force,
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteDatastore, isDeleting, error, clearError };
}
