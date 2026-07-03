"use client";

import { useMemo } from "react";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";

/**
 * Active task status returned by {@link useActiveTaskName}.
 *
 * `null` when no task is actively running or awaiting action.
 */
export interface ActiveTaskInfo {
  /** The task name that is currently active. */
  readonly taskName: string;
  /** The specific status: "running" or "waiting_approval". */
  readonly status: "running" | "waiting_approval";
  /** Duration in milliseconds (from DerivedTaskState). */
  readonly durationMs: number;
  /** Agent slug if this is an agent_call task. */
  readonly agentSlug: string;
  /** Current tool name if agent is using a tool. */
  readonly currentToolName: string;
  /** Number of concurrently running tasks (>1 for fork branches). */
  readonly concurrentCount: number;
}

/**
 * Pure derivation hook that selects the currently active task from the
 * task states map. Returns referentially stable output (string comparison,
 * not array/object reference) to avoid downstream re-renders.
 *
 * "Active" means either `running` or `waiting_approval` — both represent
 * states where the execution is at a specific task and the user cares
 * about its identity.
 *
 * When multiple tasks are running simultaneously (fork branches), returns
 * the first one found with a `concurrentCount` indicating parallelism.
 * The indicator UI can use this to show "N tasks running in parallel".
 */
export function useActiveTaskName(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): ActiveTaskInfo | null {
  return useMemo(() => {
    let firstRunning: ActiveTaskInfo | null = null;
    let runningCount = 0;

    for (const [name, state] of taskStates) {
      if (state.status === "waiting_approval") {
        // Waiting approval takes priority — it's an actionable state
        return {
          taskName: name,
          status: "waiting_approval",
          durationMs: state.durationMs,
          agentSlug: state.agentSlug,
          currentToolName: state.currentToolName,
          concurrentCount: 1,
        };
      }

      if (state.status === "running") {
        runningCount++;
        if (!firstRunning) {
          firstRunning = {
            taskName: name,
            status: "running",
            durationMs: state.durationMs,
            agentSlug: state.agentSlug,
            currentToolName: state.currentToolName,
            concurrentCount: 1,
          };
        }
      }
    }

    if (firstRunning && runningCount > 1) {
      return { ...firstRunning, concurrentCount: runningCount };
    }

    return firstRunning;
  }, [taskStates]);
}
