"use client";

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionPhaseBadge } from "../WorkflowExecutionPhaseBadge.js";
import { formatDuration, formatMicroUsd, formatTokenCount } from "../format-utils.js";
import {
  sortExecutionRows,
  type ExecutionRow,
  type ExecutionSortField,
  type SortDirection,
} from "./derive-execution-row.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../internal/tooltip.js";
import { TruncatedText } from "../../internal/truncated-text.js";
import { formatRelativeTime } from "../../activity/format-relative-time.js";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  readonly id: string;
  readonly header: string;
  readonly sortField: ExecutionSortField | null;
  readonly cell: (row: ExecutionRow) => ReactNode;
  readonly defaultVisible: boolean;
  readonly minWidth: string;
  readonly align?: "left" | "right";
}

const BIGINT_ZERO = BigInt(0);

const COLUMNS: readonly ColumnDef[] = [
  {
    id: "name",
    header: "Name",
    sortField: "name",
    cell: (row) => (
      <TruncatedText
        text={row.name || "\u2014"}
        className="stg:font-medium stg:text-foreground stg:max-w-[12rem] stg:inline-block"
      />
    ),
    defaultVisible: true,
    minWidth: "8rem",
  },
  {
    id: "status",
    header: "Status",
    sortField: "phase",
    cell: (row) => <WorkflowExecutionPhaseBadge phase={row.phase} />,
    defaultVisible: true,
    minWidth: "6rem",
  },
  {
    id: "started",
    header: "Started",
    sortField: "startedAt",
    cell: (row) =>
      row.startedAt ? (
        <Tooltip>
          <TooltipTrigger render={<time dateTime={row.startedAt.toISOString()} />}>
            {formatRelativeTime(row.startedAt)}
          </TooltipTrigger>
          <TooltipContent side="top">{row.startedAt.toLocaleString()}</TooltipContent>
        </Tooltip>
      ) : (
        "\u2014"
      ),
    defaultVisible: true,
    minWidth: "6rem",
  },
  {
    id: "duration",
    header: "Duration",
    sortField: "duration",
    cell: (row) =>
      row.durationMs != null ? formatDuration(row.durationMs) : "\u2014",
    defaultVisible: true,
    minWidth: "5rem",
    align: "right",
  },
  {
    id: "cost",
    header: "Cost",
    sortField: "cost",
    cell: (row) =>
      row.costMicros > BIGINT_ZERO
        ? formatMicroUsd(row.costMicros)
        : "\u2014",
    defaultVisible: true,
    minWidth: "4.5rem",
    align: "right",
  },
  {
    id: "tokens",
    header: "Tokens",
    sortField: "tokens",
    cell: (row) =>
      row.totalTokens > BIGINT_ZERO
        ? formatTokenCount(row.totalTokens)
        : "\u2014",
    defaultVisible: false,
    minWidth: "4.5rem",
    align: "right",
  },
  {
    id: "progress",
    header: "Tasks",
    sortField: "tasks",
    cell: (row) =>
      row.taskCount > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span />}>
            {row.completedTaskCount}/{row.taskCount}
          </TooltipTrigger>
          <TooltipContent side="top">
            {`${row.completedTaskCount} of ${row.taskCount} tasks finished`}
          </TooltipContent>
        </Tooltip>
      ) : (
        "\u2014"
      ),
    defaultVisible: true,
    minWidth: "3.5rem",
    align: "right",
  },
  {
    id: "failedTask",
    header: "Failed / Current",
    sortField: null,
    cell: (row) => {
      const label = row.failedTaskName ?? row.currentTaskName;
      if (!label) return "\u2014";
      const isFailed = !!row.failedTaskName;
      return (
        <TruncatedText
          text={label}
          className={cn(
            "stg:max-w-[10rem] stg:inline-block stg:text-xs",
            isFailed ? "stg:text-destructive" : "stg:text-muted-foreground",
          )}
        />
      );
    },
    defaultVisible: true,
    minWidth: "7rem",
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ExecutionHistoryTable}. */
export interface ExecutionHistoryTableProps {
  /** Derived execution rows to display. */
  readonly rows: readonly ExecutionRow[];
  /** `true` while data is being fetched for the first time. */
  readonly isLoading?: boolean;
  /** Error from the last failed fetch. */
  readonly error?: Error | null;
  /** Called when a row is clicked. Receives the execution ID. */
  readonly onRowClick?: (executionId: string) => void;
  /**
   * Column IDs to display. When omitted, uses each column's
   * `defaultVisible` setting.
   */
  readonly visibleColumns?: readonly string[];
  /** Initial sort field. @default "startedAt" */
  readonly defaultSortField?: ExecutionSortField;
  /** Initial sort direction. @default "desc" */
  readonly defaultSortDirection?: SortDirection;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Data-dense execution history table with sortable columns, keyboard
 * navigation, and responsive column visibility.
 *
 * Columns are defined statically and use existing formatters from
 * `format-utils.ts` and `WorkflowExecutionPhaseBadge`. Sort state
 * is managed internally with configurable defaults.
 *
 * This component renders only the table. Filtering, pagination, and
 * health metrics are composed by the parent `WorkflowExecutionHistory`.
 *
 * @example
 * ```tsx
 * <ExecutionHistoryTable
 *   rows={derivedRows}
 *   onRowClick={(id) => navigate(`/executions/${id}`)}
 * />
 * ```
 */
export const ExecutionHistoryTable = memo(function ExecutionHistoryTable({
  rows,
  isLoading = false,
  error,
  onRowClick,
  visibleColumns,
  defaultSortField = "startedAt",
  defaultSortDirection = "desc",
  className,
}: ExecutionHistoryTableProps) {
  const [sortField, setSortField] = useState<ExecutionSortField>(defaultSortField);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultSortDirection);

  const activeColumns = useMemo(() => {
    if (visibleColumns) {
      return COLUMNS.filter((col) => visibleColumns.includes(col.id));
    }
    return COLUMNS.filter((col) => col.defaultVisible);
  }, [visibleColumns]);

  const sortedRows = useMemo(
    () => sortExecutionRows(rows, sortField, sortDir),
    [rows, sortField, sortDir],
  );

  const handleSort = useCallback(
    (field: ExecutionSortField) => {
      if (field === sortField) {
        setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("desc");
      }
    },
    [sortField],
  );

  if (error) {
    return (
      <div
        role="alert"
        className={cn("stg:rounded-lg stg:border stg:border-destructive/20 stg:bg-destructive/5 stg:p-6 stg:text-center stg:text-sm stg:text-destructive", className)}
      >
        Failed to load executions{error.message ? `: ${error.message}` : ""}
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton columnCount={activeColumns.length} className={className} />;
  }

  if (rows.length === 0) {
    return (
      <div className={cn("stg:rounded-lg stg:border stg:border-border stg:p-8 stg:text-center stg:text-sm stg:text-muted-foreground", className)}>
        No executions yet
      </div>
    );
  }

  return (
    <div className={cn("stg:overflow-x-auto stg:rounded-lg stg:border stg:border-border", className)}>
      <table
        role="table"
        aria-label="Execution history"
        className="stg:w-full stg:border-collapse stg:text-sm"
      >
        <thead>
          <tr className="stg:border-b stg:border-border stg:bg-[var(--stgm-muted,#f4f4f5)]/50">
            {activeColumns.map((col) => {
              const isSorted = col.sortField === sortField;
              const ariaSortValue = isSorted
                ? sortDir === "asc"
                  ? "ascending" as const
                  : "descending" as const
                : undefined;

              return (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    "stg:px-3 stg:py-2 stg:text-xs stg:font-medium stg:text-muted-foreground stg:whitespace-nowrap",
                    col.align === "right" ? "stg:text-right" : "stg:text-left",
                    col.sortField && "stg:cursor-pointer stg:select-none stg:hover:text-foreground stg:transition-colors",
                  )}
                  style={{ minWidth: col.minWidth }}
                  aria-sort={ariaSortValue}
                  onClick={col.sortField ? () => handleSort(col.sortField!) : undefined}
                  onKeyDown={
                    col.sortField
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort(col.sortField!);
                          }
                        }
                      : undefined
                  }
                  tabIndex={col.sortField ? 0 : undefined}
                  role={col.sortField ? "columnheader" : undefined}
                >
                  <span className="stg:inline-flex stg:items-center stg:gap-1">
                    {col.header}
                    {col.sortField && isSorted && (
                      <SortIndicator direction={sortDir} />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <ExecutionTableRow
              key={row.id}
              row={row}
              columns={activeColumns}
              onRowClick={onRowClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

const ExecutionTableRow = memo(function ExecutionTableRow({
  row,
  columns,
  onRowClick,
}: {
  readonly row: ExecutionRow;
  readonly columns: readonly ColumnDef[];
  readonly onRowClick?: (executionId: string) => void;
}) {
  const clickable = !!onRowClick;

  return (
    <tr
      className={cn(
        "stg:border-b stg:border-border-muted stg:transition-colors",
        clickable && "stg:cursor-pointer stg:hover:bg-[var(--stgm-accent-hover,#f5f5f5)]",
      )}
      onClick={clickable ? () => onRowClick(row.id) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row.id);
              }
            }
          : undefined
      }
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? "link" : undefined}
    >
      {columns.map((col) => (
        <td
          key={col.id}
          className={cn(
            "stg:px-3 stg:py-2.5 stg:text-sm stg:tabular-nums",
            col.align === "right" ? "stg:text-right" : "stg:text-left",
          )}
        >
          {col.cell(row)}
        </td>
      ))}
    </tr>
  );
});

// ---------------------------------------------------------------------------
// Sort indicator
// ---------------------------------------------------------------------------

function SortIndicator({ direction }: { readonly direction: SortDirection }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
      className="stg:opacity-60"
    >
      {direction === "asc" ? (
        <path d="M5 2L8.5 7H1.5L5 2Z" />
      ) : (
        <path d="M5 8L1.5 3H8.5L5 8Z" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton({
  columnCount,
  className,
}: {
  readonly columnCount: number;
  readonly className?: string;
}) {
  return (
    <div className={cn("stg:overflow-hidden stg:rounded-lg stg:border stg:border-border", className)}>
      <table className="stg:w-full stg:border-collapse stg:text-sm" aria-label="Loading execution history">
        <thead>
          <tr className="stg:border-b stg:border-border stg:bg-[var(--stgm-muted,#f4f4f5)]/50">
            {Array.from({ length: columnCount }, (_, i) => (
              <th key={i} className="stg:px-3 stg:py-2">
                <div className="stg:h-3 stg:w-16 stg:animate-pulse stg:rounded stg:bg-muted" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }, (_, rowIdx) => (
            <tr key={rowIdx} className="stg:border-b stg:border-border-muted">
              {Array.from({ length: columnCount }, (_, colIdx) => (
                <td key={colIdx} className="stg:px-3 stg:py-2.5">
                  <div className="stg:h-4 stg:animate-pulse stg:rounded stg:bg-muted" style={{ width: `${40 + (colIdx * 12) % 40}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
