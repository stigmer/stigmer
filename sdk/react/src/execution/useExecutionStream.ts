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
import { isTransientStreamError } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useStreamRate } from "../internal/dev/index.js";
import {
  StreamController,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_SLOW_THRESHOLD_MS,
  type StreamControllerSink,
} from "../internal/stream-controller.js";
import {
  computeBackoffDelay,
  sleep,
  DEFAULT_RECONNECT_MAX_ATTEMPTS,
  type BackoffOptions,
} from "../internal/backoff.js";
import { ConversationStore } from "../internal/store/index.js";
import { isTerminalPhase } from "./execution-phases.js";

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
  /**
   * `true` while a transient drop is being retried automatically in the
   * background. The last snapshot stays visible and `error` remains `null` —
   * surface a subtle "Reconnecting…" affordance, not an error. Becomes
   * `false` once a snapshot is received (back to `isStreaming`) or retries
   * are exhausted (then `error` is set).
   */
  readonly isReconnecting: boolean;
  /** 1-based count of the in-flight reconnect attempt; `0` when not reconnecting. */
  readonly reconnectAttempt: number;
  /**
   * Error from the last failed stream attempt, or `null` when healthy.
   *
   * Only set once auto-reconnect has exhausted its attempts (or for a
   * non-transient failure that is not retried). It stays `null` throughout
   * background reconnection so a recoverable hiccup never shows as an error.
   */
  readonly error: Error | null;
  /**
   * `true` when the stream opened but no first snapshot arrived within the
   * connect-timeout window, even after one silent self-heal. Distinct from
   * `error` (a thrown/closed stream that auto-reconnect retries): this is the
   * *silent* hang the retry loop can never observe. Surface an actionable
   * "the agent hasn't started — Retry" affordance wired to `reconnect()`.
   * Cleared by the next snapshot or a manual `reconnect()`. Never auto-aborts.
   */
  readonly connectTimedOut: boolean;
  /**
   * `true` when a non-terminal stream has produced no new snapshot for the
   * slow-stall window. Purely informational ("still working — taking longer
   * than usual"); cleared by the next snapshot. Never an error, never aborts.
   */
  readonly isSlow: boolean;
  /**
   * Reset error state and re-establish the stream subscription.
   *
   * The fallback after auto-reconnect exhausts, and a manual escape hatch in
   * any lifecycle state — error, complete, or mid-stream. Resets the retry
   * counter and preserves the last snapshot (no flash to empty). Uses the
   * `connectKey` counter pattern consistent with `refetch()` in other SDK hooks.
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
  /**
   * Automatically re-establish the subscription with exponential backoff
   * when a non-terminal stream drops (transport error, idle timeout, laptop
   * sleep). Defaults to `true`. Set `false` to opt out and surface every
   * drop as an immediate `error` for manual `reconnect()`.
   */
  readonly autoReconnect?: boolean;
  /**
   * Tune the auto-reconnect backoff schedule and attempt cap. Omitted fields
   * fall back to SDK defaults (base 1s, ×2, max 30s, 10 attempts).
   */
  readonly reconnectOptions?: BackoffOptions & {
    /** Max attempts before surfacing a terminal `error`. */
    readonly maxAttempts?: number;
  };
  /**
   * Hard connect-timeout in ms: how long the stream may stay `connecting`
   * (no first snapshot) before the watchdog self-heals once and then surfaces
   * `connectTimedOut`. Defaults to {@link DEFAULT_CONNECT_TIMEOUT_MS} (10s).
   */
  readonly connectTimeoutMs?: number;
  /**
   * Soft slow-stall threshold in ms: how long a non-terminal stream may go
   * without a new snapshot before `isSlow` flips on. Defaults to
   * {@link DEFAULT_SLOW_THRESHOLD_MS} (60s).
   */
  readonly slowThresholdMs?: number;
}

