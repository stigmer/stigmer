"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ScopeToggle } from "./ScopeToggle";
import type { ResourceListScope } from "../search";
import { EmptyState } from "../empty-state";

const DEBOUNCE_MS = 300;
const SKELETON_COUNT = 5;
const GRID_SKELETON_COUNT = 6;
const MAX_VISIBLE_TAGS = 3;

/** Layout mode for {@link ResourceListView}. */
export type ResourceListLayout = "list" | "grid";

/** Props for {@link ResourceListView}. */
export interface ResourceListViewProps {
  /** Resource entries to display. */
  readonly items: readonly SearchResult[];
  /** Whether data is currently being fetched. */
  readonly isLoading: boolean;
  /** Error from the data hook. Shown as an alert when present and not loading. */
  readonly error?: Error | null;
  /** Total number of results across all pages. Shown in the pagination bar when provided. */
  readonly totalCount?: number;
  /** Total number of pages available. Enables pagination controls when greater than 1. */
  readonly totalPages?: number;
  /** Current page number (1-indexed). */
  readonly currentPage?: number;
  /**
   * Called with the debounced search query (300ms delay) when the user types.
   * Providing this prop enables the search input in the toolbar.
   *
   * The component manages the raw input value internally and only calls
   * this handler with the debounced value, so the parent does not need
   * to implement debouncing.
   */
  readonly onSearchChange?: (query: string) => void;
  /** Placeholder text for the search input. @default "Search\u2026" */
  readonly searchPlaceholder?: string;
  /** Initial value for the search input, read only on mount (e.g. from URL params). */
  readonly initialSearch?: string;
  /**
   * The currently active resource scope.
   * Providing both `scope` and `onScopeChange` enables the ScopeToggle
   * in the toolbar.
   */
  readonly scope?: ResourceListScope;
  /** Called when the user toggles the scope. Also resets the page to 1 via `onPageChange`. */
  readonly onScopeChange?: (scope: ResourceListScope) => void;
  /**
   * Called when the user navigates to a different page.
   * Pagination controls appear when this is provided and `totalPages > 1`.
   * Also called with `1` automatically when the search query or scope changes.
   */
  readonly onPageChange?: (page: number) => void;
  /**
   * Visual layout for items.
   *
   * - `"list"` (default) — vertical single-column rows
   * - `"grid"` — responsive multi-column card grid
   *   (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)
   *
   * When `layout` is `"grid"` and no `renderItem` is provided, the built-in
   * {@link DefaultResourceCard} is used instead of {@link DefaultResourceRow}.
   *
   * @default "list"
   */
  readonly layout?: ResourceListLayout;
  /**
   * Custom renderer for list items. Receives the `SearchResult` and its
   * index. Falls back to a built-in row showing name, org, description,
   * visibility badge, and tags.
   */
  readonly renderItem?: (item: SearchResult, index: number) => React.ReactNode;
  /**
   * Renders an action element (e.g. a button) for each item.
   *
   * In grid mode the action is placed in the card's top-right corner.
   * In list mode it is appended after the row content.
   *
   * The consumer is responsible for calling `e.stopPropagation()` if
   * the action should not also trigger `onItemClick`.
   */
  readonly renderItemAction?: (item: SearchResult) => React.ReactNode;
  /**
   * Called when a list item is clicked or activated via keyboard (Enter/Space).
   * Providing this makes items interactive with hover/focus styles and
   * keyboard navigation (Arrow Up/Down).
   */
  readonly onItemClick?: (item: SearchResult) => void;
  /** Icon element rendered in the empty state. */
  readonly emptyIcon?: React.ReactNode;
  /** Title for the empty state. @default "No resources found" */
  readonly emptyTitle?: string;
  /** Description for the empty state. @default "Try adjusting your search or scope." */
  readonly emptyDescription?: string;
  /** Called when the user clicks "Retry" after an error. */
  readonly onRetry?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
  /** Accessible label for the list region. @default "Resource list" */
  readonly "aria-label"?: string;
}

