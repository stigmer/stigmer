"use client";

import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useMemory}. */
export interface UseMemoryReturn {
  /** The memory record, or `null` while loading / not found / on error. */
  readonly memory: Memory | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /**
   * `true` when the record no longer exists. A first-class STATE, not an
   * error: deletion is the platform's consent-revocation mechanism, so a
   * consumer (the proposal chip, a deep link) must render "no longer
   * stored" honestly rather than a failure.
   */
  readonly notFound: boolean;
  /** Error from the last failed request (never not-found), or `null`. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the record from the server. */
  readonly refetch: () => void;
}

/** The fetch result shape that keeps not-found distinct from errors. */
interface MemoryLookup {
  readonly memory: Memory | null;
  readonly notFound: boolean;
}

const PENDING_LOOKUP: MemoryLookup = { memory: null, notFound: false };

/**
 * Data hook that fetches one memory record by id.
 *
 * Built for surfaces that hold a memory's identity but not its CURRENT
 * lifecycle state — the in-thread proposal chip is the primary consumer:
 * the tool result it renders from is frozen at capture time, while the
 * record may have been confirmed, rejected, or deleted since (from the
 * chip itself, the memory settings page, or another device). Content
 * visibility is subject-only, so the fetch answers only for the person
 * the memory is about.
 *
 * Pass `null` as `id` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { memory, isLoading, notFound } = useMemory(memoryId);
 * ```
 */
export function useMemory(id: string | null): UseMemoryReturn {
  const stigmer = useStigmer();

  const { data, isLoading, error, refetch } = useFetch(
    id
      ? () =>
          stigmer.memory.get(id).then(
            (memory): MemoryLookup => ({ memory, notFound: false }),
            (err): MemoryLookup => {
              // Deletion is a state this hook reports, never an error it
              // throws — every other failure propagates.
              if (isNotFound(err)) return { memory: null, notFound: true };
              throw err;
            },
          )
      : null,
    [stigmer, id],
    PENDING_LOOKUP,
  );

  return {
    memory: data.memory,
    isLoading,
    notFound: data.notFound,
    error,
    refetch,
  };
}