/**
 * Behavior hook that subscribes to real-time {@link AgentExecution}
 * updates via `stigmer.agentExecution.subscribe()`.
 *
 * Manages the full subscription lifecycle through a finite state
 * machine: connection establishment, rAF-coalesced snapshot streaming,
 * terminal-phase detection, automatic reconnection with exponential
 * backoff on transient drops, and manual reconnection as the fallback.
 *
 * **Resilience:** a non-terminal stream drop — whether a thrown transport
 * error (WebKit "Load failed", `fetch failed`, `Unavailable`) or a graceful
 * server close mid-run (idle timeout, load-balancer recycle) — is retried
 * automatically with backoff. The last snapshot stays visible
 * (`isReconnecting`), the access token is re-read on each attempt via the
 * per-request interceptor, and `error` is surfaced only once attempts are
 * exhausted. Completion is decided by the terminal phase, never by the
 * stream merely ending (a graceful close of a running execution reconnects
 * rather than falsely reporting "complete"). Opt out via `autoReconnect: false`.
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

  // -- Reconnect ------------------------------------------------------------
  const [connectKey, setConnectKey] = useState(0);

  // Self-heal-once guard for the connect-timeout watchdog. A ref so it survives
  // the reconnect that the watchdog itself triggers (the controller is reset on
  // every teardown and therefore cannot hold it). Reset only on a genuinely
  // fresh start — a new execution, a healthy snapshot, or a manual reconnect —
  // never on the watchdog's own self-heal hop, so the policy is exactly:
  // first silent timeout → reconnect once; second → surface.
  const connectAutoRetriedRef = useRef(false);

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
      onConnectTimeout() {
        if (connectAutoRetriedRef.current) {
          // Already self-healed once and still silent — surface an actionable
          // signal. The store dedupes, so this never causes a render storm.
          store.setConnectTimedOut(true);
        } else {
          // First silent timeout: re-establish the subscription once. Most
          // transient hangs (buffering proxy, cold start) clear on the retry.
          connectAutoRetriedRef.current = true;
          setConnectKey((k) => k + 1);
        }
      },
      setSlow(value) {
        store.setSlow(value);
      },
    };
    controllerRef.current = new StreamController(sink, undefined, undefined, {
      connectTimeoutMs: options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      slowThresholdMs: options?.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS,
    });
  }
  const controller = controllerRef.current;

  const reconnect = useCallback(() => {
    // A manual retry gives a fresh self-heal budget and clears the surfaced
    // timeout so the affordance disappears the instant the user acts.
    connectAutoRetriedRef.current = false;
    store.setConnectTimedOut(false);
    setConnectKey((k) => k + 1);
  }, [store]);

  // -- Stream rate instrumentation ------------------------------------------
  const streamRate = useStreamRate();
  const streamRateRef = useRef(streamRate);
  streamRateRef.current = streamRate;

  // -- Reconnect config (ref-backed so option identity churn never resubscribes)
  const autoReconnect = options?.autoReconnect ?? true;
  const reconnectOptions = options?.reconnectOptions;
  const configRef = useRef({ autoReconnect, reconnectOptions });
  configRef.current = { autoReconnect, reconnectOptions };

  // Tracks the execution the store currently holds, so we reset the store on
  // a genuine identity change (A → B) but preserve it across reconnects of the
  // SAME execution. Mirrors useWorkflowExecutionEventStream / useFetch.
  const prevExecutionIdRef = useRef<string | null>(null);

  // -- Subscription effect --------------------------------------------------
  // Note: controller, store, and streamRate are ref-backed stable objects —
  // they MUST NOT appear in the deps array. Including them would cause
  // infinite re-renders because useStreamRate returns a new object per render.
  useEffect(() => {
    if (!executionId) {
      controller.reset();
      store.reset();
      prevExecutionIdRef.current = null;
      connectAutoRetriedRef.current = false;
      return;
    }

    // Reset only when switching to a different execution. Crucially we do NOT
    // reset the store on reconnect (connectKey bump) or on cleanup — that
    // would wipe the conversation to an empty "Connecting…" on every retry.
    // The full-snapshot subscribe re-delivers the entire state on reconnect,
    // so keeping the last-known-good snapshot is both correct and seamless.
    if (
      prevExecutionIdRef.current !== null &&
      prevExecutionIdRef.current !== executionId
    ) {
      store.reset();
      // A genuinely different execution earns a fresh self-heal budget; the
      // bump that re-runs this effect on reconnect must NOT reset the guard.
      connectAutoRetriedRef.current = false;
    }
    prevExecutionIdRef.current = executionId;

    const abortController = new AbortController();
    const signal = abortController.signal;
    controller.start(executionId);

    (async () => {
      const { autoReconnect: auto, reconnectOptions: backoff } =
        configRef.current;
      const maxAttempts = backoff?.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;

      // 1-based count of consecutive failed attempts. Reset to 0 by any
      // successful snapshot, so each healthy stretch gets a fresh backoff
      // budget rather than inheriting the previous outage's attempt count.
      let attempt = 0;

      // Schedule the next retry after `error`, or stop. Returns `true` when
      // the loop should continue (a retry was scheduled), `false` when it
      // should exit (opted out, exhausted, or aborted). Shared by the
      // thrown-error and premature-end paths so both converge on one policy.
      const scheduleRetry = async (error: Error): Promise<boolean> => {
        if (!auto || attempt >= maxAttempts) {
          controller.handleError(error);
          return false;
        }
        attempt += 1;
        controller.handleReconnecting(attempt, error);
        try {
          await sleep(computeBackoffDelay(attempt, backoff), signal);
        } catch {
          return false; // aborted mid-backoff
        }
        return !signal.aborted;
      };

      while (!signal.aborted) {
        let sawTerminal = false;
        try {
          for await (const snapshot of stigmer.agentExecution.subscribe(
            executionId,
            signal,
          )) {
            if (signal.aborted) return;

            attempt = 0; // a snapshot proves the connection is healthy
            // The first snapshot also resolves the connect watchdog: clear any
            // surfaced timeout and refresh the self-heal budget for any future
            // silent stretch on this same execution.
            connectAutoRetriedRef.current = false;
            store.setConnectTimedOut(false);
            controller.handleSnapshot(snapshot);
            streamRateRef.current.tick(snapshot.status?.messages?.length ?? 0);

            const phase =
              snapshot.status?.phase ??
              ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
            if (isTerminalPhase(phase)) {
              sawTerminal = true;
              break;
            }
          }
        } catch (err) {
          if (signal.aborted) return;
          const error = toError(err);
          // Only known-transient transport noise is retried. A non-transient
          // error (not-found, invalid-argument, …) is deterministic — the
          // same request would fail identically, so surface it immediately.
          if (!auto || !isTransientStreamError(error)) {
            controller.handleError(error);
            return;
          }
          if (await scheduleRetry(error)) continue;
          return;
        }

        if (signal.aborted) return;

        if (sawTerminal) {
          // handleSnapshot already transitioned to `complete`; flush any
          // buffered frame and finish. Completion is decided by the terminal
          // phase, never by the stream merely ending.
          controller.handleStreamEnd();
          streamRateRef.current.summary();
          return;
        }

        // The iterator finished without a terminal phase: the server closed a
        // still-running stream (idle timeout, load-balancer recycle, pod
        // restart). This is transient by definition — reconnect and the next
        // full snapshot reconciles whatever changed (including, if it ended
        // meanwhile, the terminal state we missed).
        if (await scheduleRetry(new Error("The connection was interrupted."))) {
          continue;
        }
        return;
      }
    })();

    return () => {
      abortController.abort();
      controller.reset();
    };
  }, [executionId, stigmer, connectKey]);

  // -- Read from store via useSyncExternalStore ------------------------------
  const execution = useSyncExternalStore(store.subscribe, store.getExecution);
  const streamState = useSyncExternalStore(
    store.subscribe,
    store.getStreamState,
  );
  const connectTimedOut = useSyncExternalStore(
    store.subscribe,
    store.getConnectTimedOut,
  );
  const isSlow = useSyncExternalStore(store.subscribe, store.getSlow);

  // -- Derive public return values ------------------------------------------
  const phase = useMemo(
    () =>
      execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    [execution],
  );

  const isStreaming = streamState.stage === "streaming";
  const isConnecting = streamState.stage === "connecting";
  const isReconnecting = streamState.stage === "reconnecting";
  const reconnectAttempt =
    streamState.stage === "reconnecting" ? streamState.attempt : 0;
  const error = streamState.stage === "error" ? streamState.error : null;

  return {
    execution,
    phase,
    isStreaming,
    isConnecting,
    isReconnecting,
    reconnectAttempt,
    error,
    connectTimedOut,
    isSlow,
    reconnect,
  };
}