/**
 * Paginated, searchable view for browsing Stigmer resources.
 *
 * Supports two layout modes:
 *
 * - **`"list"`** (default) — vertical single-column rows, same as
 *   before. Each row shows a kind icon, name, org, description, and tags.
 * - **`"grid"`** — responsive multi-column card grid
 *   (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Each card shows a
 *   large icon container, name, org, description, and an optional
 *   action slot in the top-right corner.
 *
 * Both modes share the same toolbar (search, scope toggle), pagination,
 * loading/error/empty states, and keyboard navigation (grid mode adds
 * ArrowLeft/Right and column-aware Up/Down).
 *
 * The component is controlled — the parent owns data and filter state.
 * Search debouncing (300ms) is managed internally so the parent only
 * receives debounced query values via {@link ResourceListViewProps.onSearchChange}.
 *
 * Only `items` and `isLoading` are required. Search, scope toggle,
 * pagination, layout mode, and custom row rendering activate
 * progressively when their corresponding props are provided.
 *
 * When the debounced search query or scope changes, the component
 * automatically resets the page to 1 via `onPageChange` to prevent
 * stale pagination after filter changes.
 *
 * @example
 * ```tsx
 * // Minimal — plain list with loading indicator
 * <ResourceListView items={agents} isLoading={isLoading} />
 * ```
 *
 * @example
 * ```tsx
 * // Grid layout with action button
 * <ResourceListView
 *   layout="grid"
 *   items={mcpServers}
 *   isLoading={isLoading}
 *   onItemClick={(item) => navigate(item.slug)}
 *   renderItemAction={(item) => (
 *     <button onClick={(e) => { e.stopPropagation(); connect(item); }}>
 *       <PlusIcon />
 *     </button>
 *   )}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Full — search, scope toggle, pagination, and click handling
 * const [scope, setScope] = useState<ResourceListScope>("org");
 * const [query, setQuery] = useState("");
 * const [page, setPage] = useState(1);
 * const { agents, totalCount, totalPages, isLoading, error, refetch } =
 *   useAgentList(org, { query, scope, page });
 *
 * <ResourceListView
 *   items={agents}
 *   isLoading={isLoading}
 *   error={error}
 *   totalCount={totalCount}
 *   totalPages={totalPages}
 *   currentPage={page}
 *   onSearchChange={setQuery}
 *   searchPlaceholder="Search agents\u2026"
 *   scope={scope}
 *   onScopeChange={setScope}
 *   onPageChange={setPage}
 *   onItemClick={(item) => console.log(item.slug)}
 *   onRetry={refetch}
 * />
 * ```
 *
 * @see {@link useAgentList}, {@link useSkillList}, {@link useMcpServerList}
 * @see {@link ScopeToggle} for the scope toggle used in the toolbar
 */
