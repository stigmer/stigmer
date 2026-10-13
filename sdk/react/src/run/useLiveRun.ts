"use client";

import { useEffect, useMemo, useState } from "react";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isTerminalPhase } from "./run-phases.js";

/** How often a run that has not ended is read again. */
const LIVE_RUN_REFRESH_MS = 3_000;

/** Options for {@link useLiveRun}. */
export interface UseLiveRunOptions {
  /**
   * Whether the run may be read again while it works. Defaults to `true`.
   *
   * When `false`, the run is read once (so consumers always have something
   * to render) and not again — the visibility-gating seam for surfaces that
   * mount many runs at once (e.g. a list of run cards, where only on-screen
   * cards stay live). A `false → true` transition resumes the reads in
   * place; the last record read stays visible either way.
   */
  readonly live?: boolean;
}

/** Return value of {@link useLiveRun}. */
export interface UseLiveRunReturn {
  /**
   * The run record, as last read: its lifecycle (phase, error, usage,
   * setup progress) and files. `null` while loading or when the run does not
   * exist. What the agent did is the session's events, not this record
   * (see `useSessionEvents`).
   */
  readonly run: Run | null;
  /**
   * Convenience extraction of `run.status.phase`; returns
   * `RUN_PHASE_UNSPECIFIED` when `run` is `null`.
   */
  readonly phase: RunPhase;
  /** `true` while the first read is in flight (nothing to show yet). */
  readonly isLoading: boolean;
  /** `true` while the run has not ended and is being read again. */
  readonly isLive: boolean;
  /**
   * The last read's error, or `null` when healthy. Not-found is NOT an
   * error — it yields `run: null` with no error.
   */
  readonly error: Error | null;
  /** Read the run again now. */
  readonly refetch: () => void;
}

/**
 * Data hook for a single {@link Run}'s lifecycle that stays current only
 * while it needs to: a run that has ended is read once; one that has not is
 * read again every few seconds until it ends (or `live` turns off).
 *
 * - The read is cached (`agent-execution:<id>`), so a remount renders
 *   instantly from the previous result with a background refresh.
 * - The reads stop on the run's terminal phase: completion is phase-driven.
 *
 * Pass `null` to skip entirely (stable no-op).
 */
export function useLiveRun(
  executionId: string | null,
  options?: UseLiveRunOptions,
): UseLiveRunReturn {
  const stigmer = useStigmer();
  const live = options?.live ?? true;

  const fetchFn = executionId
    ? async () => {
        try {
          return await stigmer.run.get(executionId);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  // Whether the last read found the run live; it sets the read interval,
  // so it is synced from the read below (one render behind, which is
  // immaterial at this cadence).
  const [polling, setPolling] = useState(false);
  const { data: fetched, isLoading, error, refetch } = useFetch(
    fetchFn,
    [executionId, stigmer],
    null,
    {
      cacheKey: executionId ? `agent-execution:${executionId}` : undefined,
      refetchInterval: polling ? LIVE_RUN_REFRESH_MS : false,
    },
  );

  const phase = fetched?.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
  const isLive = live && fetched !== null && !isTerminalPhase(phase);
  useEffect(() => {
    setPolling(isLive);
  }, [isLive]);

  return useMemo(
    () => ({ run: fetched, phase, isLoading, isLive, error, refetch }),
    [fetched, phase, isLoading, isLive, error, refetch],
  );
}
