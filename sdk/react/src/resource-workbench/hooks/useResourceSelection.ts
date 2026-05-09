"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Return value of {@link useResourceSelection}. */
export interface UseResourceSelectionReturn<TData> {
  /** Set of currently selected item IDs. */
  readonly selectedIds: ReadonlySet<string>;
  /** The full selected items (resolved from the current items array). */
  readonly selectedItems: readonly TData[];
  /** Number of selected items. */
  readonly selectedCount: number;
  /** `true` when at least one item is selected. */
  readonly hasSelection: boolean;
  /** `true` when all visible items are selected. */
  readonly allSelected: boolean;
  /** `true` when some (but not all) visible items are selected. */
  readonly someSelected: boolean;
  /** Toggle a single item's selection state. */
  readonly toggleItem: (id: string) => void;
  /**
   * Range-select from the last toggled item to the given ID (shift-click).
   * Selects all items between them (inclusive).
   */
  readonly rangeSelectTo: (id: string) => void;
  /** Select or deselect all visible items. */
  readonly toggleAll: () => void;
  /** Clear all selections. */
  readonly clearSelection: () => void;
}

/**
 * Headless hook that manages selection state for a resource collection.
 *
 * Supports single toggle, shift-click range selection, select-all, and
 * automatic clearing when the items array identity changes (page or
 * filter change).
 *
 * @param items      The current page of items. Used to resolve selected
 *                   items and to implement range selection.
 * @param getItemId  Extracts a stable unique ID from an item.
 *
 * @example
 * ```tsx
 * const selection = useResourceSelection(items, (item) => item.id);
 * ```
 */
export function useResourceSelection<TData>(
  items: readonly TData[],
  getItemId: (item: TData) => string,
): UseResourceSelectionReturn<TData> {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Track the last toggled item for shift-click range selection.
  const lastToggledRef = useRef<string | null>(null);

  // Clear selection when items change (page navigation, filter change).
  // We use the length + first/last ID as a heuristic to detect a new page
  // without requiring referential stability on the items array.
  const itemsKey = useMemo(() => {
    if (items.length === 0) return "empty";
    const first = getItemId(items[0]);
    const last = getItemId(items[items.length - 1]);
    return `${items.length}:${first}:${last}`;
  }, [items, getItemId]);

  const prevItemsKey = useRef(itemsKey);
  useEffect(() => {
    if (prevItemsKey.current !== itemsKey) {
      prevItemsKey.current = itemsKey;
      setSelectedIds(new Set());
      lastToggledRef.current = null;
    }
  }, [itemsKey]);

  const toggleItem = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        lastToggledRef.current = id;
        return next;
      });
    },
    [],
  );

  const rangeSelectTo = useCallback(
    (id: string) => {
      const lastId = lastToggledRef.current;
      if (!lastId) {
        // No previous anchor — fall back to single toggle.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        lastToggledRef.current = id;
        return;
      }

      const ids = items.map(getItemId);
      const anchorIndex = ids.indexOf(lastId);
      const targetIndex = ids.indexOf(id);

      if (anchorIndex === -1 || targetIndex === -1) {
        // One of the endpoints isn't in the current list — single toggle.
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        lastToggledRef.current = id;
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = ids.slice(start, end + 1);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const rangeId of rangeIds) {
          next.add(rangeId);
        }
        return next;
      });
      lastToggledRef.current = id;
    },
    [items, getItemId],
  );

  const toggleAll = useCallback(() => {
    const allIds = items.map(getItemId);
    setSelectedIds((prev) => {
      const allCurrentlySelected = allIds.every((id) => prev.has(id));
      if (allCurrentlySelected) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, [items, getItemId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastToggledRef.current = null;
  }, []);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(getItemId(item))),
    [items, selectedIds, getItemId],
  );

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;
  const allSelected =
    items.length > 0 && items.every((item) => selectedIds.has(getItemId(item)));
  const someSelected = hasSelection && !allSelected;

  return {
    selectedIds,
    selectedItems,
    selectedCount,
    hasSelection,
    allSelected,
    someSelected,
    toggleItem,
    rangeSelectTo,
    toggleAll,
    clearSelection,
  };
}
