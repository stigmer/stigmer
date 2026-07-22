"use client";

import { useCallback, useState } from "react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  InsertRecordRequestSchema,
  type RecordEnvelope,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { RecordScope } from "./useRecordList.js";

/** Arguments for a single record insert. */
export interface InsertRecordArgs extends RecordScope {
  /**
   * Declared field values in their canonical encodings (DD-004). System
   * field names (`id`, `created_at`, …) are rejected by the server.
   */
  readonly record: JsonObject;
}

/** Return value of {@link useInsertRecord}. */
export interface UseInsertRecordReturn {
  /**
   * Insert one record. Resolves with the server-stamped envelope (id,
   * timestamps, attribution). Rejects — and sets `error` — on denial or
   * constraint violation; the error's message is the server's relayable
   * text, byte-for-byte (render it verbatim, DD-008 invariant 4).
   */
  readonly insertRecord: (args: InsertRecordArgs) => Promise<RecordEnvelope>;
  /** `true` while the insert is in flight. */
  readonly isInserting: boolean;
  /** Error from the last failed insert, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `datastore.insertRecord()` with loading and
 * error state.
 *
 * Constraint violations (`ALREADY_EXISTS` for uniques,
 * `FAILED_PRECONDITION` for checks) carry the constraint's declared
 * message plus a `google.rpc.ErrorInfo` naming the constraint — use
 * `getRecordConstraint` from `@stigmer/sdk` to place the message next
 * to the fields it covers.
 *
 * @example
 * ```tsx
 * const { insertRecord, isInserting, error } = useInsertRecord();
 * await insertRecord({
 *   org: "acme",
 *   datastore: "clinic",
 *   collection: "bookings",
 *   record: { slot_date: "2026-07-22", slot_time: "09:30:00" },
 * });
 * ```
 */
export function useInsertRecord(): UseInsertRecordReturn {
  const stigmer = useStigmer();
  const [isInserting, setIsInserting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const insertRecord = useCallback(
    async (args: InsertRecordArgs): Promise<RecordEnvelope> => {
      setIsInserting(true);
      setError(null);
      try {
        return await stigmer.datastore.insertRecord(
          create(InsertRecordRequestSchema, {
            org: args.org,
            datastore: args.datastore,
            collection: args.collection,
            partition: args.partition ?? "",
            record: args.record,
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsInserting(false);
      }
    },
    [stigmer],
  );

  return { insertRecord, isInserting, error, clearError };
}
