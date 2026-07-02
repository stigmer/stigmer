"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Live elapsed time since an ISO 8601 timestamp, re-rendering once per second.
 *
 * The shape behind every "how long has this been going" affordance in the
 * thread: an approval gate waiting on a human, a sub-agent card whose nested
 * activity cannot be streamed (the Cursor SDK returns sub-agent internals only
 * at completion), a long-running tool. A ticking duration is the honest signal
 * that work is progressing when there is nothing else to show — as opposed to
 * fabricating intermediate state.
 *
 * Returns elapsed milliseconds (clamped to >= 0 against client/server clock
 * skew), or `null` when the timestamp is absent or unparseable — callers
 * render nothing rather than a bogus "0s". The interval is scoped to the
 * component instance and torn down on unmount, so a thread full of settled
 * cards costs zero timers.
 *
 * @param startedAt ISO 8601 timestamp the clock counts from (e.g.
 *   `ToolCall.approval_requested_at`, `SubAgentExecution.started_at`).
 */
export function useElapsedSince(startedAt: string): number | null {
  const startMs = useMemo(() => {
    if (!startedAt) return null;
    const t = new Date(startedAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [startedAt]);

  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null) {
      setElapsed(null);
      return;
    }
    setElapsed(Math.max(0, Date.now() - startMs));
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startMs));
    }, 1000);
    return () => clearInterval(id);
  }, [startMs]);

  return startMs === null ? null : elapsed;
}

/**
 * Format an elapsed duration for the live tickers driven by
 * {@link useElapsedSince}: `just now`, `42s`, `3m 12s`, `1h 5m`.
 *
 * Second-granularity (unlike ToolCallDetail's `formatDuration`, which keeps
 * millisecond precision for completed calls) because a live counter that
 * flickers sub-second digits reads as noise, not progress.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}
