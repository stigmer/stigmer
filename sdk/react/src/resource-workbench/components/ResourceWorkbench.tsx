"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import type { ListParams, ListResult } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type {
  WorkbenchColumnDef,
  FilterDef,
  FilterValue,
  SortValue,
  BulkAction,
  ViewMode,
} from "../types";
import { useResourceCollection } from "../hooks/useResourceCollection";
import { useResourceFilters } from "../hooks/useResourceFilters";
import { useResourceSelection } from "../hooks/useResourceSelection";
import { useViewPreference } from "../hooks/useViewPreference";
import { ResourceTable } from "./ResourceTable";
import { ResourceCards } from "./ResourceCards";
import { ResourceList } from "./ResourceList";
import { FilterBar } from "./FilterBar";
import { ViewSwitcher } from "./ViewSwitcher";
import { BulkActionBar } from "./BulkActionBar";
import { ResourceInspector } from "./ResourceInspector";
import { EmptyState } from "../../empty-state";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ResourceWorkbench}. */
export interface ResourceWorkbenchProps<TData = SearchResult> {
  /**
   * Async function that fetches a page of resources. Receives `ListParams`
   * and returns `ListResult`. Pass `null` to disable fetching.
   */
  readonly listFn: ((params: ListParams) => Promise<ListResult>) | null;
  /** Organization slug. Pass `null` to disable fetching. */
  readonly org: string | null;

  // --- View configuration ------------------------------------------------

  /** Column definitions for the table view. */
  readonly columns?: readonly WorkbenchColumnDef<TData>[];
  /** Available filter definitions. */
  readonly filterDefs?: readonly FilterDef[];
  /** Available view modes. @default ["table", "cards", "list"] */
  readonly viewModes?: readonly ViewMode[];
  /** Default view mode. @default "table" */
  readonly defaultViewMode?: ViewMode;
  /**
   * localStorage key for persisting view mode preference.
   * Pass `undefined` to disable persistence.
   */
  readonly viewModeStorageKey?: string;

  // --- Rendering slots ---------------------------------------------------

  /**
   * Custom card renderer for card view. Receives the item and its index.
   * When omitted, the workbench falls back to a default card layout.
   */
  readonly renderCard?: (item: TData, index: number) => ReactNode;
  /**
   * Custom row renderer for list view. Receives the item and its index.
   * When omitted, falls back to a default row layout.
   */
  readonly renderRow?: (item: TData, index: number) => ReactNode;
  /** Per-item action renderer (shown in table rows, card corners, list ends). */
  readonly renderItemAction?: (item: TData) => ReactNode;
  /**
   * Inspector content renderer. When provided, clicking an item opens
   * the split-panel inspector with this content. When omitted, the
   * inspector is disabled.
   */
  readonly renderInspector?: (item: TData) => ReactNode;

  // --- Actions -----------------------------------------------------------

  /** Bulk actions available when items are selected. */
  readonly bulkActions?: readonly BulkAction<TData>[];
  /** Called when an item is clicked (navigates to detail, etc.). */
  readonly onItemClick?: (item: TData) => void;

  // --- State & persistence -----------------------------------------------

  /** Initial filter values (e.g. restored from URL on mount). */
  readonly initialFilters?: readonly FilterValue[];
  /** Initial sort (e.g. restored from URL on mount). */
  readonly initialSort?: SortValue | null;
  /** Initial search query (e.g. restored from URL on mount). */
  readonly initialQuery?: string;
  /** Scope for resource visibility. @default "org" */
  readonly scope?: "org" | "all";
  /** Called when scope changes (for Console to persist). */
  readonly onScopeChange?: (scope: "org" | "all") => void;
  /** Called when any filter/sort/query state changes (for URL sync). */
  readonly onStateChange?: (state: {
    filters: readonly FilterValue[];
    sort: SortValue | null;
    query: string;
  }) => void;

  // --- Selection ---------------------------------------------------------

