"use client";

// Execution-level file-change rollup for the workflow panel's Changes facet.
// Domain: workflow (the Changes-facet analog of useWorkflowRunArtifacts).
//
// Unlike Artifacts (a server-side aggregate: `artifact.listByExecution`) and
// Usage (server-emitted budget checkpoints), file changes have NO parent-level
// aggregate BY DESIGN: the server keeps diffs single-sourced on each child
// AgentRun and surfaces only references from the parent (see
// `WorkflowRunStatus.pending_file_reviews`). So this hook dereferences
// the children client-side — the same reference→dereference architecture as
// `WorkflowFileReviewList`, generalized from "pending gates" to the settled
// net rollup, with a one-shot `get()` per child instead of a live stream
// (the rollup needs task-boundary freshness, not token-level liveness).
// Should a server rollup ever land, it can replace the fan-out behind this
// hook's plain `FileChange[]` seam without touching consumers.

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { deriveRunFileChanges } from "../run/deriveRunFileChanges.js";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { DerivedTaskState } from "../internal/store/workflow-run-event-store.js";

// ---------------------------------------------------------------------------
// Enumeration (pure — exported for tests)
// ---------------------------------------------------------------------------

/** One AGENT_CALL task's child run, as enumerated for the rollup. */
export interface AgentCallChild {
  /** Name of the owning workflow task. */
  readonly taskName: string;
  /** The child AgentRun id (`aex_*`). */
  readonly childRunId: string;
  /**
   * `true` once the owning task has settled (completed/failed/skipped) — the
   * child's file changes are final and will never change again.
   */
  readonly settled: boolean;
}

const SETTLED_TASK_STATUSES: ReadonlySet<DerivedTaskState["status"]> = new Set([
  "completed",
  "failed",
  "skipped",
]);

const SETTLED_SNAPSHOT_STATUSES: ReadonlySet<WorkflowTaskStatus> = new Set([
  WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
  WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
  WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED,
]);

/**
 * Enumerates the AGENT_CALL children of a workflow run in
 * task-chronological order, deduplicated by child run id.
 *
 * **Ordering is a correctness input downstream**: two agent-call tasks can
 * edit the same path, and `deriveRunFileChanges` anchors each path's
 * net diff on its first and last change — so children must be visited in the
 * order their tasks ran.
 *
 * Two sources, mirroring `buildAgentCall` in the run inspector:
 *
 * 1. **Event-derived task states** (primary). `DerivedTaskState.childRunId`
 *    is populated from `agentCallStarted`/`agentCallProgress` events, and the
 *    map's insertion order follows first-event order — i.e. task chronology.
 * 2. **Snapshot task metadata** (fallback — load-bearing, not decorative).
 *    `execution.status.tasks[].metadata.agent_run_id` covers tasks whose
 *    events are absent: the viewer's fallback task states (built when event
 *    persistence failed) hardcode `childRunId: ""`, so for those runs
 *    the snapshot is the ONLY id source. The dedupe therefore keys on tasks
 *    that actually CONTRIBUTED an id from events — an event-known task with
 *    an empty id must still resolve through its snapshot, or the fallback
 *    would never fire at all. Snapshot-resolved entries are appended after
 *    event-derived ones, ordered among themselves by `startedAt` (in the
 *    pure-fallback case that IS the chronological order; in the transient
 *    mixed case — a running task whose `agentCallStarted` event hasn't
 *    arrived yet — the tail position is an approximation the next event
 *    corrects). Settled-ness prefers the live event status when the task is
 *    known to events, falling back to the snapshot status.
 */
