"use client";

import { useCallback, useMemo, useState } from "react";
import type { ResourceTemplate, TemplateCategory } from "./templates/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for {@link useTemplateFilter}. */
export interface UseTemplateFilterOptions<TData> {
  /** The full set of templates to filter. */
  readonly templates: readonly ResourceTemplate<TData>[];
}

/** Return value of {@link useTemplateFilter}. */
export interface UseTemplateFilterReturn<TData> {
  /** Templates matching the current search query and active category. */
  readonly filtered: readonly ResourceTemplate<TData>[];
  /** Current search query string. */
  readonly query: string;
  /** Update the search query. */
  readonly setQuery: (query: string) => void;
  /** Currently active category filter, or `null` for "All". */
  readonly activeCategory: TemplateCategory | null;
  /** Set the active category filter. Pass `null` to show all. */
  readonly setActiveCategory: (category: TemplateCategory | null) => void;
  /** Deduplicated, sorted list of categories present in the template set. */
  readonly availableCategories: readonly TemplateCategory[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless hook for filtering and searching a set of resource templates.
 *
 * Provides category tab state, text search across name/description/tags,
 * and the filtered result set. Fully memoized — only recalculates when
 * inputs change.
 *
 * Platform builders can use this hook with their own rendering; the
 * styled `TemplateGallery` component uses it internally.
 *
 * @typeParam TData - The wizard data shape (e.g. `AgentWizardData`).
 *
 * @example
 * ```tsx
 * const { filtered, query, setQuery, activeCategory, setActiveCategory, availableCategories } =
 *   useTemplateFilter({ templates: AGENT_TEMPLATES });
 *
 * // Render your own gallery UI using `filtered`
 * ```
 */
export function useTemplateFilter<TData>(
  options: UseTemplateFilterOptions<TData>,
): UseTemplateFilterReturn<TData> {
  const { templates } = options;

  const [query, setQueryRaw] = useState("");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | null>(
    null,
  );

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
  }, []);

  const availableCategories = useMemo(() => {
    const seen = new Set<TemplateCategory>();
    for (const t of templates) {
      seen.add(t.category);
    }
    const sorted = [...seen].sort();
    return sorted;
  }, [templates]);

  const filtered = useMemo(() => {
    let result: readonly ResourceTemplate<TData>[] = templates;

    if (activeCategory) {
      result = result.filter((t) => t.category === activeCategory);
    }

    const trimmed = query.trim().toLowerCase();
    if (trimmed) {
      result = result.filter((t) => {
        const haystack = [t.name, t.description, ...(t.tags ?? [])]
          .join(" ")
          .toLowerCase();
        return haystack.includes(trimmed);
      });
    }

    return result;
  }, [templates, activeCategory, query]);

  return useMemo(
    () => ({
      filtered,
      query,
      setQuery,
      activeCategory,
      setActiveCategory,
      availableCategories,
    }),
    [
      filtered,
      query,
      setQuery,
      activeCategory,
      setActiveCategory,
      availableCategories,
    ],
  );
}
