"use client";

import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  RoutineFireOrigin,
  RoutineFireOutcome,
  type RoutineFire,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Pagination } from "../internal/Pagination.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useRoutineFires } from "./useRoutineFires.js";

/** Props for {@link RoutineFiresTable}. */
export interface RoutineFiresTableProps {
  /** ID of the routine whose fire history to show. */
  readonly routineId: string;
  /**
   * Called when the user activates a fire's run reference
   * (`run_…`). When omitted, the id renders as plain text.
   */
  readonly onNavigateToRun?: (executionId: string) => void;
  /**
   * The instant relative timestamps are computed against.
   * Injectable for deterministic tests and Scenar fixtures.
   * @default new Date() at render
   */
  readonly now?: Date;
  /** Fires per page. @default 25 */
  readonly pageSize?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Paginated fire-history table for a routine — the fire ledger,
 * rendered in full.
 *
 * Every fire leaves a row, INCLUDING fires that created no run (a
 * refused launch gate, a missing target agent), carrying the refusing
 * gate's copy verbatim. Columns: outcome, origin, who started it (the
 * caller of a hand or API fire, "—" for a schedule fire), fired time
 * (relative, with the absolute instant on hover), duration (recorded →
 * completed; "—" while a run is in flight or when no run was created),
 * and the run reference.
 *
 * Owns its data: give it a `routineId` and it fetches via
 * {@link useRoutineFires} with internal page state. To force a refresh
 * from outside (e.g. after triggering a manual run), remount with a
 * React `key` — the standard reset idiom; the remount also
 * returns to page 1, where the new run appears.
 *
 * Handles loading, error, and empty states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <RoutineFiresTable
 *   routineId={routine.metadata.id}
 *   onNavigateToRun={(id) => router.push(`/runs/${id}`)}
 * />
 * ```
 */
export function RoutineFiresTable({
  routineId,
  onNavigateToRun,
  now,
  pageSize = 25,
  className,
}: RoutineFiresTableProps) {
  const { fires, pageNumber, hasNext, hasPrevious, next, previous, isLoading, error, refetch } =
    useRoutineFires(routineId, { pageSize });

  if (error) {
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  }
  if (isLoading && fires.length === 0) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="stg:h-9 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }
  if (fires.length === 0) {
    return (
      <div className={className}>
        <EmptyFires />
      </div>
    );
  }

  const renderNow = now ?? new Date();

  return (
    <div className={className}>
      <div
        role="table"
        aria-label="Fire history"
        className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border"
      >
        <div
          role="row"
          className={cn(
            rowGridClasses,
            "stg:border-b stg:border-border stg:px-3.5 stg:py-2 stg:text-2xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground",
          )}
        >
          <span role="columnheader">Outcome</span>
          <span role="columnheader" className="stg:hidden stg:sm:block">
            Origin
          </span>
          <span role="columnheader" className="stg:hidden stg:sm:block">
            Started by
          </span>
          <span role="columnheader">Fired</span>
          <span role="columnheader" className="stg:hidden stg:sm:block">
            Duration
          </span>
          <span role="columnheader" className="stg:text-right">
            Run
          </span>
        </div>
        {fires.map((fire, i) => (
          <FireTableRow
            key={fireKey(fire, i)}
            fire={fire}
            now={renderNow}
            onNavigateToRun={onNavigateToRun}
          />
        ))}
      </div>

      {(hasNext || hasPrevious) && (
        <Pagination
          pageNumber={pageNumber}
          hasPrevious={hasPrevious}
          hasNext={hasNext}
          onPrevious={previous}
          onNext={next}
          ariaLabel="Fire history pagination"
          className="stg:mt-3"
        />
      )}
    </div>
  );
}

// Mobile keeps the three load-bearing columns (outcome, fired,
// run); origin, who started it and duration join at the sm breakpoint.
const rowGridClasses =
  "stg:grid stg:grid-cols-[7rem_1fr_auto] stg:items-center stg:gap-x-4 stg:sm:grid-cols-[7rem_5.5rem_minmax(0,9rem)_1fr_5rem_minmax(0,12rem)]";

function FireTableRow({
  fire,
  now,
  onNavigateToRun,
}: {
  readonly fire: RoutineFire;
  readonly now: Date;
  readonly onNavigateToRun?: (executionId: string) => void;
}) {
  const fireDate = fire.nominalFireTime
    ? timestampDate(fire.nominalFireTime)
    : null;
  const badge = fireOutcomeBadge(fire.outcome);
  const startedBy = fireStartedBy(fire);

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
            "stg:inline-flex stg:items-center stg:rounded-full stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </span>
      <span role="cell" className="stg:hidden stg:text-xs stg:text-muted-foreground stg:sm:block">
        {fireOriginLabel(fire.origin)}
      </span>
      <span
        role="cell"
        className="stg:hidden stg:truncate stg:text-xs stg:text-muted-foreground stg:sm:block"
      >
        {startedBy ? <StartedByLabel startedBy={startedBy} /> : "—"}
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
        {formatFireDuration(fire) ?? "—"}
      </span>
      <span role="cell" className="stg:min-w-0 stg:text-right">
        {fire.runId ? (
          onNavigateToRun ? (
            <button
              type="button"
              onClick={() => onNavigateToRun(fire.runId)}
              className={cn(
                "stg:max-w-full stg:truncate stg:font-mono stg:text-2xs stg:text-primary stg:underline-offset-2 stg:hover:underline",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
              )}
            >
              {fire.runId}
            </button>
          ) : (
            <span className="stg:font-mono stg:text-2xs stg:text-muted-foreground">
              {fire.runId}
            </span>
          )
        ) : (
          <span className="stg:text-xs stg:text-muted-foreground">—</span>
        )}
      </span>
      {fire.reason && (
        <p
          role="cell"
          className="stg:col-span-full stg:mt-1 stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-muted-foreground"
        >
          {fire.reason}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact list — the Overview tab's "recent fires" strip
// ---------------------------------------------------------------------------

/**
 * Compact fire list: badge, origin, who started it, relative time,
 * refusal reason, and run link per row — the at-a-glance form used by the detail
 * view's Overview tab. Presentational: fires come in as props (the
 * caller owns the fetch, so one hook can also feed the History tab badge).
 *
 * Not barrel-exported: the public fire-history surface is
 * {@link RoutineFiresTable}; this exists for the detail view's strip.
 */
export function RoutineFiresCompactList({
  fires,
  isLoading,
  now,
  onNavigateToRun,
}: {
  readonly fires: readonly RoutineFire[];
  readonly isLoading: boolean;
  readonly now: Date;
  readonly onNavigateToRun?: (executionId: string) => void;
}) {
  if (isLoading && fires.length === 0) {
    return (
      <div className="stg:space-y-2 stg:px-4 stg:py-3" aria-busy="true">
        <div className="stg:h-4 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:h-4 stg:w-3/4 stg:animate-pulse stg:rounded stg:bg-muted" />
      </div>
    );
  }
  if (fires.length === 0) {
    return <EmptyFires />;
  }
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border")}>
      {fires.map((fire, i) => (
        <CompactFireRow
          key={fireKey(fire, i)}
          fire={fire}
          now={now}
          onNavigateToRun={onNavigateToRun}
        />
      ))}
    </ul>
  );
}

function CompactFireRow({
  fire,
  now,
  onNavigateToRun,
}: {
  readonly fire: RoutineFire;
  readonly now: Date;
  readonly onNavigateToRun?: (executionId: string) => void;
}) {
  const fireDate = fire.nominalFireTime
    ? timestampDate(fire.nominalFireTime)
    : null;
  const badge = fireOutcomeBadge(fire.outcome);
  const startedBy = fireStartedBy(fire);

  return (
    <li className="stg:flex stg:flex-col stg:gap-1 stg:px-4 stg:py-2.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <span
          className={cn(
            "stg:inline-flex stg:items-center stg:rounded-full stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="stg:text-xs stg:text-muted-foreground">
          {fireOriginLabel(fire.origin)}
        </span>
        {startedBy && (
          <span className="stg:min-w-0 stg:truncate stg:text-xs stg:text-muted-foreground">
            by <StartedByLabel startedBy={startedBy} />
          </span>
        )}
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
      {fire.reason && (
        <p className="stg:whitespace-pre-wrap stg:break-words stg:text-xs stg:text-muted-foreground">
          {fire.reason}
        </p>
      )}
      {fire.runId &&
        (onNavigateToRun ? (
          <button
            type="button"
            onClick={() => onNavigateToRun(fire.runId)}
            className={cn(
              "stg:self-start stg:font-mono stg:text-2xs stg:text-primary stg:underline-offset-2 stg:hover:underline",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
            )}
          >
            {fire.runId}
          </button>
        ) : (
          <span className="stg:self-start stg:font-mono stg:text-2xs stg:text-muted-foreground">
            {fire.runId}
          </span>
        ))}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function EmptyFires() {
  return (
    <p className="stg:px-4 stg:py-6 stg:text-center stg:text-xs stg:text-muted-foreground">
      No fires yet. Every fire, on its schedule, by hand or over the API,
      is recorded here, a refused one included.
    </p>
  );
}

/**
 * Stable row key from the fire ledger's natural identity
 * (nominal fire time + origin), with the index as a collision tail.
 */
function fireKey(fire: RoutineFire, index: number): string {
  const fireMs = fire.nominalFireTime
    ? timestampDate(fire.nominalFireTime).getTime()
    : "no-time";
  return `${fireMs}-${fire.origin}-${index}`;
}

function fireOriginLabel(origin: RoutineFireOrigin): string {
  return origin === RoutineFireOrigin.MANUAL ? "Manual" : "Scheduled";
}

/** Who started a fire, as {@link fireStartedBy} reads it. */
export interface FireStartedBy {
  /** The caller's display name, else email, else id. */
  readonly label: string;
  /** The service account whose key minted the caller's token, said in words. */
  readonly detail?: string;
}

/**
 * Who started a fire: the caller's display name, else email, else id (the
 * actor message's own fallback order), with the service account whose key
 * minted the caller's token as its detail. `null` for a schedule fire,
 * which records no caller; its origin already says "Scheduled".
 */
export function fireStartedBy(fire: RoutineFire): FireStartedBy | null {
  const actor = fire.firedBy;
  const label = actor?.displayName || actor?.email || actor?.id || "";
  if (label === "") return null;
  return actor?.mintedBy
    ? { label, detail: `through service account ${actor.mintedBy}` }
    : { label };
}

/** The caller's label, with its minting service account on hover or focus. */
function StartedByLabel({ startedBy }: { readonly startedBy: FireStartedBy }) {
  if (!startedBy.detail) return <>{startedBy.label}</>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{startedBy.label}</TooltipTrigger>
      <TooltipContent side="top">{startedBy.detail}</TooltipContent>
    </Tooltip>
  );
}

/** Verbatim-label badges for a fire's outcome, colored by health. */
export function fireOutcomeBadge(outcome: RoutineFireOutcome): {
  label: string;
  className: string;
} {
  switch (outcome) {
    case RoutineFireOutcome.STARTED:
      return { label: "Started", className: "stg:bg-info/10 stg:text-info" };
    case RoutineFireOutcome.COMPLETED:
      return { label: "Completed", className: "stg:bg-success/10 stg:text-success" };
    case RoutineFireOutcome.REFUSED:
      return { label: "Refused", className: "stg:bg-warning/10 stg:text-warning" };
    case RoutineFireOutcome.TARGET_MISSING:
      return { label: "Target missing", className: "stg:bg-warning/10 stg:text-warning" };
    case RoutineFireOutcome.SKIPPED:
      return { label: "Skipped", className: "stg:bg-muted stg:text-muted-foreground" };
    case RoutineFireOutcome.FAILED:
      return { label: "Failed", className: "stg:bg-destructive/10 stg:text-destructive" };
    case RoutineFireOutcome.TIMED_OUT:
      return { label: "Timed out", className: "stg:bg-destructive/10 stg:text-destructive" };
    default:
      return { label: "Unknown", className: "stg:bg-muted stg:text-muted-foreground" };
  }
}

/**
 * Wall-clock duration of a fire's run, `recorded_at` → `completed_at`, in the
 * compact unit style the routine views use elsewhere (`42s`, `5m 12s`,
 * `2h 3m`). `null` while the run is in flight or when the fire created
 * no run at all — the caller renders the em-dash.
 */
function formatFireDuration(fire: RoutineFire): string | null {
  if (!fire.recordedAt || !fire.completedAt) return null;
  const ms =
    timestampDate(fire.completedAt).getTime() -
    timestampDate(fire.recordedAt).getTime();
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