  /** Enable selection checkboxes and bulk actions. @default false */
  readonly enableSelection?: boolean;
  /** Extracts a unique ID from an item (for selection tracking). */
  readonly getItemId?: (item: TData) => string;

  // --- Empty & error states ----------------------------------------------

  /** Icon for the empty state. */
  readonly emptyIcon?: ReactNode;
  /** Title for the empty state. */
  readonly emptyTitle?: string;
  /** Description for the empty state. */
  readonly emptyDescription?: string;
  /**
   * Custom CTA rendered in the first-use empty state (no items, no
   * active filters). Use this to provide a creation entry point that
   * is visually co-located with the "no resources yet" message.
   *
   * Accepts any ReactNode — typically a `<Link>` or `<button>`.
   */
  readonly emptyAction?: ReactNode;
  /** Called when the user clicks "Retry" after an error. */
  readonly onRetry?: () => void;

  // --- Header action -----------------------------------------------------

  /**
   * Primary action rendered right-aligned in the toolbar, after the
   * view mode switcher. Use this for the workbench's main creation
   * entry point — e.g. a "Create agent" button or link.
   *
   * Accepts any ReactNode so consumers control routing and styling.
   */
  readonly headerAction?: ReactNode;

  // --- Layout ------------------------------------------------------------

  /** Search input placeholder text. @default "Search\u2026" */
  readonly searchPlaceholder?: string;
  /** Accessible label for the workbench region. @default "Resource workbench" */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

/**
 * Full-featured resource collection workbench that composes headless
 * hooks and focused view components into a complete browsing experience.
 *
 * Provides:
 * - Toolbar with search input, filter chips, and view mode switcher
 * - Three view modes: table, cards, and compact list
 * - Row/card selection with bulk action bar
 * - Optional split-panel inspector for item previews
 * - Empty, loading, and error states
 * - Pagination
 *
 * The workbench is the "drop-in" tier of the resource collection
 * architecture. Platform builders who want more control use the
 * individual hooks and view components directly.
 *
 * @example
 * ```tsx
 * <ResourceWorkbench
 *   listFn={(params) => stigmer.agent.list(params)}
 *   org={activeOrg}
 *   columns={agentColumns}
 *   filterDefs={agentFilterDefs}
 *   renderItemAction={(item) => <AgentActionMenu item={item} />}
 *   onItemClick={(item) => navigate(`/agents/${item.slug}`)}
 *   emptyTitle="No agents yet"
 *   emptyDescription="Create an agent to get started."
 * />
 * ```
 */
export function ResourceWorkbench<TData = SearchResult>({
  listFn,
  org,
  columns = [],
  filterDefs = [],
  viewModes = ["table", "cards", "list"],
  defaultViewMode = "table",
  viewModeStorageKey,
  renderCard,
  renderRow,
  renderItemAction,
  renderInspector,
  bulkActions = [],
  onItemClick,
  initialFilters,
  initialSort,
  initialQuery,
  scope: controlledScope = "org",
  onScopeChange,
  onStateChange,
  enableSelection = false,
  getItemId = defaultGetId as (item: TData) => string,
  emptyIcon,
  emptyTitle = "No resources found",
  emptyDescription = "Try adjusting your search or filters.",
  emptyAction,
  onRetry,
  headerAction,
  searchPlaceholder = "Search\u2026",
  "aria-label": ariaLabel = "Resource workbench",
  className,
}: ResourceWorkbenchProps<TData>) {
  // --- View preference ---------------------------------------------------
  const { viewMode, setViewMode } = useViewPreference(
    viewModeStorageKey,
    defaultViewMode,
  );

  // --- Filter/sort/query state -------------------------------------------
  const filtersHook = useResourceFilters({
    filterDefs,
    initialFilters,
    initialSort,
    initialQuery,
    onStateChange,
    queryDebounceMs: DEBOUNCE_MS,
  });

  // --- Pagination --------------------------------------------------------
  const [page, setPage] = useState(1);
  const prevQueryRef = useRef(filtersHook.debouncedQuery);
  if (prevQueryRef.current !== filtersHook.debouncedQuery) {
    prevQueryRef.current = filtersHook.debouncedQuery;
    setPage(1);
  }

  // --- Collection data ---------------------------------------------------
  const collection = useResourceCollection<TData>({
    listFn: listFn as ((params: ListParams) => Promise<ListResult>) | null,
    org,
    query: filtersHook.debouncedQuery,
    scope: controlledScope,
    page,
    sort: filtersHook.sort,
    onSortChange: filtersHook.setSort,
    columns: columns as WorkbenchColumnDef<TData>[],
    enableSelection,
  });

  // --- Selection ---------------------------------------------------------
  const selection = useResourceSelection(collection.items, getItemId);

  // --- Inspector ---------------------------------------------------------
  const [inspectedItem, setInspectedItem] = useState<TData | null>(null);
  const inspectorEnabled = !!renderInspector;

  const handleItemClick = useCallback(
    (item: TData) => {
      if (inspectorEnabled) {
        setInspectedItem(item);
      }
      onItemClick?.(item);
    },
    [inspectorEnabled, onItemClick],
  );

  // --- Content resolution ------------------------------------------------
  const showSkeletons = collection.isLoading && collection.items.length === 0;
  const showError = !!collection.error && !collection.isLoading;
  const showEmpty =
    !collection.isLoading && !collection.error && collection.items.length === 0;
  const showContent = collection.items.length > 0;
  const showPagination = collection.totalPages > 1;

  // --- Selected IDs as Set for cards/list views --------------------------
  const selectedIdSet = selection.selectedIds;

  return (
    <div
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-3", className)}
    >
      {/* --- Toolbar: search + filters + view switcher --- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground-subtle" />
          <input
            type="text"
            value={filtersHook.query}
            onChange={(e) => filtersHook.setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className={cn(
              "w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm",
              "placeholder:text-muted-foreground-subtle",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
        </div>
        {viewModes.length > 1 && (
          <ViewSwitcher
            value={viewMode}
            onChange={setViewMode}
            modes={viewModes}
          />
        )}
        {headerAction}
      </div>

      {/* --- Active filter chips --- */}
      <FilterBar
        filters={filtersHook.filters}
        filterDefs={filterDefs}
        onRemoveFilter={filtersHook.removeFilter}
        onClearAll={filtersHook.clearFilters}
      />

      {/* --- Main content area with optional inspector --- */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-w-0 flex-1",
            collection.isRefetching &&
              "pointer-events-none opacity-60 transition-opacity",
          )}
        >
          {showSkeletons && <SkeletonPlaceholder viewMode={viewMode} />}

          {showError && (
            <EmptyState
              variant="error"
              errorMessage={collection.error!.message}
              action={
                onRetry
                  ? { label: "Retry", onClick: onRetry ?? collection.refetch }
                  : undefined
              }
            />
          )}

          {showEmpty && (
            <EmptyState
              variant={
                filtersHook.hasActiveFilters || filtersHook.debouncedQuery
                  ? "zero-results"
                  : "first-use"
              }
              icon={emptyIcon}
              title={
                filtersHook.hasActiveFilters || filtersHook.debouncedQuery
                  ? "No results match your filters"
                  : emptyTitle
              }
              description={
                filtersHook.hasActiveFilters || filtersHook.debouncedQuery
                  ? "Try adjusting your search or removing some filters."
                  : emptyDescription
              }
              action={
                filtersHook.hasActiveFilters
                  ? {
                      label: "Clear filters",
                      onClick: filtersHook.clearFilters,
                    }
                  : undefined
              }
            >
              {!filtersHook.hasActiveFilters && !filtersHook.debouncedQuery
                ? emptyAction
                : undefined}
            </EmptyState>
          )}

          {showContent && viewMode === "table" && collection.table && (
            <ResourceTable
              table={collection.table}
              enableSelection={enableSelection}
              renderRowAction={renderItemAction}
              onRowClick={handleItemClick}
            />
          )}

          {showContent && viewMode === "cards" && (
            <ResourceCards
              items={collection.items}
              renderCard={
                renderCard ??
                ((item) => <DefaultCardContent item={item as unknown as SearchResult} />)
              }
              enableSelection={enableSelection}
              selectedIds={selectedIdSet}
              onToggleSelection={selection.toggleItem}
              getItemId={getItemId}
              renderCardAction={renderItemAction}
              onCardClick={handleItemClick}
            />
          )}

          {showContent && viewMode === "list" && (
            <ResourceList
              items={collection.items}
              renderRow={
                renderRow ??
                ((item) => <DefaultRowContent item={item as unknown as SearchResult} />)
              }
              enableSelection={enableSelection}
              selectedIds={selectedIdSet}
              onToggleSelection={selection.toggleItem}
              getItemId={getItemId}
              renderRowAction={renderItemAction}
              onRowClick={handleItemClick}
            />
          )}

          {showPagination && (
            <PaginationBar
              currentPage={collection.currentPage}
              totalPages={collection.totalPages}
              totalCount={collection.totalCount}
              onPageChange={setPage}
            />
          )}
        </div>

        {/* --- Inspector panel --- */}
        {inspectorEnabled && (
          <ResourceInspector
            open={inspectedItem !== null}
            onClose={() => setInspectedItem(null)}
          >
            {inspectedItem && renderInspector!(inspectedItem)}
          </ResourceInspector>
        )}
      </div>

      {/* --- Bulk action bar --- */}
      {enableSelection && selection.hasSelection && (
        <BulkActionBar
          selectedCount={selection.selectedCount}
          selectedItems={selection.selectedItems}
          actions={bulkActions}
          onCancel={selection.clearSelection}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultGetId(item: unknown): string {
  const r = item as Record<string, unknown>;
  if (typeof r.id === "string") return r.id;
  if (typeof r.slug === "string") return r.slug;
  return "";
}

function DefaultCardContent({ item }: { readonly item: SearchResult }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-foreground">
        {item.name || item.slug}
      </span>
      {item.org && (
        <span className="text-xs text-muted-foreground">{item.org}</span>
      )}
      {item.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {item.description}
        </p>
      )}
    </div>
  );
}

function DefaultRowContent({ item }: { readonly item: SearchResult }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-foreground">
        {item.name || item.slug}
      </span>
      {item.org && (
        <span className="text-xs text-muted-foreground">{item.org}</span>
      )}
      {item.description && (
        <>
          <span className="text-muted-foreground-subtle" aria-hidden="true">
            {"\u00B7"}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {item.description}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function SkeletonPlaceholder({
  viewMode,
}: {
  readonly viewMode: ViewMode;
}) {
  if (viewMode === "cards") {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-busy="true"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
            aria-hidden="true"
          >
            <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3 py-2.5"
          aria-hidden="true"
        >
          <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div
              className="h-4 animate-pulse rounded bg-muted"
              style={{ width: `${30 + (i * 7) % 25}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-muted"
              style={{ width: `${55 + (i * 5) % 20}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function PaginationBar({
  currentPage,
  totalPages,
  totalCount,
  onPageChange,
}: {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly totalCount: number;
  readonly onPageChange: (page: number) => void;
}) {
  const navBtnClass = cn(
    "inline-flex items-center rounded-md p-1.5",
    "border border-input bg-background text-foreground",
    "hover:bg-accent hover:text-accent-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-50",
  );

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-border pt-3"
    >
      <span className="text-xs text-muted-foreground">
        {totalCount.toLocaleString()}{" "}
        {totalCount === 1 ? "result" : "results"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className={navBtnClass}
        >
          <ChevronLeftIcon />
        </button>
        <span className="text-xs text-muted-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          className={navBtnClass}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SearchIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="m10 10 4 4" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 3-5 5 5 5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
