"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import {
  DescribeDatastoreRequestSchema,
  type DatastoreDescription,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** The partition every datastore starts with (DD-010). */
export const DEFAULT_PARTITION = "default";

/** Return value of {@link useDatastoreDescription}. */
export interface UseDatastoreDescriptionReturn {
  /** The caller-effective description, or `null` while loading or on error. */
  readonly description: DatastoreDescription | null;
  /**
   * Selectable data partitions: the datastore's partition catalog with
   * `"default"` always present. The catalog materializes with the first
   * record write, so on an empty datastore it reports nothing — but the
   * default partition is always addressable (DD-010: unset partition
   * means `"default"`), so the picker must always offer it.
   */
  readonly partitions: readonly string[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the description from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the caller-effective view of a datastore via
 * `describeDatastore`.
 *
 * This is the console's **only** source of caller-effective record
 * verbs (DD-008 SD-2): record grants are datastore domain logic, not
 * FGA, so resource-layer permission checks structurally cannot answer
 * "may I insert into bookings?". Every record write affordance gates on
 * the per-collection `access` lists returned here — and those lists are
 * projections, never authority: the server's record layer remains the
 * enforcer, so a stale projection degrades to a clean denial.
 *
 * **Denied-state semantics** (DD-008 SD-3): a caller with resource
 * visibility but no record grants gets a successful response with
 * empty `access` lists — deny-by-default renders as empty access,
 * never an error. A reach-level `PERMISSION_DENIED` (no
 * `can_use_records` in cloud) surfaces as `error`; consumers render
 * both as the Records-tab denied panel, not a page-level failure.
 *
 * Pass `null` for `org` or `datastore` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { description, partitions } = useDatastoreDescription("acme", "clinic");
 * const bookings = description?.collections.find((c) => c.name === "bookings");
 * const canInsert = bookings?.access.some((a) => a.verb === DatastoreVerb.insert);
 * ```
 */
export function useDatastoreDescription(
  org: string | null,
  datastore: string | null,
): UseDatastoreDescriptionReturn {
  const stigmer = useStigmer();

  const { data: description, isLoading, isRefetching, error, refetch } = useFetch(
    org && datastore
      ? () =>
          stigmer.datastore.describeDatastore(
            create(DescribeDatastoreRequestSchema, { org, datastore }),
          )
      : null,
    [org, datastore, stigmer],
    null,
  );

  const partitions = useMemo(() => {
    const catalog = description?.partitions ?? [];
    return catalog.includes(DEFAULT_PARTITION)
      ? catalog
      : [DEFAULT_PARTITION, ...catalog];
  }, [description]);

  return { description, partitions, isLoading, isRefetching, error, refetch };
}
