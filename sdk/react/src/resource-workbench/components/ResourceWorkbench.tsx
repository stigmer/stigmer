"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ListParams, ListResult } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type {
  WorkbenchColumnDef,
  FilterDef,
  FilterValue,
  SortValue,
  BulkAction,
  ViewMode,
} from "../types.js";
import { useResourceCollection } from "../hooks/useResourceCollection.js";
import { useResourceFilters } from "../hooks/useResourceFilters.js";
import { useResourceSelection } from "../hooks/useResourceSelection.js";
import { useViewPreference } from "../hooks/useViewPreference.js";
import { ResourceTable } from "./ResourceTable.js";
import { ResourceCards } from "./ResourceCards.js";
import { ResourceList } from "./ResourceList.js";
import { FilterBar } from "./FilterBar.js";
import { ViewSwitcher } from "./ViewSwitcher.js";
import { BulkActionBar } from "./BulkActionBar.js";
import { ResourceInspector } from "./ResourceInspector.js";
import { EmptyState } from "../../empty-state/index.js";
import { ResourceAvatar } from "./ResourceAvatar.js";
import { ScopeToggle } from "../../library/ScopeToggle.js";

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

  // --- Refresh -----------------------------------------------------------

  /**
   * Opaque token that forces a background refetch of the list whenever
   * its value changes — the current view stays rendered with a refetch
   * shimmer (no remount flash), and pagination and sort are preserved.
   * Bump it after an out-of-band mutation (applying a manifest, deleting
   * a row) so the change appears without a reload.
   */
  readonly refetchToken?: unknown;

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

  /**
   * Whether the toolbar renders the text-search input. Set `false` for
   * kinds whose list backend has no text search (e.g. schedules, which
   * use the direct query instead of the search service) — a search box
   * that silently matches nothing is worse than none (DD-006). Opt-in
   * per DD-011: existing consumers keep the search box.
   * @default true
   */
  readonly searchable?: boolean;
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
  refetchToken,
  emptyIcon,
  emptyTitle = "No resources found",
  emptyDescription = "Try adjusting your search or filters.",
  emptyAction,
  onRetry,
  headerAction,
  searchable = true,
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
    getItemId,
    refetchToken,
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
      className={cn("stg:flex stg:flex-col stg:gap-3", className)}
    >
      {/* --- Toolbar: search + filters + view switcher --- */}
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        {searchable ? (
          <div className="stg:relative stg:flex-1">
            <SearchIcon className="stg:pointer-events-none stg:absolute stg:left-2.5 stg:top-1/2 stg:h-3.5 stg:w-3.5 stg:-translate-y-1/2 stg:text-muted-foreground-subtle" />
            <input
              type="text"
              value={filtersHook.query}
              onChange={(e) => filtersHook.setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:py-1.5 stg:pl-8 stg:pr-3 stg:text-sm",
                "stg:placeholder:text-muted-foreground-subtle",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            />
          </div>
        ) : (
          // Spacer keeps the scope toggle / view switcher / header action
          // right-aligned, matching the searchable layout.
          <div className="stg:flex-1" aria-hidden="true" />
        )}
        {onScopeChange && (
          <ScopeToggle value={controlledScope} onChange={onScopeChange} />
        )}
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
      <div className="stg:flex stg:min-h-0 stg:flex-1">
        <div
          className={cn(
            "stg:min-w-0 stg:flex-1",
            collection.isRefetching &&
              "stg:pointer-events-none stg:opacity-60 stg:transition-opacity",
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
  const isSkill = item.kind === ApiResourceKind.skill;
  return (
    <div className="stg:flex stg:items-start stg:gap-3">
      <ResourceAvatar
        name={item.name || item.slug}
        slug={item.slug}
        iconUrl={item.iconUrl || undefined}
        hidden={isSkill}
      />
      <div className="stg:min-w-0 stg:flex-1">
        <span className="stg:text-sm stg:font-medium stg:text-foreground">
          {item.name || item.slug}
        </span>
        {item.org && (
          <p className="stg:text-xs stg:text-muted-foreground">{item.org}</p>
        )}
        {item.description && (
          <p className="stg:mt-0.5 stg:line-clamp-2 stg:text-xs stg:text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
    </div>
  );
}

function DefaultRowContent({ item }: { readonly item: SearchResult }) {
  const isSkill = item.kind === ApiResourceKind.skill;
  return (
    <div className="stg:flex stg:items-center stg:gap-2">
      <ResourceAvatar
        name={item.name || item.slug}
        slug={item.slug}
        iconUrl={item.iconUrl || undefined}
        hidden={isSkill}
        size="sm"
      />
      <span className="stg:text-sm stg:font-medium stg:text-foreground">
        {item.name || item.slug}
      </span>
      {item.org && (
        <span className="stg:text-xs stg:text-muted-foreground">{item.org}</span>
      )}
      {item.description && (
        <>
          <span className="stg:text-muted-foreground-subtle" aria-hidden="true">
            {"\u00B7"}
          </span>
          <span className="stg:truncate stg:text-xs stg:text-muted-foreground">
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
        className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-3"
        aria-busy="true"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="stg:flex stg:flex-col stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4"
            aria-hidden="true"
          >
            <div className="stg:h-4 stg:w-3/5 stg:animate-pulse stg:rounded stg:bg-muted" />
            <div className="stg:h-3 stg:w-2/5 stg:animate-pulse stg:rounded stg:bg-muted" />
            <div className="stg:h-3 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
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
          className="stg:flex stg:items-center stg:gap-3 stg:px-3 stg:py-2.5"
          aria-hidden="true"
        >
          <div className="stg:h-4 stg:w-4 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:flex-1 stg:space-y-2">
            <div
              className="stg:h-4 stg:animate-pulse stg:rounded stg:bg-muted"
              style={{ width: `${30 + (i * 7) % 25}%` }}
            />
            <div
              className="stg:h-3 stg:animate-pulse stg:rounded stg:bg-muted"
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
    "stg:inline-flex stg:items-center stg:rounded-md stg:p-1.5",
    "stg:border stg:border-input stg:bg-background stg:text-foreground",
    "stg:hover:bg-accent stg:hover:text-accent-foreground",
    "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
  );

  return (
    <nav
      aria-label="Pagination"
      className="stg:flex stg:items-center stg:justify-between stg:border-t stg:border-border stg:pt-3"
    >
      <span className="stg:text-xs stg:text-muted-foreground">
        {totalCount.toLocaleString()}{" "}
        {totalCount === 1 ? "result" : "results"}
      </span>
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className={navBtnClass}
        >
          <ChevronLeftIcon />
        </button>
        <span className="stg:text-xs stg:text-muted-foreground">
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
      className="stg:h-3.5 stg:w-3.5"
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
      className="stg:h-3.5 stg:w-3.5"
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
