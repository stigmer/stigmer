"use client";

import { useEffect, useRef, useState } from "react";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store";

/**
 * Behavior hook that generates screen reader announcements when task
 * execution states change. Diffs the `taskStates` map on each update
 * and produces human-readable announcement strings.
 *
 * Returns the latest announcement string for rendering in an
 * `aria-live="polite"` region. The string changes on each new event,
 * allowing the live region to announce it.
 */
export function useExecutionAnnouncements(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
): string {
  const [announcement, setAnnouncement] = useState("");
  const prevStatesRef = useRef<ReadonlyMap<string, DerivedTaskState>>(new Map());

  useEffect(() => {
    const prev = prevStatesRef.current;
    const announcements: string[] = [];

    for (const [name, state] of taskStates) {
      const prevState = prev.get(name);
      const prevStatus = prevState?.status;

      if (prevStatus === state.status) continue;

      switch (state.status) {
        case "running":
          announcements.push(`Task ${name} started`);
          break;
        case "completed":
          announcements.push(`Task ${name} completed`);
          break;
        case "failed":
          announcements.push(
            state.error
              ? `Task ${name} failed: ${state.error.slice(0, 80)}`
              : `Task ${name} failed`,
          );
          break;
        case "waiting_approval":
          announcements.push(`Approval required for task ${name}`);
          break;
        case "retrying":
          announcements.push(`Task ${name} retrying, attempt ${state.attemptNumber}`);
          break;
      }
    }

    if (announcements.length > 0) {
      setAnnouncement(announcements.join(". "));
    }

    prevStatesRef.current = taskStates;
  }, [taskStates]);

  return announcement;
}