export function enumerateAgentCallChildren(
  taskStates: ReadonlyMap<string, DerivedTaskState>,
  taskSnapshots: readonly WorkflowTask[] | undefined,
): readonly AgentCallChild[] {
  const children: AgentCallChild[] = [];
  const seenIds = new Set<string>();
  const tasksWithEventIds = new Set<string>();

  for (const state of taskStates.values()) {
    if (!state.childRunId || seenIds.has(state.childRunId)) continue;
    seenIds.add(state.childRunId);
    tasksWithEventIds.add(state.taskName);
    children.push({
      taskName: state.taskName,
      childRunId: state.childRunId,
      settled: SETTLED_TASK_STATUSES.has(state.status),
    });
  }

  if (!taskSnapshots || taskSnapshots.length === 0) return children;

  const fromSnapshots: Array<AgentCallChild & { readonly startedAt: string }> = [];
  for (const task of taskSnapshots) {
    if (!task.taskName || tasksWithEventIds.has(task.taskName)) continue;
    // Only agent-call tasks carry an agent_run_id in their metadata —
    // presence of the id IS the discriminator (same read as the inspector's
    // snapshot fallback).
    const meta = task.metadata as unknown as Record<string, unknown> | undefined;
    const childId = meta?.agent_run_id;
    if (typeof childId !== "string" || !childId || seenIds.has(childId)) continue;
    seenIds.add(childId);
    const eventState = taskStates.get(task.taskName);
    fromSnapshots.push({
      taskName: task.taskName,
      childRunId: childId,
      settled: eventState
        ? SETTLED_TASK_STATUSES.has(eventState.status)
        : SETTLED_SNAPSHOT_STATUSES.has(task.status),
      startedAt: task.startedAt ?? "",
    });
  }

  // RFC 3339 UTC timestamps sort chronologically as strings; tasks without a
  // startedAt keep their snapshot (definition) order at the end.
  fromSnapshots.sort((a, b) =>
    a.startedAt && b.startedAt ? a.startedAt.localeCompare(b.startedAt) : 0,
  );
  for (const { startedAt: _startedAt, ...child } of fromSnapshots) {
    children.push(child);
  }
  return children;
}

/**
 * The fetch-plan signature of an enumeration: one line per child,
 * `id:settledFlag`, in rollup order. Two enumerations with the same signature
 * need identical fetches AND produce identically-ordered rollups — so it is
 * both the effect dependency and the memo key that shields downstream
 * consumers from the event store's per-event `taskStates` identity churn
 * (never key an effect on the map reference itself).
 */
