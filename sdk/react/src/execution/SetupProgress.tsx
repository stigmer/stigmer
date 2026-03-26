"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";

export interface SetupProgressProps {
  /**
   * Workspace entries from the session spec. When git-sourced entries
   * are present, the indicator shows workspace-specific messaging
   * (e.g. "Setting up workspace...") to match the backend's actual
   * setup sequence.
   */
  readonly workspaceEntries?: readonly WorkspaceEntry[];
  readonly className?: string;
}

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
 * Cycles through contextual status messages derived from the session
 * configuration (workspace entries, etc.) to communicate that the
 * backend is actively setting up the sandbox, cloning repositories,
 * merging environment variables, loading skills, and connecting MCP
 * servers.
 *
 * Uses time-based progression that approximates the backend's actual
 * setup sequence. A future backend-enriched phase (surfacing real
 * setup phase labels through the execution stream) can replace the
 * timer with server-reported progress.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <SetupProgress workspaceEntries={session.spec?.workspaceEntries} />
 * ```
 */
export function SetupProgress({
  workspaceEntries,
  className,
}: SetupProgressProps) {
  const steps = useMemo(() => buildSteps(workspaceEntries), [workspaceEntries]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
  }, [steps]);

  useEffect(() => {
    if (stepIndex >= steps.length - 1) return;

    const timer = setTimeout(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, steps[stepIndex].durationMs);

    return () => clearTimeout(timer);
  }, [stepIndex, steps]);

  const currentMessage = steps[Math.min(stepIndex, steps.length - 1)].message;

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
}

function PulseIndicator() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground" />
    </span>
  );
}
