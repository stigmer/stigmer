"use client";

import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useDatastore}. */
export interface UseDatastoreReturn {
  /** The resolved datastore, or `null` while loading, on error, or when not found. */
  readonly datastore: Datastore | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the datastore from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a single Datastore by organization and slug.
 *
 * Wraps `stigmer.datastore.getByReference()` with loading, error, and
 * not-found state management. The loaded resource carries the spec
 * (collections, fields, constraints, authorization) and status (sync
 * report, per-collection record counts) — the authoritative source for
 * every structural view (DD-008 SD-5: spec for structure, status for
 * health; `describeDatastore` is consulted only for caller-effective
 * verbs — see {@link useDatastoreDescription}).
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op).
 *
 * **Not-found handling:** a NOT_FOUND response sets `datastore` to
 * `null` without raising an error; `datastore === null && !isLoading
 * && !error` means the resource does not exist.
 *
 * @example
 * ```tsx
 * const { datastore, isLoading, error } = useDatastore("acme", "clinic");
 * ```
 */
export function useDatastore(
  org: string | null,
  slug: string | null,
): UseDatastoreReturn {
  const stigmer = useStigmer();

  const { data: datastore, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.datastore.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { datastore, isLoading, isRefetching, error, refetch };
}
