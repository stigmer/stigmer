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
      <span className="font-medium text-foreground truncate max-w-[12rem] inline-block" title={row.name}>
        {row.name || "\u2014"}
      </span>
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
        <time dateTime={row.startedAt.toISOString()} title={row.startedAt.toLocaleString()}>
          {formatRelativeTime(row.startedAt)}
        </time>
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
        <span title={`${row.completedTaskCount} of ${row.taskCount} tasks finished`}>
          {row.completedTaskCount}/{row.taskCount}
        </span>
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
        <span
          className={cn(
            "truncate max-w-[10rem] inline-block text-xs",
            isFailed ? "text-destructive" : "text-muted-foreground",
          )}
          title={label}
        >
          {label}
        </span>
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
        className={cn("rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center text-sm text-destructive", className)}
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
      <div className={cn("rounded-lg border border-border p-8 text-center text-sm text-muted-foreground", className)}>
        No executions yet
      </div>
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)}>
      <table
        role="table"
        aria-label="Execution history"
        className="w-full border-collapse text-sm"
      >
        <thead>
          <tr className="border-b border-border bg-[var(--stgm-muted,#f4f4f5)]/50">
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
                    "px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap",
                    col.align === "right" ? "text-right" : "text-left",
                    col.sortField && "cursor-pointer select-none hover:text-foreground transition-colors",
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
                  <span className="inline-flex items-center gap-1">
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
        "border-b border-border-muted transition-colors",
        clickable && "cursor-pointer hover:bg-[var(--stgm-accent-hover,#f5f5f5)]",
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
            "px-3 py-2.5 text-sm tabular-nums",
            col.align === "right" ? "text-right" : "text-left",
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
      className="opacity-60"
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
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <table className="w-full border-collapse text-sm" aria-label="Loading execution history">
        <thead>
          <tr className="border-b border-border bg-[var(--stgm-muted,#f4f4f5)]/50">
            {Array.from({ length: columnCount }, (_, i) => (
              <th key={i} className="px-3 py-2">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }, (_, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border-muted">
              {Array.from({ length: columnCount }, (_, colIdx) => (
                <td key={colIdx} className="px-3 py-2.5">
                  <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${40 + (colIdx * 12) % 40}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relative time formatter
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 0) return date.toLocaleString();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000);
    return `${mins}m ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours}h ago`;
  }
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${days}d ago`;
  }
  return date.toLocaleDateString();
}
