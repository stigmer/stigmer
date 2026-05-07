"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link SetupProgress}. */
export interface SetupProgressProps {
  /**
   * Workspace entries from the session spec. When git-sourced entries
   * are present, the fallback indicator shows workspace-specific messaging
   * (e.g. "Setting up workspace...").
   */
  readonly workspaceEntries?: readonly WorkspaceEntry[];
  /**
   * Server-reported setup phase label from
   * `AgentExecutionStatus.setup_progress.current_phase`.
   *
   * When non-empty, rendered directly — the timer-based fallback is
   * bypassed.  When absent or empty (older backends that don't emit
   * setup progress), the component falls back to the time-based
   * step sequence derived from `workspaceEntries`.
   */
  readonly serverPhase?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/* ── Timer-based fallback (used when no serverPhase is available) ─── */

interface SetupStep {
  readonly message: string;
  readonly durationMs: number;
}

const STEP_INTERVAL_MS = 4000;

function buildSteps(
  workspaceEntries: readonly WorkspaceEntry[] | undefined,
): SetupStep[] {
  const hasGitRepo = workspaceEntries?.some(
    (e) => e.source?.source.case === "gitRepo",
  );

  const steps: SetupStep[] = [
    { message: "Initializing execution\u2026", durationMs: STEP_INTERVAL_MS },
  ];

  if (hasGitRepo) {
    steps.push({
      message: "Setting up workspace\u2026",
      durationMs: STEP_INTERVAL_MS,
    });
  }

  steps.push(
    {
      message: "Preparing agent environment\u2026",
      durationMs: STEP_INTERVAL_MS,
    },
    { message: "Almost ready\u2026", durationMs: STEP_INTERVAL_MS },
  );

  return steps;
}

/**
 * Animated inline indicator shown in the message thread while an
 * execution is in the `PENDING` phase and no AI messages have arrived.
 *
 * **Server-driven mode** — when the backend reports
 * `setup_progress.current_phase` through the execution stream, the
 * component renders the server-reported label directly.
 *
 * **Timer-based fallback** — when `serverPhase` is absent (older
 * backends), the component cycles through contextual status messages
 * derived from the session configuration on a fixed interval.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Server-driven (preferred)
 * <SetupProgress serverPhase={execution.status?.setupProgress?.currentPhase} />
 *
 * // Fallback (no server phase available)
 * <SetupProgress workspaceEntries={session.spec?.workspaceEntries} />
 * ```
 */
export const SetupProgress = memo(function SetupProgress({
  workspaceEntries,
  serverPhase,
  className,
}: SetupProgressProps) {
  const useServerPhase = !!serverPhase;

  /* ── Timer-based fallback state ─────────────────────────────────── */
  const steps = useMemo(() => buildSteps(workspaceEntries), [workspaceEntries]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
  }, [steps]);

  useEffect(() => {
    if (useServerPhase) return;
    if (stepIndex >= steps.length - 1) return;

    const timer = setTimeout(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, steps[stepIndex].durationMs);

    return () => clearTimeout(timer);
  }, [useServerPhase, stepIndex, steps]);

  /* ── Resolve display message ────────────────────────────────────── */
  const currentMessage =
    serverPhase || steps[Math.min(stepIndex, steps.length - 1)].message;

  return (
    <div
      role="status"
      aria-label={currentMessage}
      className={cn("flex items-center gap-2.5 px-4 py-2", className)}
    >
      <PulseIndicator />
      <span className="text-sm text-muted-foreground animate-in fade-in duration-300">
        {currentMessage}
      </span>
    </div>
  );
});

function PulseIndicator() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground" />
    </span>
  );
}
