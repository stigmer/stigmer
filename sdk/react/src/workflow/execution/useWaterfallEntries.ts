"use client";

/**
 * React behavior hook for the execution waterfall timeline.
 *
 * Derives waterfall entries from the event stream, manages live-growing
 * bars via `requestAnimationFrame` during streaming, and provides a
 * stable `scrollToTask` callback for graph-timeline synchronization.
 *
 * Follows DD-003 (headless-first) and DD-010 (referential stability).
 *
 * @since T07 (Execution Waterfall Timeline)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowEventStreamState } from "../../internal/store/workflow-execution-event-store";
import {
  deriveWaterfallEntries,
  deriveWaterfallScale,
  type WaterfallEntry,
  type WaterfallScale,
} from "./derive-waterfall-entries";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseWaterfallEntriesOptions {
  /** Events ordered by sequence_number ascending. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Current stream lifecycle state. */
  readonly streamState: WorkflowEventStreamState;
  /** ISO 8601 timestamp of execution start. */
  readonly executionStartIso: string;
  /** Total execution duration in ms (for completed executions). */
  readonly executionDurationMs?: number;
}

export interface UseWaterfallEntriesReturn {
  /** Waterfall entries (one per task, ordered by start time). */
  readonly entries: readonly WaterfallEntry[];
  /** Time axis scale specification. */
  readonly scale: WaterfallScale;
  /** True when the execution is live (bars may be growing). */
  readonly isLive: boolean;
  /** Current elapsed ms from execution start (updates via rAF when live). */
  readonly nowMs: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const EMPTY_ENTRIES: readonly WaterfallEntry[] = [];
const EMPTY_SCALE: WaterfallScale = { totalMs: 1000, ticks: [0, 1000], labelEveryN: 1 };

export function useWaterfallEntries({
  events,
  streamState,
  executionStartIso,
  executionDurationMs,
}: UseWaterfallEntriesOptions): UseWaterfallEntriesReturn {
  const isLive = streamState.stage === "streaming";
  const execStartEpoch = useMemo(
    () => (executionStartIso ? new Date(executionStartIso).getTime() : 0),
    [executionStartIso],
  );

  // --- Live clock (rAF-driven nowMs for growing bars) ---

  const [nowMs, setNowMs] = useState(() =>
    execStartEpoch > 0 ? Date.now() - execStartEpoch : 0,
  );
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isLive || execStartEpoch === 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setNowMs(Date.now() - execStartEpoch);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isLive, execStartEpoch]);

  // When execution completes, snap to final duration
  useEffect(() => {
    if (!isLive && executionDurationMs != null && executionDurationMs > 0) {
      setNowMs(executionDurationMs);
    }
  }, [isLive, executionDurationMs]);

  // --- Derive entries (memoized on event list length) ---

  const entries = useMemo(() => {
    if (events.length === 0) return EMPTY_ENTRIES;
    return deriveWaterfallEntries(events, executionStartIso);
  }, [events, executionStartIso]);

  // --- Derive scale ---

  const effectiveDuration = isLive ? nowMs : (executionDurationMs ?? nowMs);

  const scale = useMemo(() => {
    if (entries.length === 0) return EMPTY_SCALE;
    return deriveWaterfallScale(entries, effectiveDuration);
  }, [entries, effectiveDuration]);

  return useMemo(
    () => ({ entries, scale, isLive, nowMs }),
    [entries, scale, isLive, nowMs],
  );
}
