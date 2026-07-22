"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  DeleteRecordRequestSchema,
  type RecordEnvelope,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { RecordScope } from "./useRecordList.js";

/** Arguments for a single record delete. */
export interface DeleteRecordArgs extends RecordScope {
  /** Record id (`dsr_…`). */
  readonly id: string;
}

/** Return value of {@link useDeleteRecord}. */
export interface UseDeleteRecordReturn {
  /**
   * Delete one record by id. Resolves with the deleted record's final
   * envelope (usable for an undo-by-reinsert growth path). Rejects —
   * and sets `error` — on denial; the error's message is the server's
   * relayable text, byte-for-byte.
   */
  readonly deleteRecord: (args: DeleteRecordArgs) => Promise<RecordEnvelope>;
  /** `true` while the delete is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `datastore.deleteRecord()` with loading and
 * error state.
 *
 * Record deletes are id-addressed with a blast radius of one — the
 * standard destructive confirm suffices (DD-008 SD-4). Deleting the
 * datastore itself is a different, guarded operation: see
 * {@link useDeleteDatastore}.
 */
export function useDeleteRecord(): UseDeleteRecordReturn {
  const stigmer = useStigmer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const deleteRecord = useCallback(
    async (args: DeleteRecordArgs): Promise<RecordEnvelope> => {
      setIsDeleting(true);
      setError(null);
      try {
        return await stigmer.datastore.deleteRecord(
          create(DeleteRecordRequestSchema, {
            org: args.org,
            datastore: args.datastore,
            collection: args.collection,
            partition: args.partition ?? "",
            id: args.id,
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsDeleting(false);
      }
    },
    [stigmer],
  );

  return { deleteRecord, isDeleting, error, clearError };
}
