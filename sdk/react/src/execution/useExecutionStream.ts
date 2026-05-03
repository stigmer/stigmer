"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import { useStreamRate } from "../internal/dev";
import { isTerminalPhase } from "./execution-phases";

/** Return value of {@link useExecutionStream}. */
export interface UseExecutionStreamReturn {
  /** Latest full execution snapshot from the stream, or `null` before the first update arrives. */
  readonly execution: AgentExecution | null;
  /**
   * Convenience extraction of `execution.status.phase`.
   *
   * Derived from `execution` via `useMemo` — always consistent with the
   * current snapshot. Returns `EXECUTION_PHASE_UNSPECIFIED` when
   * `execution` is `null`.
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
 * Behavior hook that subscribes to real-time {@link AgentExecution}
 * updates via `stigmer.agentExecution.subscribe()`.
 *
 * Manages the full subscription lifecycle: connection establishment,
 * snapshot streaming, terminal-phase detection, error handling, and
 * manual reconnection. Each server message replaces the previous
 * snapshot atomically — no delta merging.
 *
 * Pass `null` to skip subscribing (stable no-op). When `executionId`
 * changes, the previous subscription is aborted and a fresh one begins.
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
): UseExecutionStreamReturn {
  const stigmer = useStigmer();

  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [connectKey, setConnectKey] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const streamRate = useStreamRate();

  const reconnect = useCallback(() => {
    setError(null);
    setConnectKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!executionId) {
      setExecution(null);
      setIsConnecting(false);
      setIsStreaming(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setExecution(null);
    setIsConnecting(true);
    setIsStreaming(false);
    setError(null);

    (async () => {
      try {
        for await (const snapshot of stigmer.agentExecution.subscribe(
          executionId,
          controller.signal,
        )) {
          if (controller.signal.aborted) return;

          const currentPhase =
            snapshot.status?.phase ??
            ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
          const isTerminal = isTerminalPhase(currentPhase);

          setExecution(snapshot);
          setIsConnecting(false);
          setIsStreaming(!isTerminal);
          streamRate.tick(snapshot.status?.messages?.length ?? 0);

          if (isTerminal) break;
        }

        if (!controller.signal.aborted) {
          setIsStreaming(false);
          streamRate.summary();
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(toError(err));
        setIsConnecting(false);
        setIsStreaming(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [executionId, stigmer, connectKey]);

  const phase = useMemo(
    () =>
      execution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    [execution],
  );

  return { execution, phase, isStreaming, isConnecting, error, reconnect };
}
