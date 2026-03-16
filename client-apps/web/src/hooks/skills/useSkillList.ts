"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStigmer } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { skillKeys } from "./keys";

const DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Paginated skill list with debounced search, scoped to the active org.
 *
 * Refetches automatically when the user switches orgs.
 */
export function useSkillList() {
  const org = useActiveOrgSlug();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const stigmer = useStigmer();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: skillKeys.list({ org, query: debouncedQuery, page }),
    queryFn: () =>
      stigmer.skill.list({
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
    error: error ?? null,
    totalCount: data?.totalCount ?? 0,
    totalPages: data?.totalPages ?? 0,
    page,
    setPage,
    retry: refetch,
  };
}
