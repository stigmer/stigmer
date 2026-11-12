"use client";

// Whether anything has ever run in an organization: the one rule the
// dashboard's first steps and the launcher's first question both stand on.
// It is asked of all time, not of the week, so a quiet week in an
// organization that ran before is not mistaken for a new one; an active run
// counts, as does every finished phase. Until the server answers (including
// the render in which the read is first asked, before its hook reports
// loading), the answer is `undefined`, so a caller can hold its place rather
// than flash the wrong screen.

import { RunSummaryTimeWindow, useRunSummary } from "./useRunSummary.js";

/** Return value of {@link useEverRan}. */
export interface UseEverRanReturn {
  /** `true` once a run exists, `false` when none ever has, `undefined` while unknown (asked or failed). */
  readonly ran: boolean | undefined;
  /** The read's failure, or `null`. A failed read answers nothing. */
  readonly error: Error | null;
}

/**
 * Whether anything has ever run in `org`. Pass `null` to skip the read
 * (the answer is then `undefined`).
 *
 * @example
 * ```tsx
 * function Welcome({ org }: { org: string }) {
 *   const { ran } = useEverRan(org);
 *   if (ran === undefined) return null;
 *   return <p>{ran ? "Welcome back." : "Nothing has run here yet."}</p>;
 * }
 * ```
 */
export function useEverRan(org: string | null | undefined): UseEverRanReturn {
  const { summary, error } = useRunSummary({ org: org || null, timeWindow: RunSummaryTimeWindow.ALL_TIME });
  if (!org || summary === null) return { ran: undefined, error: org ? error : null };
  const count = summary.activeCount + Object.values(summary.phaseCounts).reduce((sum, n) => sum + n, 0);
  return { ran: count > 0, error: null };
}
