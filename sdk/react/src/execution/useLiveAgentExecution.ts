"use client";

import { useCallback, useMemo, useRef } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isTerminalPhase } from "./execution-phases.js";
import { useExecutionStream } from "./useExecutionStream.js";

/** Options for {@link useLiveAgentExecution}. */
export interface UseLiveAgentExecutionOptions {
  /**
   * Whether the live stream may be open. Defaults to `true`.
   *
   * When `false`, the snapshot fetch still runs (so consumers always have
   * something to render) but no subscription is opened — the
   * visibility-gating seam for surfaces that mount many executions at once
   * (e.g. inline agent-call transcripts in the workflow task thread, where
   * only on-screen cards stream). A `false → true` transition attaches the
   * stream in place; a `true → false` transition pauses it while the
   * last-streamed snapshot stays visible (the view never rewinds to the
   * mount-time snapshot).
   */
  readonly live?: boolean;
}

/** Return value of {@link useLiveAgentExecution}. */
export interface UseLiveAgentExecutionReturn {
  /**
   * The freshest execution snapshot available: the live stream's while
   * streaming, the fetched one otherwise. `null` while loading or when the
   * execution does not exist.
   */
  readonly execution: AgentExecution | null;
  /**
   * Convenience extraction of `execution.status.phase`; returns
   * `EXECUTION_PHASE_UNSPECIFIED` when `execution` is `null`.
   */
  readonly phase: ExecutionPhase;
  /** `true` while the initial snapshot fetch is in flight (nothing to show yet). */
  readonly isLoading: boolean;
  /** `true` while live updates are arriving from the stream. */
  readonly isStreaming: boolean;
  /**
   * `true` while a transient stream drop is being retried in the background.
   * The last snapshot stays visible — surface a subtle affordance, not an error.
   */
  readonly isReconnecting: boolean;
  /**
   * Snapshot-fetch error, or the stream's terminal error (auto-reconnect
   * exhausted). `null` when healthy. Not-found is NOT an error — it yields
   * `execution: null` with no error, matching `useWorkflowExecution`.
   */
  readonly error: Error | null;
  /**
   * Recover from either failure mode: re-fetches the snapshot AND resets the
   * stream (one retry affordance for consumers, whichever side failed).
   */
  readonly reconnect: () => void;
}

/**
 * Behavior hook for a single {@link AgentExecution} that is live only while
 * it needs to be: fetch the snapshot, stream only what is running.
 *
 * This is the single-execution analog of the session's canonical
 * composition (`useSessionExecutions` GET for history + `useExecutionStream`
 * for the active turn): a terminal execution is served entirely by one
 * `agentExecution.get()` — never a subscription — while a running one layers
 * the streaming pipeline on top of the fetched snapshot.
 *
 * - The snapshot fetch is DD-014 cached (`agent-execution:<id>`), so a
 *   remount (e.g. returning to a transcript tab) renders instantly from the
 *   previous result with a background refresh — no loading flash.
 * - The stream starts only after the fetch proves the phase non-terminal;
 *   `useExecutionStream` then owns the live lifecycle (rAF coalescing,
 *   auto-reconnect, terminal-phase completion — DD-009/DD-017).
 * - Once streaming, the stream's snapshot supersedes the fetched one (it is
 *   always at least as fresh, including the terminal state the fetch missed).
 *
 * Pass `null` to skip entirely (stable no-op).
 */
export function useLiveAgentExecution(
  executionId: string | null,
  options?: UseLiveAgentExecutionOptions,
): UseLiveAgentExecutionReturn {
  const stigmer = useStigmer();
  const live = options?.live ?? true;

  const fetchFn = executionId
    ? async () => {
        try {
          return await stigmer.agentExecution.get(executionId);
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    : null;

  const {
    data: fetched,
    isLoading,
    error: fetchError,
    refetch,
  } = useFetch(fetchFn, [executionId, stigmer], null, {
    cacheKey: executionId ? `agent-execution:${executionId}` : undefined,
  });

  // Gate the stream on the FETCHED phase, not the streamed one: the fetched
  // snapshot never advances, so a run that terminates mid-stream does not
  // flip this gate and unmount-thrash the subscription — useExecutionStream
  // ends itself on the terminal snapshot (completion is phase-driven).
  // `live` is the consumer's visibility gate layered on top (an off-screen
  // surface pauses its subscription without losing the fetch).
  const fetchedPhase =
    fetched?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const shouldStream =
    live && fetched !== null && !isTerminalPhase(fetchedPhase);
  const stream = useExecutionStream(shouldStream ? executionId : null);

  // Retain the freshest snapshot ever shown for THIS execution across a
  // stream pause (`live: true → false`): useExecutionStream resets its
  // store when unsubscribed, so without this a paused surface would rewind
  // to the mount-time fetch — visibly rolling the view backwards. Keyed by
  // id so an execution switch never leaks the previous one's snapshot.
  const lastStreamedRef = useRef<{
    id: string;
    execution: AgentExecution;
  } | null>(null);
  if (executionId && stream.execution) {
    lastStreamedRef.current = { id: executionId, execution: stream.execution };
  } else if (lastStreamedRef.current?.id !== executionId) {
    lastStreamedRef.current = null;
  }

  const execution =
    stream.execution ?? lastStreamedRef.current?.execution ?? fetched;
  const phase =
    execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const streamReconnect = stream.reconnect;
  const reconnect = useCallback(() => {
    refetch();
    streamReconnect();
  }, [refetch, streamReconnect]);

  const error = fetchError ?? stream.error;
  const { isStreaming, isReconnecting } = stream;

  return useMemo(
    () => ({
      execution,
      phase,
      isLoading,
      isStreaming,
      isReconnecting,
      error,
      reconnect,
    }),
    [execution, phase, isLoading, isStreaming, isReconnecting, error, reconnect],
  );
}
