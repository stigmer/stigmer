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
  /**
   * When `true`, the execution has moved past `PENDING` into
   * `IN_PROGRESS` but the agent has not yet produced any AI messages.
   * Renders a static "Thinking\u2026" label instead of the setup
   * phase sequence or server-reported phase.
   */
  readonly isAwaitingResponse?: boolean;
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
 * execution has not yet produced AI messages.
 *
 * Operates in three modes (highest-priority first):
 *
 * 1. **Awaiting response** — `isAwaitingResponse` is `true`. The
 *    execution has moved past `PENDING` into `IN_PROGRESS` but no AI
 *    messages have arrived yet. Shows a static "Thinking\u2026" label.
 *
 * 2. **Server-driven** — `serverPhase` is non-empty. Renders the
 *    server-reported `setup_progress.current_phase` label directly.
 *
 * 3. **Timer-based fallback** — neither of the above. Cycles through
 *    contextual status messages derived from `workspaceEntries`.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Awaiting response (IN_PROGRESS, no messages yet)
 * <SetupProgress isAwaitingResponse />
 *
 * // Server-driven (preferred during PENDING)
 * <SetupProgress serverPhase={execution.status?.setupProgress?.currentPhase} />
 *
 * // Timer fallback (PENDING, no server phase available)
 * <SetupProgress workspaceEntries={session.spec?.workspaceEntries} />
 * ```
 */
export const SetupProgress = memo(function SetupProgress({
  workspaceEntries,
  serverPhase,
  isAwaitingResponse,
  className,
}: SetupProgressProps) {
  const useServerPhase = !isAwaitingResponse && !!serverPhase;

  /* ── Timer-based fallback state ─────────────────────────────────── */
  const steps = useMemo(() => buildSteps(workspaceEntries), [workspaceEntries]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
  }, [steps]);

  useEffect(() => {
    if (isAwaitingResponse || useServerPhase) return;
    if (stepIndex >= steps.length - 1) return;

    const timer = setTimeout(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, steps[stepIndex].durationMs);

    return () => clearTimeout(timer);
  }, [isAwaitingResponse, useServerPhase, stepIndex, steps]);

  /* ── Resolve display message ────────────────────────────────────── */
  let currentMessage: string;
  if (isAwaitingResponse) {
    currentMessage = "Thinking\u2026";
  } else if (serverPhase) {
    currentMessage = serverPhase;
  } else {
    currentMessage = steps[Math.min(stepIndex, steps.length - 1)].message;
  }

  return (
    <div
      role="status"
      aria-label={currentMessage}
      className={cn("stg:flex stg:items-center stg:gap-2.5 stg:px-4 stg:py-2", className)}
    >
      <PulseIndicator />
      <span className="stg:text-sm stg:text-muted-foreground stg:animate-in stg:fade-in stg:duration-300">
        {currentMessage}
      </span>
    </div>
  );
});

function PulseIndicator() {
  return (
    <span className="stg:relative stg:flex stg:h-2 stg:w-2 stg:shrink-0" aria-hidden="true">
      <span className="stg:absolute stg:inline-flex stg:h-full stg:w-full stg:animate-ping stg:rounded-full stg:bg-muted-foreground stg:opacity-75" />
      <span className="stg:relative stg:inline-flex stg:h-2 stg:w-2 stg:rounded-full stg:bg-muted-foreground" />
    </span>
  );
}
