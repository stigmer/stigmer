"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ALL_SESSION_PREVIEWS, followSession, type SessionFold } from "@stigmer/client";
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

/** Return value of {@link useSessionEvents}. */
export interface UseSessionEventsReturn {
  /**
   * The session's events, folded: its turns, each turn's items, asks, to-dos
   * and file reviews, and the session's own status. `null` before the first
   * events arrive. Objects no event touched keep their reference from one
   * fold to the next, so memoized rows skip re-renders.
   */
  readonly fold: SessionFold | null;
  /** `true` while the follow is open and has delivered events. */
  readonly isStreaming: boolean;
  /** `true` after the follow starts and before its first event arrives. */
  readonly isConnecting: boolean;
  /**
   * `true` while a dropped stream is being reconnected in the background.
   * The last fold stays visible and `error` stays `null`.
   */
  readonly isReconnecting: boolean;
  /** 1-based count of the reconnect in flight; `0` when not reconnecting. */
  readonly reconnectAttempt: number;
  /**
   * Why the follow ended: the server refused it (not found, permission
   * denied, ...), or the stream kept dropping until the reconnect attempts
   * ran out. `null` while healthy or reconnecting.
   */
  readonly error: Error | null;
  /**
   * `true` when the follow opened but nothing arrived within the
   * connect-timeout window, even after one silent reconnect. Cleared by the
   * next event or a manual {@link reconnect}.
   */
  readonly connectTimedOut: boolean;
  /**
   * `true` when the follow has delivered nothing for the slow-stall window
   * while the session's newest turn is working. Informational only.
   */
  readonly isSlow: boolean;
  /**
   * Re-open the follow, resuming after the newest event already folded (the
   * conversation stays on screen). The way back from an error, and a manual
   * escape hatch in any state.
   */
  readonly reconnect: () => void;
}

/** Options for {@link useSessionEvents}. */
export interface UseSessionEventsOptions {
  /**
   * The store to fold into. `useSessionConversation` passes its own so the
   * store outlives its consumers' renders; omitted, the hook keeps a private
   * one.
   */
  readonly store?: ConversationStore;
  /**
   * Reconnect a dropped stream automatically, with backoff. Defaults to
   * `true`. `false` surfaces the first drop as `error` for a manual
   * {@link UseSessionEventsReturn.reconnect}.
   */
  readonly autoReconnect?: boolean;
  /**
   * The reconnect backoff (full jitter) and the attempts allowed before the
   * drop is surfaced as `error`. A delivered event resets the count.
   */
  readonly reconnectOptions?: BackoffOptions & {
    /** Reconnects allowed in a row before surfacing an error. */
    readonly maxAttempts?: number;
  };
  /**
   * How long (ms) the follow may deliver nothing before the watchdog
   * reconnects once, then surfaces `connectTimedOut`. Defaults to
   * {@link DEFAULT_CONNECT_TIMEOUT_MS}.
   */
  readonly connectTimeoutMs?: number;
  /**
   * How long (ms) a working turn may go without an event before `isSlow`.
   * Defaults to {@link DEFAULT_SLOW_THRESHOLD_MS}.
   */
  readonly slowThresholdMs?: number;
}

/** The error a follow ends with when its reconnects ran out. */
const INTERRUPTED_MESSAGE = "The connection to the conversation was interrupted.";

/**
 * Behavior hook that follows one session's event log and folds it: the whole
 * stored log first, then each event as it is appended, plus the live
 * previews (a message as it is written, a thinking as it starts, a running
 * tool's output). One `followSession` per session, from `@stigmer/client`.
 *
 * - Frames fold into the store as they arrive and publish at most once per
 *   animation frame, inside `startTransition`, so a long replay or a burst
 *   of token previews never blocks typing.
 * - A dropped stream reconnects from the last event it delivered, with
 *   jittered backoff; the conversation stays visible (`isReconnecting`).
 * - A refusal (the session is gone, access was withdrawn) ends the follow
 *   with `error`.
 * - A follow that opens and stays silent is reconnected once, then
 *   `connectTimedOut` is surfaced.
 *
 * A session follow never completes on its own: a turn ending is read from
 * the fold (`Turn.ended`), never from the stream.
 *
 * Pass `null` to follow nothing. A new id resets the fold.
 *
 * @example
 * ```tsx
 * const { fold, isReconnecting } = useSessionEvents(sessionId);
 * const turns = fold?.turns ?? [];
 * ```
 */
