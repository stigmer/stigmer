import type { ReactNode } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

// ---------------------------------------------------------------------------
// View modes
// ---------------------------------------------------------------------------

/** Available layout modes for the resource workbench. */
export type ViewMode = "table" | "cards" | "list";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Resource status phases that map to `--stgm-status-*` design tokens.
 *
 * Each phase corresponds to a token group defined in `@stigmer/theme`
 * (e.g. `--stgm-status-ready`, `--stgm-status-failed-subtle`).
 */
export type StatusPhase =
  | "ready"
  | "running"
  | "pending"
  | "degraded"
  | "failed"
  | "disabled"
  | "draft";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

/**
 * Defines a single column in the {@link ResourceTable}.
 *
 * Generic over `TData` so platform builders can use richer item types
 * beyond `SearchResult` while the Console uses `SearchResult` directly.
 */
export interface WorkbenchColumnDef<TData = SearchResult> {
  /** Stable column identifier (used for visibility persistence and URL state). */
  readonly id: string;
  /** Column header label. */
  readonly header: string;
  /**
   * Accessor function that extracts the cell value from a row item.
   * Return a `ReactNode` for custom cell rendering.
   */
  readonly cell: (item: TData) => ReactNode;
  /**
   * Whether this column is sortable. When `true`, clicking the header
   * toggles sort direction.
   * @default false
   */
  readonly sortable?: boolean;
  /**
   * Whether this column is visible by default.
   * Users can toggle visibility via column preferences.
   * @default true
   */
  readonly defaultVisible?: boolean;
  /**
   * Minimum column width in pixels. The table uses this as a CSS
   * `min-width` to prevent content collapse.
   */
  readonly minWidth?: number;
  /**
   * Relative flex weight for distributing remaining horizontal space.
   * Columns with higher weight receive more space.
   * @default 1
   */
  readonly flex?: number;
}

// ---------------------------------------------------------------------------
// Filter definitions
// ---------------------------------------------------------------------------

/** Operator for a single filter expression. */
export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in";

/** A single active filter value applied to the collection. */
export interface FilterValue {
  /** The filter definition ID this value applies to. */
  readonly filterId: string;
  /** Comparison operator. */
  readonly operator: FilterOperator;
  /**
   * Filter value(s). A string for scalar operators, an array for `in`.
   */
  readonly value: string | readonly string[];
}

/**
 * Defines a filterable property for the {@link FilterBar}.
 *
 * Platform builders declare which properties are filterable and how
 * they appear in the filter UI.
 */
export interface FilterDef {
  /** Stable filter identifier (used in URL state serialization). */
  readonly id: string;
  /** Human-readable label shown in the filter picker and chips. */
  readonly label: string;
  /** Filter input type. */
  readonly type: "text" | "select" | "multi-select" | "date";
  /**
   * Available options for `select` and `multi-select` types.
   * Ignored for `text` and `date`.
   */
  readonly options?: readonly FilterOption[];
  /**
   * Allowed operators. Defaults to `["eq"]` for selects,
   * `["contains"]` for text, and `["gte", "lte"]` for dates.
   */
  readonly operators?: readonly FilterOperator[];
}

/** A selectable option within a `select` or `multi-select` filter. */
export interface FilterOption {
  /** The value sent in the filter expression. */
  readonly value: string;
  /** Display label. */
  readonly label: string;
  /** Optional icon rendered before the label. */
  readonly icon?: ReactNode;
}

// ---------------------------------------------------------------------------
// Sort definitions
// ---------------------------------------------------------------------------

/** Sort direction. */
export type SortDirection = "asc" | "desc";

/** A single active sort applied to the collection. */
export interface SortValue {
  /** Column or property ID to sort by. */
  readonly id: string;
  /** Sort direction. */
  readonly direction: SortDirection;
}

/**
 * Defines a sortable property. Used by hooks to validate incoming sort
 * state and by the UI to render sort options in column headers and
 * sort dropdowns.
 */
export interface SortDef {
  /** Stable identifier matching a column ID or virtual sort key. */
  readonly id: string;
  /** Human-readable label (e.g. "Name", "Last updated"). */
  readonly label: string;
  /** Default direction when this sort is first activated. @default "asc" */
  readonly defaultDirection?: SortDirection;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A single action available for a resource item (shown in context menus). */
export interface ResourceAction<TData = SearchResult> {
  /** Stable action identifier. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Icon rendered before the label. */
  readonly icon?: ReactNode;
  /** Keyboard shortcut hint displayed in the menu. */
  readonly shortcut?: string;
  /** Visual variant. @default "default" */
  readonly variant?: "default" | "destructive";
  /** Called when the action is selected. Receives the target item. */
  readonly onAction: (item: TData) => void;
  /** When `true`, the action is shown but non-interactive. */
  readonly disabled?: boolean;
}

/** A bulk action available when multiple items are selected. */
export interface BulkAction<TData = SearchResult> {
  /** Stable action identifier. */
  readonly id: string;
  /** Display label (e.g. "Delete", "Change visibility"). */
  readonly label: string;
  /** Icon rendered before the label. */
  readonly icon?: ReactNode;
  /** Visual variant. @default "default" */
  readonly variant?: "default" | "destructive";
  /** Called with the full set of selected items. */
  readonly onAction: (items: readonly TData[]) => void;
  /** When `true`, the action is shown but non-interactive. */
  readonly disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Workbench state (for URL sync callbacks)
// ---------------------------------------------------------------------------

/**
 * Serializable snapshot of the workbench's filter, sort, pagination,
 * and view state. Passed to `onStateChange` so consumers can sync
 * this state to URL search params or other persistence layers.
 */
export interface WorkbenchState {
  readonly filters: readonly FilterValue[];
  readonly sort: SortValue | null;
  readonly page: number;
  readonly pageSize: number;
  readonly query: string;
  readonly viewMode: ViewMode;
}
