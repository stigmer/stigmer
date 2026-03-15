"use client";

import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@stigmer/theme";
import { Button } from "@/components/ui/button";
import type { UseResourceCatalogReturn } from "@/hooks/useResourceCatalog";
import { ResourceCard } from "./ResourceCard";
import { CatalogEmptyState } from "./CatalogEmptyState";

interface ResourceListProps {
  kind: ApiResourceKind;
  catalog: UseResourceCatalogReturn;
}

export function ResourceList({ kind, catalog }: ResourceListProps) {
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
  } = catalog;

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
            aria-label="Search resources"
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
      {error && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
        >
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && results.length === 0 && !error && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/50 h-[72px] animate-pulse rounded-xl"
            />
          ))}
        </div>
      )}

      {/* Results */}
      {!isLoading && results.length === 0 && !error && (
        <CatalogEmptyState kind={kind} hasQuery={query.length > 0} />
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <ResourceCard key={result.id} result={result} />
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
