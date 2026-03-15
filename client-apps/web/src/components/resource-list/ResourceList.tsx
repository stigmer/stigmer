"use client";

import { Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@stigmer/theme";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ResourceEmptyState } from "./ResourceEmptyState";

export interface ResourceListData {
  results: SearchResult[];
  query: string;
  setQuery: (q: string) => void;
  isLoading: boolean;
  error: Error | null;
  totalCount: number;
  totalPages: number;
  page: number;
  setPage: (page: number) => void;
  retry?: () => void;
}

interface ResourceListProps {
  kindLabel: "agents" | "skills" | "MCP servers";
  data: ResourceListData;
  renderItem: (result: SearchResult) => React.ReactNode;
  layout?: "list" | "grid";
}

export function ResourceList({
  kindLabel,
  data,
  renderItem,
  layout = "list",
}: ResourceListProps) {
  const {
    results,
    query,
    setQuery,
    isLoading,
    error,
    totalCount,
    totalPages,
    page,
    setPage,
    retry,
  } = data;

  return (
    <div className="space-y-4">
      {/* Search + result count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            aria-label={`Search ${kindLabel}`}
            className={cn(
              "bg-background w-full rounded-lg border py-2 pr-9 pl-9 text-sm",
              "placeholder:text-muted-foreground",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          />
          {isLoading && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          )}
        </div>
        {totalCount > 0 && (
          <p className="text-muted-foreground shrink-0 text-xs">
            {totalCount} {totalCount === 1 ? "result" : "results"}
          </p>
        )}
      </div>

      {/* Error banner */}
      <ErrorMessage error={error} retry={retry} />

      {/* Loading skeleton */}
      {isLoading && results.length === 0 && !error && (
        <div
          className={cn(
            layout === "grid"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : "space-y-3",
          )}
        >
          {Array.from({ length: layout === "grid" ? 6 : 5 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "bg-muted/50 animate-pulse rounded-xl",
                layout === "grid" ? "h-[140px]" : "h-[72px]",
              )}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && results.length === 0 && !error && (
        <ResourceEmptyState kind={kindLabel} hasQuery={query.length > 0} />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div
          className={cn(
            layout === "grid"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              : "space-y-2",
          )}
        >
          {results.map((result) => (
            <div key={result.id}>{renderItem(result)}</div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            aria-label="Previous page"
            className="size-8"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            aria-label="Next page"
            className="size-8"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
