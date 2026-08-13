"use client";

import { useEffect, useRef } from "react";
import type { DerivedTaskState } from "../internal/store/workflow-execution-event-store.js";

/**
 * Tasks that crossed the `waiting_approval` boundary in one commit of the
 * derived task-state map, in the map's (first-started) order.
 */
export interface ApprovalBoundaryCrossing {
  /** Task names that transitioned INTO `waiting_approval` (a gate opened). */
  readonly entered: readonly string[];
  /** Task names that transitioned OUT of `waiting_approval` (a gate resolved). */
  readonly exited: readonly string[];
}

/**
 * Behavior hook that watches the live derived task-state map and reports
 * when any task crosses the `waiting_approval` boundary — the client-side
 * mirror of the stream's `approval_requested` / `approval_resolved` events.
 *
 * Why this exists: the execution SNAPSHOT (`status.pending_approvals` /
 * `status.pending_file_reviews`) is fetched once and carries the gate
 * payloads, while the event STREAM is live but carries only task status.
 * A boundary crossing is precisely the moment the snapshot goes stale, so
 * consumers refetch it then — derived-over-stored: the stream is the
 * signal, the snapshot stays the single source for gate payloads. The
 * `WorkflowExecutionViewer` additionally auto-selects a newly gated task so
 * the decision surface (the panel's Inspect Approval tab) is never hidden
 * while the run is blocked.
 *
 * Same diffing shape as `useExecutionAnnouncements` (prev-map ref,
 * diff on each map commit). A task first observed already in
 * `waiting_approval` counts as entered — with rAF-coalesced commits the
 * running→waiting transition can collapse into the task's first appearance.
 *
 * `enabled` gates the CALLBACK, not the tracking: state is tracked even
 * while disabled so enabling later never replays stale crossings. Keep it
 * `false` for terminal executions — their event-history replay crosses the
 * boundary for long-decided gates.
 */
export function useApprovalBoundary(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
  enabled: boolean,
  onCrossing: (crossing: ApprovalBoundaryCrossing) => void,
): void {
  const prevStatesRef = useRef<ReadonlyMap<string, DerivedTaskState>>(new Map());
  // Render-synced ref so the diff effect never re-runs (and never fires
  // spuriously) because a consumer passed a fresh callback identity.
  const onCrossingRef = useRef(onCrossing);
  onCrossingRef.current = onCrossing;

  useEffect(() => {
    const prev = prevStatesRef.current;
    prevStatesRef.current = taskStates;
    if (!enabled) return;

    const entered: string[] = [];
    const exited: string[] = [];

    for (const [name, state] of taskStates) {
      const prevStatus = prev.get(name)?.status;
      if (prevStatus === state.status) continue;
      if (state.status === "waiting_approval") entered.push(name);
      else if (prevStatus === "waiting_approval") exited.push(name);
    }

    if (entered.length > 0 || exited.length > 0) {
      onCrossingRef.current({ entered, exited });
    }
  }, [taskStates, enabled]);
}
