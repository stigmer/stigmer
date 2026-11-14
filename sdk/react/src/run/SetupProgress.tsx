"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { formatElapsed, SANDBOX_WAIT_PHRASE } from "@stigmer/client";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link SetupProgress}. */
export interface SetupProgressProps {
  /**
   * The server's setup phase, `RunStatus.setup_progress.current_phase`:
   * shown as it is while the run starts. Absent or empty, the line says
   * "Starting".
   */
  readonly serverPhase?: string;
  /**
   * `true` once the run is past starting and waits on the agent's first
   * words: the line says "Thinking".
   */
  readonly isAwaitingResponse?: boolean;
  /**
   * How long the run has waited for a sandbox with room, as the server
   * measured it when its newest liveness said so
   * (`TurnLiveness.awaitingSandboxMs`). Set, the line says "Waiting for a
   * sandbox · 1m 20s", counting on from the moment the value arrived; it
   * leads the server's phase.
   */
  readonly awaitingSandboxMs?: number;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The one live line a turn shows before the agent's first words, in the
 * step rows' look (a 12px spinner, 14/20, the live sweep): while every
 * sandbox is busy, how long the run has waited for one; else the server's
 * phase while the run starts, else "Starting"; "Thinking" once the run
 * waits on its first words. It says only what the run records; the one
 * thing that counts is the wait the server measured.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
 * import type { Turn } from "@stigmer/client";
 *
 * // The server's phase, while the run is pending, and its wait for a sandbox.
 * function RunSetup({ run, turn }: { run: Run; turn: Turn }) {
 *   return (
 *     <SetupProgress
 *       serverPhase={run.status?.setupProgress?.currentPhase}
 *       awaitingSandboxMs={turn.liveness?.awaitingSandboxMs}
 *     />
 *   );
 * }
 * ```
 */
export const SetupProgress = memo(function SetupProgress({
  serverPhase,
  isAwaitingResponse,
  awaitingSandboxMs,
  className,
}: SetupProgressProps) {
  const waitedMs = useCountingOn(isAwaitingResponse ? undefined : awaitingSandboxMs);
  // The label names the state without its count, so a reader is told what
  // the run waits for once, not each second.
  const label = isAwaitingResponse ? "Thinking" : waitedMs !== undefined ? SANDBOX_WAIT_PHRASE : serverPhase || "Starting";
  const words = waitedMs !== undefined ? `${SANDBOX_WAIT_PHRASE} · ${formatElapsed(waitedMs)}` : label;
  return (
    <div role="status" aria-label={label} className={cn("stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-sm", className)}>
      <SpinnerIcon size={12} className="stg:shrink-0 stg:text-muted-foreground stg:motion-reduce:animate-none" />
      {/* The line exists only while the run is live, so it always carries
          the ambient-liveness sweep (stigmer#277); the shimmer owns the colour. */}
      <span className="stgm-shimmer-label">{words}</span>
    </div>
  );
});

/**
 * A span the sender measured, counting on once a second from when this value
 * arrived (each new value restarts the count from itself); undefined while
 * none is given.
 */
function useCountingOn(sentMs: number | undefined): number | undefined {
  // When the value now shown arrived; a value not yet marked counts from itself.
  const [mark, setMark] = useState<{ readonly sentMs: number | undefined; readonly at: number }>(() => ({ sentMs, at: Date.now() }));
  const [now, setNow] = useState(mark.at);
  useEffect(() => {
    if (sentMs === undefined) return;
    const at = Date.now();
    setMark({ sentMs, at });
    setNow(at);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sentMs]);
  if (sentMs === undefined) return undefined;
  return mark.sentMs === sentMs ? sentMs + Math.max(0, now - mark.at) : sentMs;
}
