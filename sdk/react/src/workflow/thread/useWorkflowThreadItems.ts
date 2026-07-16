"use client";

import { useRef } from "react";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import {
  projectThreadItems,
  type WorkflowThreadProjection,
} from "./project-thread-items.js";

/**
 * Behavior hook binding {@link projectThreadItems} to a render loop with
 * structural sharing: items whose fields did not change keep their object
 * identity across event appends, so memoized card rows bail (DD-010).
 *
 * The projection is cheap (one pass over the task map), so it recomputes
 * per render of the (memoized) thread organism rather than adding a
 * `useMemo` whose dependency — the store's `taskStates` — changes identity
 * on every event append anyway. The ref carries only the previous items
 * for identity reuse; it holds no state of its own (single source of truth
 * stays the store).
 */
export function useWorkflowThreadItems(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
  totalTasks: number,
): WorkflowThreadProjection {
  const previousItemsRef = useRef<WorkflowThreadProjection["items"]>([]);
  const projection = projectThreadItems(
    taskStates,
    totalTasks,
    previousItemsRef.current,
  );
  previousItemsRef.current = projection.items;
  return projection;
}
