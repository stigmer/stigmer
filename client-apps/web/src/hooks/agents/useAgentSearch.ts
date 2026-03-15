"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAgentQueryService } from "@stigmer/agent";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { agentKeys } from "./keys";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Debounced agent search hook scoped to the active organization.
 *
 * On mount, fetches a default list (empty query = all accessible agents,
 * sorted by creation date). The search query is debounced so that typing
 * fires at most one request per 300ms.
 *
 * Refetches automatically when the user switches orgs.
 */
export function useAgentSearch() {
  const org = useActiveOrgSlug();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const service = useAgentQueryService();

  const { data, isLoading, error } = useQuery({
    queryKey: agentKeys.search(debouncedQuery, org),
    queryFn: () =>
      service.search({
        query: debouncedQuery,
        org,
        page: { num: 1, size: DEFAULT_PAGE_SIZE },
      }),
  });

  return {
    query,
    setQuery,
    results: data?.entries ?? [],
    isLoading,
    error: error ? (error as Error).message : null,
    totalCount: data?.totalCount ?? 0,
  };
}
