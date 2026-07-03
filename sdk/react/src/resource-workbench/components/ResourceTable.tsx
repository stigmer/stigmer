"use client";

import type { ReactNode } from "react";
import { flexRender, type Table, type Row } from "@tanstack/react-table";
import { cn } from "@stigmer/theme";
import type { SortDirection } from "../types.js";
import { ColumnHeader } from "./ColumnHeader.js";
import { SelectionCheckbox } from "./SelectionCheckbox.js";

/** Props for {@link ResourceTable}. */
export interface ResourceTableProps<TData> {
  /** TanStack Table instance from `useResourceCollection`. */
  readonly table: Table<TData>;
  /** Whether row selection is enabled. */
  readonly enableSelection?: boolean;
  /**
   * Render function for per-row actions (e.g. an `ActionMenu`).
   * Shown in the last column. Omit to hide the actions column.
   */
  readonly renderRowAction?: (item: TData) => ReactNode;
  /**
   * Called when a row is clicked (but not when a checkbox or action
   * inside the row is clicked).
   */
  readonly onRowClick?: (item: TData) => void;
  /** Accessible label for the table. @default "Resources" */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Table view for the resource workbench.
 *
 * Renders a semantic `<table>` element using column definitions and
 * data from a TanStack Table instance. Supports sortable column
 * headers, row selection checkboxes, per-row action menus, and
 * keyboard-navigable rows.
 *
 * This component renders **only the table**. Search, filters, view
 * switching, and pagination are handled by the parent `ResourceWorkbench`.
 *
 * @example
 * ```tsx
 * const { table } = useResourceCollection({ ... });
 * <ResourceTable
 *   table={table}
 *   enableSelection
 *   renderRowAction={(item) => <AgentActionMenu item={item} />}
 *   onRowClick={(item) => navigate(item.slug)}
 * />
 * ```
 */
export function ResourceTable<TData>({
  table,
  enableSelection = false,
  renderRowAction,
  onRowClick,
  "aria-label": ariaLabel = "Resources",
  className,
}: ResourceTableProps<TData>) {
  const headerGroups = table.getHeaderGroups();
  const rows = table.getRowModel().rows;

  const allSelected = table.getIsAllRowsSelected();
  const someSelected = table.getIsSomeRowsSelected();

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table
        role="table"
        aria-label={ariaLabel}
        className="w-full border-collapse text-sm"
      >
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr
              key={headerGroup.id}
              className="border-b border-border"
            >
              {enableSelection && (
                <th scope="col" className="w-10 px-3 py-2">
                  <SelectionCheckbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={table.getToggleAllRowsSelectedHandler()
                      ? () => table.toggleAllRowsSelected(!allSelected)
                      : () => {}}
                    aria-label={
                      allSelected
                        ? "Deselect all rows"
                        : "Select all rows"
                    }
                  />
                </th>
              )}
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const direction: SortDirection | null = sorted === "asc"
                  ? "asc"
                  : sorted === "desc"
                    ? "desc"
                    : null;

                return (
                  <ColumnHeader
                    key={header.id}
                    label={
                      typeof header.column.columnDef.header === "string"
                        ? header.column.columnDef.header
                        : header.id
                    }
                    sortable={canSort}
                    sortDirection={direction}
                    onSort={
                      canSort
                        ? () => header.column.toggleSorting()
                        : undefined
                    }
                  />
                );
              })}
              {renderRowAction && (
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              row={row}
              enableSelection={enableSelection}
              renderRowAction={renderRowAction}
              onRowClick={onRowClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: Table row
// ---------------------------------------------------------------------------

function TableRow<TData>({
  row,
  enableSelection,
  renderRowAction,
  onRowClick,
}: {
  readonly row: Row<TData>;
  readonly enableSelection: boolean;
  readonly renderRowAction?: (item: TData) => ReactNode;
  readonly onRowClick?: (item: TData) => void;
}) {
  const isSelected = row.getIsSelected();
  const item = row.original;
  const isClickable = !!onRowClick;

  return (
    <tr
      className={cn(
        "border-b border-border-muted transition-colors",
        isSelected && "bg-primary-subtle",
        isClickable && "cursor-pointer hover:bg-accent-hover",
      )}
      onClick={
        isClickable
          ? (e) => {
              // Don't trigger row click when interacting with controls
              const target = e.target as HTMLElement;
              if (
                target.closest("button") ||
                target.closest("input") ||
                target.closest("[role='menu']") ||
                target.closest("[role='menuitem']")
              ) {
                return;
              }
              onRowClick!(item);
            }
          : undefined
      }
      aria-selected={enableSelection ? isSelected : undefined}
    >
      {enableSelection && (
        <td className="w-10 px-3 py-2">
          <SelectionCheckbox
            checked={isSelected}
            onChange={() => row.toggleSelected()}
            aria-label={`Select row ${row.id}`}
          />
        </td>
      )}
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          className="px-3 py-2 text-sm text-foreground"
          style={{
            minWidth: cell.column.columnDef.minSize
              ? `${cell.column.columnDef.minSize}px`
              : undefined,
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
      {renderRowAction && (
        <td className="w-10 px-3 py-2 text-right">
          {renderRowAction(item)}
        </td>
      )}
    </tr>
  );
}
