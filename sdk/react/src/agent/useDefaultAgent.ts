"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { GetDefaultAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the default agent from the server. */
  readonly refetch: () => void;
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
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const lastFetchedAt = useRef(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!org) {
      setAgent(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    const doFetch = () =>
      stigmer.agent.getDefault(create(GetDefaultAgentRequestSchema, { org }));

    fetchWithRetry(doFetch, MAX_RETRIES, RETRY_DELAY_MS, cancelled).then(
      (result) => {
        if (cancelled.current) return;
        lastFetchedAt.current = Date.now();
        setAgent(result);
        setIsLoading(false);
      },
      (err) => {
        if (cancelled.current) return;
        setError(toError(err));
        setIsLoading(false);
      },
    );

    return () => {
      cancelled.current = true;
    };
  }, [org, stigmer, fetchKey]);

  // Re-fetch when the document becomes visible after an idle period.
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

  return { agent, isLoading, error, refetch };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Retries `fn` up to `retries` times with a fixed delay between attempts.
 * Bails immediately when the owning effect is cancelled.
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  cancelled: { current: boolean },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (cancelled.current || retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    if (cancelled.current) throw err;
    return fetchWithRetry(fn, retries - 1, delayMs, cancelled);
  }
}
