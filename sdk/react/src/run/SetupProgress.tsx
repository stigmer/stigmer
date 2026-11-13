"use client";

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
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
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The one live line a turn shows before the agent's first words, in the
 * step rows' look (a 12px spinner, 14/20, the live sweep): the server's
 * phase while the run starts, else "Starting"; "Thinking" once the run
 * waits on its first words. It says only what the run records; nothing
 * cycles on a timer.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
 *
 * // The server's phase, while the run is pending.
 * function RunSetup({ run }: { run: Run }) {
 *   return <SetupProgress serverPhase={run.status?.setupProgress?.currentPhase} />;
 * }
 * ```
 */
export const SetupProgress = memo(function SetupProgress({
  serverPhase,
  isAwaitingResponse,
  className,
}: SetupProgressProps) {
  const words = isAwaitingResponse ? "Thinking" : serverPhase || "Starting";
  return (
    <div role="status" aria-label={words} className={cn("stg:mx-4 stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-sm", className)}>
      <SpinnerIcon size={12} className="stg:shrink-0 stg:text-muted-foreground stg:motion-reduce:animate-none" />
      {/* The line exists only while the run is live, so it always carries
          the ambient-liveness sweep (stigmer#277); the shimmer owns the colour. */}
      <span className="stgm-shimmer-label">{words}</span>
    </div>
  );
});
