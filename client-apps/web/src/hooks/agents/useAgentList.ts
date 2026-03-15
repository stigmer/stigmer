"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent-ui";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { agentKeys } from "./keys";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Paginated agent list with debounced search, scoped to the active org.
 *
 * Uses page-based pagination (matching the existing `useResourceCatalog`
 * contract) rather than infinite scroll, preserving the current `ResourceList`
 * UI behavior. The search query is debounced so that typing fires at most one
 * request per 300ms.
 *
 * Refetches automatically when the user switches orgs via `useActiveOrgSlug`.
 */
export function useAgentList() {
  const org = useActiveOrgSlug();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const service = useAgentQueryService();

  const { data, isLoading, error } = useQuery({
    queryKey: agentKeys.list({ org, query: debouncedQuery, page }),
    queryFn: () =>
      service.search({
        query: debouncedQuery,
        org,
        page: { num: page, size: DEFAULT_PAGE_SIZE },
      }),
  });

  const handleSetQuery = (q: string) => {
    setQuery(q);
    setPage(1);
  };

  return {
    results: data?.entries ?? [],
    query,
    setQuery: handleSetQuery,
    isLoading,
    error: error ? (error as Error).message : null,
    totalCount: data?.totalCount ?? 0,
    totalPages: data?.totalPages ?? 0,
    page,
    setPage,
  };
}
