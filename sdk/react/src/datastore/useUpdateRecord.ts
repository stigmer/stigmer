"use client";

import { useCallback, useState } from "react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  UpdateRecordRequestSchema,
  type RecordEnvelope,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { RecordScope } from "./useRecordList.js";

/** Arguments for a single record update. */
export interface UpdateRecordArgs extends RecordScope {
  /** Record id (`dsr_…`). */
  readonly id: string;
  /**
   * Partial merge (DD-005): only the supplied fields change; an
   * explicit `null` clears a field; absent fields keep their stored
   * values. Constraints evaluate on the merged result. Build this from
   * per-field edits with `buildUpdateFields`.
   */
  readonly fields: JsonObject;
}

/** Return value of {@link useUpdateRecord}. */
export interface UseUpdateRecordReturn {
  /**
   * Update one record by id. Resolves with the merged envelope. Rejects
   * — and sets `error` — on denial or constraint violation; the error's
   * message is the server's relayable text, byte-for-byte.
   */
  readonly updateRecord: (args: UpdateRecordArgs) => Promise<RecordEnvelope>;
  /** `true` while the update is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `datastore.updateRecord()` with loading and
 * error state.
 *
 * The RPC is an honest tri-state partial merge — the hook adds no
 * merge semantics of its own. A record in another partition is
 * NOT_FOUND (DD-010: partition scoping is structural).
 *
 * @example
 * ```tsx
 * const { updateRecord } = useUpdateRecord();
 * await updateRecord({
 *   org: "acme",
 *   datastore: "clinic",
 *   collection: "bookings",
 *   id: "dsr_01j9...",
 *   fields: { patient_phone: "+15550100", notes: null }, // notes cleared
 * });
 * ```
 */
export function useUpdateRecord(): UseUpdateRecordReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateRecord = useCallback(
    async (args: UpdateRecordArgs): Promise<RecordEnvelope> => {
      setIsUpdating(true);
      setError(null);
      try {
        return await stigmer.datastore.updateRecord(
          create(UpdateRecordRequestSchema, {
            org: args.org,
            datastore: args.datastore,
            collection: args.collection,
            partition: args.partition ?? "",
            id: args.id,
            fields: args.fields,
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { updateRecord, isUpdating, error, clearError };
}
