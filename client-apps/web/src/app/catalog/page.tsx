"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Play,
} from "lucide-react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceCard, CatalogEmptyState, KindTabs } from "@/components/catalog";
import { useUnifiedCatalog } from "@/hooks/useUnifiedCatalog";

export const dynamic = "force-dynamic";

const KIND_PARAM_MAP: Record<string, ApiResourceKind> = {
  agent: ApiResourceKind.agent,
  skill: ApiResourceKind.skill,
  mcp_server: ApiResourceKind.mcp_server,
};

const REVERSE_KIND_MAP = new Map<ApiResourceKind, string>(
  Object.entries(KIND_PARAM_MAP).map(([key, value]) => [value, key]),
);

function parseKindParam(value: string | null): ApiResourceKind | null {
  if (!value) return null;
  return KIND_PARAM_MAP[value] ?? null;
}

export default function CatalogPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const catalog = useUnifiedCatalog();
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
    activeKind,
    setActiveKind,
    countsByKind,
  } = catalog;

  // Sync URL → state on mount only. Subsequent state changes push to URL.
  const urlKind = searchParams.get("kind");
  const urlQuery = searchParams.get("q");

  useEffect(() => {
    const parsedKind = parseKindParam(urlKind);
    if (parsedKind !== activeKind) {
      setActiveKind(parsedKind);
    }
    if (urlQuery && urlQuery !== query) {
      setQuery(urlQuery);
    }
    // Intentionally run only on mount to seed from URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrl(kind: ApiResourceKind | null, q: string) {
    const params = new URLSearchParams();
    if (kind != null) {
      params.set("kind", REVERSE_KIND_MAP.get(kind) ?? "");
    }
    if (q) {
      params.set("q", q);
    }
    const qs = params.toString();
    router.replace(qs ? `/catalog?${qs}` : "/catalog", { scroll: false });
  }

  function handleKindChange(kind: ApiResourceKind | null) {
    setActiveKind(kind);
    updateUrl(kind, query);
  }

  function handleQueryChange(q: string) {
    setQuery(q);
    updateUrl(activeKind, q);
  }

  const emptyKind = activeKind ?? ApiResourceKind.agent;

  return (
    <>
      <TopBar
        title="Catalog"
        description="Browse and search agents, skills, and MCP servers"
        actions={
          <Link
            href="/run"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        }
      />

      <div className="space-y-4">
        <KindTabs
          activeKind={activeKind}
          onKindChange={handleKindChange}
          countsByKind={countsByKind}
          totalCount={totalCount}
        />

        {/* Search + result count */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search..."
              aria-label="Search resources"
              className={cn(
                "w-full rounded-lg border bg-background py-2 pl-9 pr-9 text-sm",
                "placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            {isLoading && (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {totalCount > 0 && (
            <p className="shrink-0 text-xs text-muted-foreground">
              {totalCount} {totalCount === 1 ? "result" : "results"}
            </p>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
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
                className="h-[72px] animate-pulse rounded-xl bg-muted/50"
              />
            ))}
          </div>
        )}

        {/* Results */}
        {!isLoading && results.length === 0 && !error && (
          <CatalogEmptyState kind={emptyKind} hasQuery={query.length > 0} />
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
            <span className="text-xs text-muted-foreground">
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
    </>
  );
}
