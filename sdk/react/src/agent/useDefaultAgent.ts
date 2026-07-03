"use client";

import { useCallback, useEffect, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { GetDefaultAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * Milliseconds the cached result can age before a visibility change
 * triggers a background refetch. Keeps the hook quiet during fast
 * window switches while ensuring fresh data after real idle periods.
 */
const STALE_THRESHOLD_MS = 30_000;

const RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 1;

/** Return value of {@link useDefaultAgent}. */
export interface UseDefaultAgentReturn {
  /** The platform default Agent, or `null` while loading or on error. */
  readonly agent: Agent | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the default agent from the server. */
  readonly refetch: () => void;
  /**
   * Returns a promise that resolves with the Agent once the in-flight
   * fetch settles. If the agent is already loaded, resolves immediately.
   * If the fetch has already failed, rejects immediately.
   *
   * Use this to await the default agent in async flows (e.g. submit)
   * instead of failing when `isLoading` is still true.
   */
  readonly waitForResolution: () => Promise<Agent>;
}

/**
 * Data hook that fetches the platform's default agent.
 *
 * The default agent is the one labeled `stigmer.ai/default-agent: "true"`
 * with `visibility_public`. It enables session-first UX where users
 * start a conversation without choosing an agent.
 *
 * Pass `null` for `org` to skip fetching (stable no-op). The hook
 * fetches once on mount and caches the result, then automatically
 * refetches when the document becomes visible after being hidden for
 * longer than {@link STALE_THRESHOLD_MS}. Transient failures are
 * retried once before surfacing an error.
 *
 * @example
 * ```tsx
 * const { agent: defaultAgent, isLoading } = useDefaultAgent("acme");
 *
 * // Use defaultAgent.status.defaultInstanceId for session creation
 * // when the user hasn't explicitly selected an agent.
 * ```
 */
export function useDefaultAgent(org: string | null): UseDefaultAgentReturn {
  const stigmer = useStigmer();
  const lastFetchedAt = useRef(0);

  const fetchFn = org
    ? async () => {
        const doFetch = () =>
          stigmer.agent.getDefault(
            create(GetDefaultAgentRequestSchema, { org }),
          );
        const result = await fetchWithRetry(doFetch, MAX_RETRIES, RETRY_DELAY_MS);
        lastFetchedAt.current = Date.now();
        return result;
      }
    : null;

  const { data: agent, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, stigmer],
    null,
  );

  // Deferred pattern: allows callers to await the in-flight fetch.
  const deferredRef = useRef<Deferred<Agent> | null>(null);

  useEffect(() => {
    if (agent && deferredRef.current) {
      deferredRef.current.resolve(agent);
      deferredRef.current = null;
    }
  }, [agent]);

  useEffect(() => {
    if (error && deferredRef.current) {
      deferredRef.current.reject(error);
      deferredRef.current = null;
    }
  }, [error]);

  const waitForResolution = useCallback((): Promise<Agent> => {
    if (agent) return Promise.resolve(agent);
    if (error) return Promise.reject(error);
    if (!deferredRef.current) {
      deferredRef.current = createDeferred<Agent>();
    }
    return deferredRef.current.promise;
  }, [agent, error]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchedAt.current >= STALE_THRESHOLD_MS) {
        refetch();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  return { agent, isLoading, isRefetching, error, refetch, waitForResolution };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Retries `fn` up to `retries` times with a fixed delay between attempts.
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return fetchWithRetry(fn, retries - 1, delayMs);
  }
}
