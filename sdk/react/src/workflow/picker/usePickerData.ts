"use client";

import { useMemo } from "react";
import type { TaskKindDescriptor, TaskKindCategory } from "../types.js";
import type { WorkflowGraphModel } from "../workflow-graph-model.js";
import { CATEGORY_ORDER } from "../canvas-constants.js";
import type { InsertionContext } from "./insertion-context.js";
import { buildInsertionHeader } from "./insertion-context.js";
import { getSuggestedKinds, type TaskKindSuggestion } from "./suggestions.js";
import { getDisabledKinds, getHiddenKinds, type DisabledKindEntry } from "./compatibility.js";
import { getRecentKinds } from "./recents.js";

/**
 * A picker item enriched with context-awareness metadata.
 */
export interface PickerItem {
  readonly descriptor: TaskKindDescriptor;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

/**
 * A named section in the picker (Suggested, Recent, or a category group).
 */
export interface PickerSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PickerItem[];
  /** If true, this section is a special (Suggested/Recent) section, not a category. */
  readonly isSpecial?: boolean;
}

/**
 * The complete picker data model returned by {@link usePickerData}.
 */
export interface PickerData {
  /** Contextual header text (e.g., "Insert between A and B"). */
  readonly header: string;
  /** Ordered sections to render in the picker. */
  readonly sections: readonly PickerSection[];
  /** Flat list of all selectable (non-disabled) items for keyboard navigation. */
  readonly selectableItems: readonly PickerItem[];
  /** Whether the registry is still loading. */
  readonly isLoading: boolean;
}

/**
 * Computes the full picker data model from insertion context, task registry,
 * and graph model.
 *
 * This hook is the bridge between the pure intelligence layer (suggestions,
 * compatibility, recents) and the picker UI component. It produces a stable,
 * memoized data structure that drives rendering.
 *
 * @param context - The insertion context describing where and how the user is inserting.
 * @param categories - Category-grouped task descriptors from `useTaskKindRegistry()`.
 * @param graph - The current workflow graph model (for constraint evaluation).
 * @param isLoading - Whether the task kind registry is still loading.
 * @param searchQuery - Current search query for filtering.
 */
export function usePickerData(
  context: InsertionContext | null,
  categories: ReadonlyMap<TaskKindCategory, readonly TaskKindDescriptor[]>,
  graph: WorkflowGraphModel | null,
  isLoading: boolean,
  searchQuery: string,
): PickerData {
  return useMemo(() => {
    const effectiveContext: InsertionContext = context ?? { mode: "add-at-position" };

    if (isLoading) {
      return {
        header: buildInsertionHeader(effectiveContext),
        sections: [],
        selectableItems: [],
        isLoading,
      };
    }

    const header = buildInsertionHeader(effectiveContext);
    const hiddenKinds = getHiddenKinds();
    const disabledEntries = graph ? getDisabledKinds(effectiveContext, graph) : [];
    const disabledMap = new Map(disabledEntries.map((d) => [d.kind, d.reason]));

    // Build a flat lookup of all descriptors by kind
    const allDescriptors = new Map<string, TaskKindDescriptor>();
    for (const descriptors of categories.values()) {
      for (const d of descriptors) {
        if (!hiddenKinds.has(d.kind)) {
          allDescriptors.set(d.kind, d);
        }
      }
    }

    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = (d: TaskKindDescriptor) =>
      !query ||
      d.displayName.toLowerCase().includes(query) ||
      d.description.toLowerCase().includes(query) ||
      d.kind.toLowerCase().includes(query);

    const toPickerItem = (d: TaskKindDescriptor): PickerItem => ({
      descriptor: d,
      disabled: disabledMap.has(d.kind),
      disabledReason: disabledMap.get(d.kind),
    });

    const sections: PickerSection[] = [];

    // --- Suggested section ---
    if (!query) {
      const suggestions = getSuggestedKinds(effectiveContext);
      const suggestedItems = suggestions
        .map((s) => allDescriptors.get(s.kind))
        .filter((d): d is TaskKindDescriptor => d !== undefined)
        .map(toPickerItem);

      if (suggestedItems.length > 0) {
        sections.push({
          id: "__suggested",
          label: "Suggested",
          items: suggestedItems,
          isSpecial: true,
        });
      }
    }

    // --- Recent section ---
    if (!query) {
      const recents = getRecentKinds();
      const recentItems = recents
        .map((r) => allDescriptors.get(r.kind))
        .filter((d): d is TaskKindDescriptor => d !== undefined)
        .map(toPickerItem);

      if (recentItems.length > 0) {
        sections.push({
          id: "__recent",
          label: "Recent",
          items: recentItems,
          isSpecial: true,
        });
      }
    }

    // --- Category sections ---
    for (const cat of CATEGORY_ORDER) {
      const descriptors = categories.get(cat);
      if (!descriptors || descriptors.length === 0) continue;

      const filtered = descriptors
        .filter((d) => !hiddenKinds.has(d.kind) && matchesSearch(d))
        .map(toPickerItem);

      if (filtered.length > 0) {
        sections.push({
          id: cat,
          label: cat, // Display name is resolved by the UI component
          items: filtered,
        });
      }
    }

    // Build flat selectable list (excludes disabled items)
    const selectableItems = sections
      .flatMap((s) => s.items)
      .filter((item) => !item.disabled);

    return { header, sections, selectableItems, isLoading };
  }, [context, categories, graph, isLoading, searchQuery]);
}