export function ResourceListView({
  items,
  isLoading,
  error,
  totalCount,
  totalPages = 1,
  currentPage = 1,
  onSearchChange,
  searchPlaceholder = "Search\u2026",
  initialSearch = "",
  scope,
  onScopeChange,
  onPageChange,
  layout = "list",
  renderItem,
  renderItemAction,
  onItemClick,
  emptyIcon,
  emptyTitle = "No resources found",
  emptyDescription = "Try adjusting your search or scope.",
  onRetry,
  className,
  "aria-label": ariaLabel = "Resource list",
}: ResourceListViewProps) {
  const isGrid = layout === "grid";
  const showToolbar =
    !!onSearchChange || (scope !== undefined && !!onScopeChange);
  const showPagination = !!onPageChange && totalPages > 1;
  const isInteractive = !!onItemClick;

  // --- Search debounce ------------------------------------------------
  // The raw input value lives here; the parent only sees debounced values.
  const [inputValue, setInputValue] = useState(initialSearch);
  const isFirstRender = useRef(true);

  // Stable callback refs so the debounce timer is not reset when
  // the parent passes new callback identities on re-render.
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!onSearchChangeRef.current) return;

    const timer = setTimeout(() => {
      onSearchChangeRef.current?.(inputValue);
      onPageChangeRef.current?.(1);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [inputValue]);

  // --- Scope change resets page ---------------------------------------
  const handleScopeChange = useCallback(
    (newScope: ResourceListScope) => {
      onScopeChange?.(newScope);
      onPageChange?.(1);
    },
    [onScopeChange, onPageChange],
  );

  // --- Keyboard navigation for interactive items ----------------------
  // Implements roving tabindex: only the focused item has tabIndex 0,
  // all others have -1. Arrow keys move focus between items.
  // In list mode: Up/Down. In grid mode: all four arrow keys with
  // column-aware wrapping.
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gridColumnsRef = useRef(1);

  const moveFocus = useCallback(
    (from: HTMLDivElement, toIndex: number) => {
      const clamped = Math.max(0, Math.min(toIndex, items.length - 1));
      const el = itemRefs.current[clamped];
      if (el && el !== from) {
        from.tabIndex = -1;
        el.tabIndex = 0;
        el.focus();
      }
    },
    [items.length],
  );

  const detectGridColumns = useCallback(() => {
    if (!isGrid) return 1;
    const first = itemRefs.current[0];
    const second = itemRefs.current[1];
    if (!first || !second) return 1;
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    if (Math.abs(firstRect.top - secondRect.top) < 4) {
      let cols = 1;
      for (let i = 1; i < itemRefs.current.length; i++) {
        const r = itemRefs.current[i]?.getBoundingClientRect();
        if (r && Math.abs(r.top - firstRect.top) < 4) {
          cols++;
        } else {
          break;
        }
      }
      return cols;
    }
    return 1;
  }, [isGrid]);

  const handleItemKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      index: number,
      item: SearchResult,
    ) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onItemClick?.(item);
        return;
      }

      const cols = isGrid ? detectGridColumns() : 1;
      gridColumnsRef.current = cols;
      let target = index;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          target = isGrid ? Math.min(index + cols, items.length - 1) : Math.min(index + 1, items.length - 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          target = isGrid ? Math.max(index - cols, 0) : Math.max(index - 1, 0);
          break;
        case "ArrowRight":
          if (isGrid) {
            e.preventDefault();
            target = Math.min(index + 1, items.length - 1);
          }
          break;
        case "ArrowLeft":
          if (isGrid) {
            e.preventDefault();
            target = Math.max(index - 1, 0);
          }
          break;
        default:
          return;
      }

      if (target !== index) moveFocus(e.currentTarget, target);
    },
    [onItemClick, items.length, isGrid, detectGridColumns, moveFocus],
  );

  // --- Content resolution ---------------------------------------------
  const showSkeletons = isLoading && items.length === 0;
  const showError = !!error && !isLoading;
  const showEmpty = !isLoading && !error && items.length === 0;
  const showItems = items.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showToolbar && (
        <div role="search" className="flex items-center gap-2">
          {onSearchChange && (
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground-subtle" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className={cn(
                  "w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm",
                  "placeholder:text-muted-foreground-subtle",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
            </div>
          )}
          {scope !== undefined && onScopeChange && (
            <ScopeToggle value={scope} onChange={handleScopeChange} />
          )}
        </div>
      )}

      {showSkeletons && (isGrid ? <SkeletonCards /> : <SkeletonRows />)}

      {showError && <ErrorState message={error!.message} onRetry={onRetry} />}

      {showEmpty && (
        <EmptyState
          variant="zero-results"
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
        />
      )}

      {showItems && (
        <div
          role="list"
          aria-label={ariaLabel}
          aria-busy={isLoading || undefined}
          className={cn(
            isGrid
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : "flex flex-col",
            isLoading &&
              "pointer-events-none opacity-60 transition-opacity",
          )}
        >
          {items.map((item, index) => {
            const content = renderItem
              ? renderItem(item, index)
              : isGrid
                ? <DefaultResourceCard item={item} action={renderItemAction?.(item)} />
                : <DefaultResourceRow item={item} action={renderItemAction?.(item)} />;

            return (
              <div key={item.id || `resource-${index}`} role="listitem">
                {isInteractive ? (
                  <div
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    role="button"
                    tabIndex={index === 0 ? 0 : -1}
                    onClick={() => onItemClick!(item)}
                    onKeyDown={(e) => handleItemKeyDown(e, index, item)}
                    className={cn(
                      "group transition-colors",
                      isGrid
                        ? [
                            "flex h-full rounded-lg border border-border bg-card p-4",
                            "cursor-pointer hover:border-primary/40 hover:bg-accent-hover",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          ]
                        : [
                            "rounded-lg px-3 py-2.5",
                            "cursor-pointer hover:bg-accent-hover",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          ],
                    )}
                  >
                    {content}
                  </div>
                ) : (
                  <div
                    className={cn(
                      isGrid
                        ? "flex h-full rounded-lg border border-border bg-card p-4"
                        : "px-3 py-2.5",
                    )}
                  >
                    {content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showPagination && (
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={onPageChange!}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function DefaultResourceRow({
  item,
  action,
}: {
  readonly item: SearchResult;
  readonly action?: React.ReactNode;
}) {
  const displayName = item.name || item.slug;

  return (
    <div className="flex items-start gap-3">
      <RowIcon kind={item.kind} iconUrl={item.iconUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          {item.visibility === ApiResourceVisibility.visibility_public && (
            <VisibilityBadge />
          )}
        </div>
        <div className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">{item.org}</span>
          {item.description && (
            <>
              <span className="shrink-0" aria-hidden="true">
                {"\u00B7"}
              </span>
              <span className="line-clamp-2 group-hover:line-clamp-none">
                {item.description}
              </span>
            </>
          )}
        </div>
        {item.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {item.tags.length > MAX_VISIBLE_TAGS && (
              <span className="text-[10px] text-muted-foreground-subtle">
                +{item.tags.length - MAX_VISIBLE_TAGS} more
              </span>
            )}
          </div>
        )}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

function DefaultResourceCard({
  item,
  action,
}: {
  readonly item: SearchResult;
  readonly action?: React.ReactNode;
}) {
  const displayName = item.name || item.slug;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-start gap-3">
        <ResourceIcon kind={item.kind} iconUrl={item.iconUrl} />
        <div className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {displayName}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {item.org}
          </span>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {item.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      )}
      {item.visibility === ApiResourceVisibility.visibility_public && (
        <div className="mt-auto">
          <VisibilityBadge />
        </div>
      )}
    </div>
  );
}

function ResourceIcon({
  kind,
  iconUrl,
}: {
  readonly kind: ApiResourceKind;
  readonly iconUrl?: string;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
      {iconUrl && !imgError ? (
        <img
          src={iconUrl}
          alt=""
          className="size-6 rounded object-contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <KindIcon kind={kind} size="lg" />
      )}
    </span>
  );
}

function RowIcon({
  kind,
  iconUrl,
}: {
  readonly kind: ApiResourceKind;
  readonly iconUrl?: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (iconUrl && !imgError) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="mt-0.5 h-4 w-4 shrink-0 rounded-sm object-contain"
        onError={() => setImgError(true)}
      />
    );
  }

  return <KindIcon kind={kind} />;
}

function VisibilityBadge() {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Public
    </span>
  );
}

function KindIcon({
  kind,
  size = "sm",
}: {
  readonly kind: ApiResourceKind;
  readonly size?: "sm" | "lg";
}) {
  const cls = size === "lg"
    ? "h-5 w-5 shrink-0 text-muted-foreground"
    : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground";

  switch (kind) {
    case ApiResourceKind.agent:
      return <AgentIcon className={cls} />;
    case ApiResourceKind.skill:
      return <SkillIcon className={cls} />;
    case ApiResourceKind.mcp_server:
      return <McpServerIcon className={cls} />;
    case ApiResourceKind.workflow:
      return <WorkflowIcon className={cls} />;
    default:
      return <DocumentIcon className={cls} />;
  }
}

function SkeletonRows() {
  const widths = [36, 45, 30, 52, 40];

  return (
    <div aria-busy="true">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 px-3 py-2.5"
          aria-hidden="true"
        >
          <div className="mt-0.5 h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div
              className="h-4 animate-pulse rounded bg-muted"
              style={{ width: `${widths[i]}%` }}
            />
            <div
              className="h-3 animate-pulse rounded bg-muted"
              style={{ width: `${widths[i] + 25}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
    >
      {Array.from({ length: GRID_SKELETON_COUNT }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
          aria-hidden="true"
        >
          <div className="flex items-start gap-3">
            <div className="size-10 shrink-0 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}


function ErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 py-8 text-center"
    >
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium",
            "border border-input bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function PaginationBar({
  currentPage,
  totalPages,
  totalCount,
  onPageChange,
}: {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly totalCount?: number;
  readonly onPageChange: (page: number) => void;
}) {
  const navButtonClass = cn(
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
        {totalCount !== undefined &&
          `${totalCount.toLocaleString()} ${totalCount === 1 ? "result" : "results"}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          className={navButtonClass}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs text-muted-foreground">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          className={navButtonClass}
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the existing SDK pattern
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

function ChevronLeftIcon({ className }: { readonly className?: string }) {
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
      <path d="m10 3-5 5 5 5" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { readonly className?: string }) {
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
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function AgentIcon({ className }: { readonly className?: string }) {
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
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M6 9h.01M10 9h.01" strokeWidth="2" />
      <path d="M8 2v3" />
    </svg>
  );
}

function SkillIcon({ className }: { readonly className?: string }) {
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
      <path d="M9 1.5 4 9h4l-1 5.5L12 7H8l1-5.5Z" />
    </svg>
  );
}

function McpServerIcon({ className }: { readonly className?: string }) {
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
      <rect x="2" y="2" width="12" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WorkflowIcon({ className }: { readonly className?: string }) {
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
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 6v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" />
    </svg>
  );
}

function DocumentIcon({ className }: { readonly className?: string }) {
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
      <path d="M9 1.5H5c-.6 0-1 .4-1 1v11c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V5Z" />
      <path d="M9 1.5V5h3" />
    </svg>
  );
}
