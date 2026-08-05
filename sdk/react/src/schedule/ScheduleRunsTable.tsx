"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ScheduleRunOrigin,
  ScheduleRunOutcome,
  type ScheduleRun,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Pagination } from "../internal/Pagination.js";
import { useScheduleRuns } from "./useScheduleRuns.js";

/** Props for {@link ScheduleRunsTable}. */
export interface ScheduleRunsTableProps {
  /** ID of the schedule whose run history to show. */
  readonly scheduleId: string;
  /**
   * Called when the user activates a run's execution reference
   * (`aex_…`). When omitted, the id renders as plain text.
   */
  readonly onNavigateToExecution?: (executionId: string) => void;
  /**
   * The instant relative timestamps are computed against.
   * Injectable for deterministic tests and Scenar fixtures.
   * @default new Date() at render
   */
  readonly now?: Date;
  /** Runs per page. @default 25 */
  readonly pageSize?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Paginated run-history table for a schedule — the fire ledger,
 * rendered in full (project DD-017 D-7).
 *
 * Every fire leaves a row, INCLUDING fires that created no execution (a
 * refused launch gate, a missing target agent), carrying the refusing
 * gate's copy verbatim. Columns: outcome, origin, fired time (relative,
 * with the absolute instant on hover), duration (recorded → completed;
 * "—" while a run is in flight or when no run was created), and the
 * execution reference.
 *
 * Owns its data: give it a `scheduleId` and it fetches via
 * {@link useScheduleRuns} with internal page state. To force a refresh
 * from outside (e.g. after triggering a manual run), remount with a
 * React `key` — the standard reset idiom (DD-014); the remount also
 * returns to page 1, where the new run appears.
 *
 * Handles loading, error, and empty states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ScheduleRunsTable
 *   scheduleId={schedule.metadata.id}
 *   onNavigateToExecution={(id) => router.push(`/executions/${id}`)}
 * />
 * ```
 */
export function ScheduleRunsTable({
  scheduleId,
  onNavigateToExecution,
  now,
  pageSize = 25,
  className,
}: ScheduleRunsTableProps) {
  const [pageNum, setPageNum] = useState(1);
  const { runs, totalCount, isLoading, error, refetch } = useScheduleRuns(
    scheduleId,
    { page: pageNum, pageSize },
  );

  if (error) {
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  }
  if (isLoading && runs.length === 0) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-muted-subtle" />
        ))}
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className={className}>
        <EmptyRuns />
      </div>
    );
  }

  const renderNow = now ?? new Date();
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className={className}>
      <div
        role="table"
        aria-label="Run history"
        className="overflow-hidden rounded-lg border border-border"
      >
        <div
          role="row"
          className={cn(
            rowGridClasses,
            "border-b border-border px-3.5 py-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground",
          )}
        >
          <span role="columnheader">Outcome</span>
          <span role="columnheader" className="hidden sm:block">
            Origin
          </span>
          <span role="columnheader">Fired</span>
          <span role="columnheader" className="hidden sm:block">
            Duration
          </span>
          <span role="columnheader" className="text-right">
            Execution
          </span>
        </div>
        {runs.map((run, i) => (
          <RunTableRow
            key={runKey(run, i)}
            run={run}
            now={renderNow}
            onNavigateToExecution={onNavigateToExecution}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <Pagination
          pageNum={pageNum}
          totalPages={totalPages}
          onPageChange={setPageNum}
          ariaLabel="Run history pagination"
          className="mt-3"
        />
      )}
    </div>
  );
}

// Mobile keeps the three load-bearing columns (outcome, fired,
// execution); origin and duration join at the sm breakpoint.
const rowGridClasses =
  "grid grid-cols-[7rem_1fr_auto] items-center gap-x-4 sm:grid-cols-[7rem_5.5rem_1fr_5rem_minmax(0,12rem)]";

function RunTableRow({
  run,
  now,
  onNavigateToExecution,
}: {
  readonly run: ScheduleRun;
  readonly now: Date;
  readonly onNavigateToExecution?: (executionId: string) => void;
}) {
  const fireDate = run.nominalFireTime
    ? timestampDate(run.nominalFireTime)
    : null;
  const badge = runOutcomeBadge(run.outcome);

  return (
    <div
      role="row"
      className={cn(
        rowGridClasses,
        "border-b border-border-muted px-3.5 py-2.5 last:border-b-0",
      )}
    >
      <span role="cell">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </span>
      <span role="cell" className="hidden text-xs text-muted-foreground sm:block">
        {runOriginLabel(run.origin)}
      </span>
      <span
        role="cell"
        className="text-xs text-muted-foreground"
        title={fireDate ? fireDate.toLocaleString() : undefined}
      >
        {fireDate ? formatRelativeTime(fireDate, now) : "—"}
      </span>
      <span
        role="cell"
        className="hidden text-xs tabular-nums text-muted-foreground sm:block"
      >
        {formatRunDuration(run) ?? "—"}
      </span>
      <span role="cell" className="min-w-0 text-right">
        {run.executionId ? (
          onNavigateToExecution ? (
            <button
              type="button"
              onClick={() => onNavigateToExecution(run.executionId)}
              className={cn(
                "max-w-full truncate font-mono text-[0.65rem] text-primary underline-offset-2 hover:underline",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              )}
            >
              {run.executionId}
            </button>
          ) : (
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              {run.executionId}
            </span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </span>
      {run.reason && (
        <p
          role="cell"
          className="col-span-full mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground"
        >
          {run.reason}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact list — the Overview tab's "recent runs" strip
// ---------------------------------------------------------------------------

/**
 * Compact run list: badge, origin, relative time, refusal reason, and
 * execution link per row — the at-a-glance form used by the detail
 * view's Overview tab. Presentational: runs come in as props (the
 * caller owns the fetch, so one hook can also feed the Runs tab badge).
 *
 * Not barrel-exported: the public run-history surface is
 * {@link ScheduleRunsTable}; this exists for the detail view's strip.
 */
export function ScheduleRunsCompactList({
  runs,
  isLoading,
  now,
  onNavigateToExecution,
}: {
  readonly runs: readonly ScheduleRun[];
  readonly isLoading: boolean;
  readonly now: Date;
  readonly onNavigateToExecution?: (executionId: string) => void;
}) {
  if (isLoading && runs.length === 0) {
    return (
      <div className="space-y-2 px-4 py-3" aria-busy="true">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (runs.length === 0) {
    return <EmptyRuns />;
  }
  return (
    <ul className="divide-y divide-border">
      {runs.map((run, i) => (
        <CompactRunRow
          key={runKey(run, i)}
          run={run}
          now={now}
          onNavigateToExecution={onNavigateToExecution}
        />
      ))}
    </ul>
  );
}

function CompactRunRow({
  run,
  now,
  onNavigateToExecution,
}: {
  readonly run: ScheduleRun;
  readonly now: Date;
  readonly onNavigateToExecution?: (executionId: string) => void;
}) {
  const fireDate = run.nominalFireTime
    ? timestampDate(run.nominalFireTime)
    : null;
  const badge = runOutcomeBadge(run.outcome);

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {runOriginLabel(run.origin)}
        </span>
        <span className="text-xs text-muted-foreground-subtle">·</span>
        <span
          className="text-xs text-muted-foreground"
          title={fireDate ? fireDate.toLocaleString() : undefined}
        >
          {fireDate ? formatRelativeTime(fireDate, now) : "—"}
        </span>
      </div>
      {run.reason && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {run.reason}
        </p>
      )}
      {run.executionId &&
        (onNavigateToExecution ? (
          <button
            type="button"
            onClick={() => onNavigateToExecution(run.executionId)}
            className={cn(
              "self-start font-mono text-[0.65rem] text-primary underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            )}
          >
            {run.executionId}
          </button>
        ) : (
          <span className="self-start font-mono text-[0.65rem] text-muted-foreground">
            {run.executionId}
          </span>
        ))}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function EmptyRuns() {
  return (
    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
      No runs yet. Use &ldquo;Run now&rdquo; to fire a test run — every fire,
      including a refused one, is recorded here.
    </p>
  );
}

/**
 * Stable row key from the fire ledger's natural identity
 * (nominal fire time + origin), with the index as a collision tail.
 */
function runKey(run: ScheduleRun, index: number): string {
  const fireMs = run.nominalFireTime
    ? timestampDate(run.nominalFireTime).getTime()
    : "no-time";
  return `${fireMs}-${run.origin}-${index}`;
}

function runOriginLabel(origin: ScheduleRunOrigin): string {
  return origin === ScheduleRunOrigin.MANUAL ? "Manual" : "Scheduled";
}

/** Verbatim-label badges for a run outcome, colored by health. */
export function runOutcomeBadge(outcome: ScheduleRunOutcome): {
  label: string;
  className: string;
} {
  switch (outcome) {
    case ScheduleRunOutcome.STARTED:
      return { label: "Started", className: "bg-info/10 text-info" };
    case ScheduleRunOutcome.COMPLETED:
      return { label: "Completed", className: "bg-success/10 text-success" };
    case ScheduleRunOutcome.REFUSED:
      return { label: "Refused", className: "bg-warning/10 text-warning" };
    case ScheduleRunOutcome.TARGET_MISSING:
      return { label: "Target missing", className: "bg-warning/10 text-warning" };
    case ScheduleRunOutcome.SKIPPED:
      return { label: "Skipped", className: "bg-muted text-muted-foreground" };
    case ScheduleRunOutcome.FAILED:
      return { label: "Failed", className: "bg-destructive/10 text-destructive" };
    case ScheduleRunOutcome.TIMED_OUT:
      return { label: "Timed out", className: "bg-destructive/10 text-destructive" };
    default:
      return { label: "Unknown", className: "bg-muted text-muted-foreground" };
  }
}

/**
 * Wall-clock duration of a run, `recorded_at` → `completed_at`, in the
 * compact unit style the schedule views use elsewhere (`42s`, `5m 12s`,
 * `2h 3m`). `null` while the run is in flight or when the fire created
 * no run at all — the caller renders the em-dash.
 */
function formatRunDuration(run: ScheduleRun): string | null {
  if (!run.recordedAt || !run.completedAt) return null;
  const ms =
    timestampDate(run.completedAt).getTime() -
    timestampDate(run.recordedAt).getTime();
  if (ms < 0) return null;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return "<1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}
