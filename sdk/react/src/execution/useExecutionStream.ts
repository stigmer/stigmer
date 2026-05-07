"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import { useStreamRate } from "../internal/dev";
import {
  StreamController,
  type StreamControllerSink,
} from "../internal/stream-controller";
import { ConversationStore, type StreamState } from "../internal/store";
import { isTerminalPhase } from "./execution-phases";

/** Return value of {@link useExecutionStream}. */
export interface UseExecutionStreamReturn {
  /** Latest full execution snapshot from the stream, or `null` before the first update arrives. */
  readonly execution: AgentExecution | null;
  /**
   * Convenience extraction of `execution.status.phase`.
   *
   * Derived from `execution` — always consistent with the current
   * snapshot. Returns `EXECUTION_PHASE_UNSPECIFIED` when `execution`
   * is `null`.
   */
  readonly phase: ExecutionPhase;
  /** `true` while receiving non-terminal updates from the server stream. */
  readonly isStreaming: boolean;
  /** `true` after subscription starts but before the first snapshot arrives. */
  readonly isConnecting: boolean;
  /** Error from the last failed stream attempt, or `null` when healthy. */
  readonly error: Error | null;
  /**
   * Reset error state and re-establish the stream subscription.
   *
   * Works in any lifecycle state — error, complete, or mid-stream.
   * Uses the `connectKey` counter pattern consistent with `refetch()`
   * in other SDK hooks.
   */
  readonly reconnect: () => void;
}

/**
 * Options for {@link useExecutionStream}.
 */
export interface UseExecutionStreamOptions {
  /**
   * External `ConversationStore` to ingest snapshots into.
   *
   * When provided, the hook writes directly to this store and reads
   * the execution snapshot back via `useSyncExternalStore`. This
   * allows `useSessionConversation` to share a single store instance
   * across the stream hook and the rendering tree.
   *
   * When omitted, an internal store is created automatically —
   * preserving backward compatibility for standalone usage.
   */
  readonly store?: ConversationStore;
}

/**
 * Behavior hook that subscribes to real-time {@link AgentExecution}
 * updates via `stigmer.agentExecution.subscribe()`.
 *
 * Manages the full subscription lifecycle through a finite state
 * machine: connection establishment, rAF-coalesced snapshot streaming,
 * terminal-phase detection, error handling, and manual reconnection.
 *
 * **Performance characteristics:**
 * - Non-terminal snapshots are coalesced via `requestAnimationFrame`
 *   so React commits at most once per display frame (~60Hz)
 * - Terminal snapshots (complete/failed/cancelled) flush immediately
 * - Store updates are wrapped in `startTransition` so thread renders
 *   don't block urgent interactions (e.g. composer typing)
 *
 * Pass `null` as `executionId` to skip subscribing (stable no-op).
 * When `executionId` changes, the previous subscription is aborted
 * and a fresh one begins.
 *
 * @example
 * ```tsx
 * function LiveExecution({ id }: { id: string }) {
 *   const { execution, isStreaming, error, reconnect } =
 *     useExecutionStream(id);
 *
 *   if (error) return <p>{error.message} <button onClick={reconnect}>Retry</button></p>;
 *   if (!execution) return <p>Connecting…</p>;
 *
 *   return (
 *     <div>
 *       {execution.status?.messages.map((m, i) => (
 *         <p key={i}>{m.content}</p>
 *       ))}
 *       {isStreaming && <span>Streaming…</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useExecutionStream(
  executionId: string | null,
  options?: UseExecutionStreamOptions,
): UseExecutionStreamReturn {
  const stigmer = useStigmer();

  // -- Store setup ----------------------------------------------------------
  // Use the externally provided store, or create a private one for
  // standalone usage. The ref ensures the internal store is stable
  // across re-renders.
  const internalStoreRef = useRef<ConversationStore | null>(null);
  if (!options?.store && !internalStoreRef.current) {
    internalStoreRef.current = new ConversationStore();
  }
  const store = options?.store ?? internalStoreRef.current!;

  // -- Controller setup -----------------------------------------------------
  const controllerRef = useRef<StreamController | null>(null);
  if (!controllerRef.current) {
    const sink: StreamControllerSink = {
      ingestSnapshot(snapshot) {
        startTransition(() => {
          store.ingestSnapshot(snapshot);
        });
      },
      setStreamState(state) {
        startTransition(() => {
          store.setStreamState(state);
        });
      },
    };
    controllerRef.current = new StreamController(sink);
  }
  const controller = controllerRef.current;

  // -- Reconnect ------------------------------------------------------------
  const [connectKey, setConnectKey] = useState(0);
  const reconnect = useCallback(() => {
    setConnectKey((k) => k + 1);
  }, []);

  // -- Stream rate instrumentation ------------------------------------------
  const streamRate = useStreamRate();
  const streamRateRef = useRef(streamRate);
  streamRateRef.current = streamRate;

  // -- Subscription effect --------------------------------------------------
  // Note: controller, store, and streamRate are ref-backed stable objects —
  // they MUST NOT appear in the deps array. Including them would cause
  // infinite re-renders because useStreamRate returns a new object per render.
  useEffect(() => {
    if (!executionId) {
      controller.reset();
      store.reset();
      return;
    }

    const abortController = new AbortController();
    controller.start(executionId);

    (async () => {
      try {
        for await (const snapshot of stigmer.agentExecution.subscribe(
          executionId,
          abortController.signal,
        )) {
          if (abortController.signal.aborted) return;

          controller.handleSnapshot(snapshot);
          streamRateRef.current.tick(
            snapshot.status?.messages?.length ?? 0,
          );

          const phase =
            snapshot.status?.phase ??
            ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
          if (isTerminalPhase(phase)) break;
        }

        if (!abortController.signal.aborted) {
          controller.handleStreamEnd();
          streamRateRef.current.summary();
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        controller.handleError(toError(err));
      }
    })();

    return () => {
      abortController.abort();
      controller.reset();
      store.reset();
    };
  }, [executionId, stigmer, connectKey]);

  // -- Read from store via useSyncExternalStore ------------------------------
  const execution = useSyncExternalStore(store.subscribe, store.getExecution);
  const streamState = useSyncExternalStore(
    store.subscribe,
    store.getStreamState,
  );

  // -- Derive public return values ------------------------------------------
  const phase = useMemo(
    () =>
      execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    [execution],
  );

  const isStreaming = streamState.stage === "streaming";
  const isConnecting = streamState.stage === "connecting";
  const error =
    streamState.stage === "error" ? streamState.error : null;

  return { execution, phase, isStreaming, isConnecting, error, reconnect };
}