export function agentCallChildrenSignature(
  children: readonly AgentCallChild[],
): string {
  return children
    .map((c) => `${c.childRunId}:${c.settled ? "1" : "0"}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Options for {@link useWorkflowRunFileChanges}. */
export interface UseWorkflowRunFileChangesOptions {
  /**
   * The workflow run id — the reset boundary: switching runs
   * clears fetched children so run A's changes never bleed into run B.
   */
  readonly runId: string | null;
  /** Derived task states (pass the viewer's `effectiveTaskStates`). */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Per-task status snapshots (`execution.status.tasks`) — the fallback source. */
  readonly taskSnapshots?: readonly WorkflowTask[];
}

/** Return value of {@link useWorkflowRunFileChanges}. */
export interface UseWorkflowRunFileChangesReturn {
  /**
   * One net {@link FileChange} per file touched across all AGENT_CALL tasks,
   * in file-list order (see {@link deriveRunFileChanges}).
   */
  readonly fileChanges: readonly FileChange[];
  /** Number of distinct files changed. */
  readonly fileChangeCount: number;
  /** `true` while the first child fetches are in flight (no data yet). */
  readonly isLoading: boolean;
  /** `true` while later child fetches are in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** First error from the last fetch round, or `null`. Partial data still renders. */
  readonly error: Error | null;
  /** Re-fetch every child from scratch (manual escape hatch). */
  readonly refetch: () => void;
}

/**
 * Aggregates a workflow run's file changes across all its AGENT_CALL
 * children into one net change per file — the data source for the panel's
 * Changes facet.
 *
 * **Fetch policy (bounded: ≤2 gets per child).** Each child is fetched
 * one-shot via `agentRun.get()` when first enumerated, and once more
 * when its task settles (the terminal snapshot carries the final ledger —
 * `displayFileChangeSets` folds `status.file_review_event_stream` for a
 * terminal run). No live child streams: the rollup refreshes at task
 * boundaries, which is the freshness this facet promises. A failed child
 * fetch surfaces `error` but never blocks the other children's results.
 *
 * **Stability.** The fetch effect and all derived memos key on the
 * enumeration *signature*, not the `taskStates` map identity (which churns
 * per event during a live run) — so mid-task events cause zero fetches and
 * zero re-derivation. The returned object is memoized.
 *
 * @see WorkflowChangesTab — the facet rendering this data
 * @see useSessionFileChanges — the session-side counterpart over the same core
 */
export function useWorkflowRunFileChanges({
  runId: executionId,
  taskStates,
  taskSnapshots,
}: UseWorkflowRunFileChangesOptions): UseWorkflowRunFileChangesReturn {
  const stigmer = useStigmer();
  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;

  // Enumerate on every render (cheap map walk), then pin identity to the
  // signature so the event store's per-event map churn never propagates.
  const children = enumerateAgentCallChildren(taskStates, taskSnapshots);
  const signature = agentCallChildrenSignature(children);
  const stableChildrenRef = useRef<{
    signature: string;
    children: readonly AgentCallChild[];
  }>({ signature, children });
  if (stableChildrenRef.current.signature !== signature) {
    stableChildrenRef.current = { signature, children };
  }
  const stableChildren = stableChildrenRef.current.children;

  // Fetched child snapshots by id (rendered state) + the settled-ness each id
  // was fetched at (ref — drives the ≤2-fetches policy, never rendered).
  const [executionsById, setExecutionsById] = useState<
    ReadonlyMap<string, AgentRun>
  >(() => new Map());
  const fetchedSettledRef = useRef(new Map<string, boolean>());

  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useMemo(
    () => () => {
      fetchedSettledRef.current.clear();
      setFetchKey((k) => k + 1);
    },
    [],
  );

  // Reset on run switch — same identity-boundary treatment as
  // useFetch/useWorkflowRunEventStream. `isFetching` must reset too:
  // a fetch in flight for run A is cancelled by the effect cleanup, and if
  // run B needs no fetches the effect bails before ever writing the flag —
  // a stale `true` would report "loading" forever.
  const prevExecutionIdRef = useRef(executionId);
  if (prevExecutionIdRef.current !== executionId) {
    prevExecutionIdRef.current = executionId;
    fetchedSettledRef.current.clear();
    setExecutionsById(new Map());
    setIsFetching(false);
    setError(null);
  }

  useEffect(() => {
    if (!executionId) return;

    // A child needs a fetch when never fetched, or fetched live and now
    // settled (the settle fetch picks up the final ledger).
    const toFetch = stableChildren.filter((child) => {
      const fetchedAs = fetchedSettledRef.current.get(child.childRunId);
      return fetchedAs === undefined || (fetchedAs === false && child.settled);
    });
    if (toFetch.length === 0) return;

    let cancelled = false;
    setIsFetching(true);
    setError(null);

    (async () => {
      const results = await Promise.all(
        toFetch.map(async (child) => {
          try {
            const execution = await stigmerRef.current.agentRun.get(
              child.childRunId,
            );
            return { child, execution, error: null as Error | null };
          } catch (err) {
            return { child, execution: null, error: toError(err) };
          }
        }),
      );
      if (cancelled) return;

      setExecutionsById((prev) => {
        const next = new Map(prev);
        for (const { child, execution } of results) {
          if (!execution) continue;
          next.set(child.childRunId, execution);
          fetchedSettledRef.current.set(child.childRunId, child.settled);
        }
        return next;
      });
      const firstError = results.find((r) => r.error)?.error ?? null;
      setError(firstError);
      setIsFetching(false);
    })();

    return () => {
      cancelled = true;
    };
    // signature (not stableChildren/taskStates identity) keys the fetch plan.
  }, [executionId, signature, fetchKey]);

  const fileChanges = useMemo(() => {
    const ordered: AgentRun[] = [];
    for (const child of stableChildren) {
      const execution = executionsById.get(child.childRunId);
      if (execution) ordered.push(execution);
    }
    return deriveRunFileChanges(ordered);
  }, [stableChildren, executionsById]);

  const hasData = executionsById.size > 0;
  const isLoading = isFetching && !hasData;
  const isRefetching = isFetching && hasData;

  return useMemo(
    () => ({
      fileChanges,
      fileChangeCount: fileChanges.length,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [fileChanges, isLoading, isRefetching, error, refetch],
  );
}