export function useSessionEvents(
  sessionId: string | null,
  options?: UseSessionEventsOptions,
): UseSessionEventsReturn {
  const stigmer = useStigmer();

  const internalStoreRef = useRef<ConversationStore | null>(null);
  if (!options?.store && !internalStoreRef.current) {
    internalStoreRef.current = new ConversationStore();
  }
  const store = options?.store ?? internalStoreRef.current!;

  // Bumped to re-open the follow (a manual reconnect, the watchdog's one
  // silent reconnect).
  const [connectKey, setConnectKey] = useState(0);

  // The watchdog's reconnect-once guard. A ref so it survives the reconnect
  // the watchdog itself triggers; reset by a delivered event, a manual
  // reconnect or another session.
  const connectAutoRetriedRef = useRef(false);

  const controllerRef = useRef<StreamController | null>(null);
  if (!controllerRef.current) {
    const sink: StreamControllerSink = {
      applyFrame(frame) {
        return store.applyFrame(frame);
      },
      publish() {
        startTransition(() => {
          store.publish();
        });
      },
      setStreamState(state) {
        startTransition(() => {
          store.setStreamState(state);
        });
      },
      onConnectTimeout() {
        if (connectAutoRetriedRef.current) {
          store.setConnectTimedOut(true);
        } else {
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
    connectAutoRetriedRef.current = false;
    store.setConnectTimedOut(false);
    setConnectKey((k) => k + 1);
  }, [store]);

  const streamRate = useStreamRate();
  const streamRateRef = useRef(streamRate);
  streamRateRef.current = streamRate;

  // Option identity churn never re-opens the follow: the loop reads the
  // latest values through a ref.
  const autoReconnect = options?.autoReconnect ?? true;
  const reconnectOptions = options?.reconnectOptions;
  const configRef = useRef({ autoReconnect, reconnectOptions });
  configRef.current = { autoReconnect, reconnectOptions };

  // The session the store holds, so another session resets it while a
  // reconnect of the same one keeps the conversation on screen.
  const prevSessionIdRef = useRef<string | null>(null);

  // controller, store and streamRate are ref-backed and deliberately absent
  // from the dependencies: useStreamRate returns a new object per render.
  useEffect(() => {
    if (!sessionId) {
      controller.reset();
      store.reset();
      prevSessionIdRef.current = null;
      connectAutoRetriedRef.current = false;
      return;
    }
    if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== sessionId) {
      store.reset();
      connectAutoRetriedRef.current = false;
    }
    prevSessionIdRef.current = sessionId;

    const abort = new AbortController();
    const { autoReconnect: auto, reconnectOptions: backoff } = configRef.current;
    const maxAttempts = backoff?.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;
    // Reconnects since the last delivered event.
    let attempt = 0;
    let exhausted = false;
    let frames = 0;
    controller.start(sessionId);

    (async () => {
      try {
        for await (const frame of followSession(stigmer, sessionId, {
          signal: abort.signal,
          previews: ALL_SESSION_PREVIEWS,
          afterSeq: store.lastSeq,
          // followSession waits here before each reconnect: the seam where
          // the drop becomes visible and the attempt budget is spent.
          sleep: async (_ms, signal) => {
            attempt += 1;
            if (!auto || attempt > maxAttempts) {
              exhausted = true;
              abort.abort();
              return;
            }
            controller.handleReconnecting(attempt);
            try {
              await sleep(computeBackoffDelay(attempt, backoff), signal);
            } catch {
              // Aborted mid-wait: the follow ends on its own.
            }
          },
        })) {
          attempt = 0;
          connectAutoRetriedRef.current = false;
          store.setConnectTimedOut(false);
          controller.handleFrame(frame);
          frames += 1;
          streamRateRef.current.tick(frames);
        }
        if (exhausted) {
          controller.handleError(new Error(INTERRUPTED_MESSAGE));
        }
      } catch (err) {
        // A refusal ends the follow (followSession returns quietly when
        // stopped, so a throw is never a teardown).
        controller.handleError(toError(err));
      }
    })();

    return () => {
      abort.abort();
      controller.reset();
    };
  }, [sessionId, stigmer, connectKey]);

  const fold = useSyncExternalStore(store.subscribe, store.getFold);
  const streamState = useSyncExternalStore(store.subscribe, store.getStreamState);
  const connectTimedOut = useSyncExternalStore(store.subscribe, store.getConnectTimedOut);
  const quiet = useSyncExternalStore(store.subscribe, store.getSlow);

  // A quiet idle session is not slow: only a turn that is working is.
  const newest = fold?.turns.at(-1);
  const working =
    newest !== undefined &&
    !newest.ended &&
    (newest.status === undefined || newest.status.phase === "pending" || newest.status.phase === "running");

  return {
    fold,
    isStreaming: streamState.stage === "streaming",
    isConnecting: streamState.stage === "connecting",
    isReconnecting: streamState.stage === "reconnecting",
    reconnectAttempt: streamState.stage === "reconnecting" ? streamState.attempt : 0,
    error: streamState.stage === "error" ? streamState.error : null,
    connectTimedOut,
    isSlow: quiet && working,
    reconnect,
  };
}
