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
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
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
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="stg:h-9 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
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
        className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border"
      >
        <div
          role="row"
          className={cn(
            rowGridClasses,
            "stg:border-b stg:border-border stg:px-3.5 stg:py-2 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground",
          )}
        >
          <span role="columnheader">Outcome</span>
          <span role="columnheader" className="stg:hidden stg:sm:block">
            Origin
          </span>
          <span role="columnheader">Fired</span>
          <span role="columnheader" className="stg:hidden stg:sm:block">
            Duration
          </span>
          <span role="columnheader" className="stg:text-right">
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
          className="stg:mt-3"
        />
      )}
    </div>
  );
}

// Mobile keeps the three load-bearing columns (outcome, fired,
// execution); origin and duration join at the sm breakpoint.
const rowGridClasses =
  "stg:grid stg:grid-cols-[7rem_1fr_auto] stg:items-center stg:gap-x-4 stg:sm:grid-cols-[7rem_5.5rem_1fr_5rem_minmax(0,12rem)]";

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
        "stg:border-b stg:border-border-muted stg:px-3.5 stg:py-2.5 stg:last:border-b-0",
      )}
    >
      <span role="cell">
        <span
          className={cn(
            "stg:inline-flex stg:items-center stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </span>
      <span role="cell" className="stg:hidden stg:text-xs stg:text-muted-foreground stg:sm:block">
        {runOriginLabel(run.origin)}
      </span>
      <span role="cell" className="stg:text-xs stg:text-muted-foreground">
        {fireDate ? (
          <Tooltip>
            <TooltipTrigger render={<time dateTime={fireDate.toISOString()} />}>
              {formatRelativeTime(fireDate, now)}
            </TooltipTrigger>
            <TooltipContent side="top">{fireDate.toLocaleString()}</TooltipContent>
          </Tooltip>
        ) : (
          "—"
        )}
      </span>
      <span
        role="cell"
        className="stg:hidden stg:text-xs stg:tabular-nums stg:text-muted-foreground stg:sm:block"
      >
        {formatRunDuration(run) ?? "—"}
      </span>
      <span role="cell" className="stg:min-w-0 stg:text-right">
        {run.executionId ? (
          onNavigateToExecution ? (
            <button
              type="button"
              onClick={() => onNavigateToExecution(run.executionId)}
              className={cn(
                "stg:max-w-full stg:truncate stg:font-mono stg:text-[0.65rem] stg:text-primary stg:underline-offset-2 stg:hover:underline",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
              )}
            >
              {run.executionId}
            </button>
          ) : (
            <span className="stg:font-mono stg:text-[0.65rem] stg:text-muted-foreground">
              {run.executionId}
            </span>
          )
        ) : (
          <span className="stg:text-xs stg:text-muted-foreground">—</span>
        )}
      </span>
      {run.reason && (
        <p
          role="cell"
          className="stg:col-span-full stg:mt-1 stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-muted-foreground"
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
      <div className="stg:space-y-2 stg:px-4 stg:py-3" aria-busy="true">
        <div className="stg:h-4 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-4 stg:w-3/4 stg:animate-pulse stg:rounded stg:bg-muted" />
      </div>
    );
  }
  if (runs.length === 0) {
    return <EmptyRuns />;
  }
  return (
    <ul className="stg:divide-y stg:divide-border">
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
    <li className="stg:flex stg:flex-col stg:gap-1 stg:px-4 stg:py-2.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <span
          className={cn(
            "stg:inline-flex stg:items-center stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="stg:text-xs stg:text-muted-foreground">
          {runOriginLabel(run.origin)}
        </span>
        <span className="stg:text-xs stg:text-muted-foreground-subtle">·</span>
        <span className="stg:text-xs stg:text-muted-foreground">
          {fireDate ? (
            <Tooltip>
              <TooltipTrigger render={<time dateTime={fireDate.toISOString()} />}>
                {formatRelativeTime(fireDate, now)}
              </TooltipTrigger>
              <TooltipContent side="top">{fireDate.toLocaleString()}</TooltipContent>
            </Tooltip>
          ) : (
            "—"
          )}
        </span>
      </div>
      {run.reason && (
        <p className="stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-muted-foreground">
          {run.reason}
        </p>
      )}
      {run.executionId &&
        (onNavigateToExecution ? (
          <button
            type="button"
            onClick={() => onNavigateToExecution(run.executionId)}
            className={cn(
              "stg:self-start stg:font-mono stg:text-[0.65rem] stg:text-primary stg:underline-offset-2 stg:hover:underline",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
            )}
          >
            {run.executionId}
          </button>
        ) : (
          <span className="stg:self-start stg:font-mono stg:text-[0.65rem] stg:text-muted-foreground">
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
    <p className="stg:px-4 stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
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
      return { label: "Started", className: "stg:bg-info/10 stg:text-info" };
    case ScheduleRunOutcome.COMPLETED:
      return { label: "Completed", className: "stg:bg-success/10 stg:text-success" };
    case ScheduleRunOutcome.REFUSED:
      return { label: "Refused", className: "stg:bg-warning/10 stg:text-warning" };
    case ScheduleRunOutcome.TARGET_MISSING:
      return { label: "Target missing", className: "stg:bg-warning/10 stg:text-warning" };
    case ScheduleRunOutcome.SKIPPED:
      return { label: "Skipped", className: "stg:bg-muted stg:text-muted-foreground" };
    case ScheduleRunOutcome.FAILED:
      return { label: "Failed", className: "stg:bg-destructive/10 stg:text-destructive" };
    case ScheduleRunOutcome.TIMED_OUT:
      return { label: "Timed out", className: "stg:bg-destructive/10 stg:text-destructive" };
    default:
      return { label: "Unknown", className: "stg:bg-muted stg:text-muted-foreground" };
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
