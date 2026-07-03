"use client";

import { useCallback, useContext, useSyncExternalStore } from "react";
import type { SelectedThreadItem } from "../internal/store/selection-store.js";
import { ThreadSelectionContext } from "./ThreadSelectionContext.js";

/**
 * Return value of {@link useThreadSelection} when a provider is present.
 *
 * - `isSelected`: whether *this* item is currently selected.
 * - `select`: callback to select/toggle this item.
 *
 * Both are referentially stable (safe as `useEffect`/`useMemo` deps).
 */
export interface ThreadSelectionHandle {
  readonly isSelected: boolean;
  readonly select: () => void;
}

const NOOP_SUBSCRIBE = (_cb: () => void) => () => {};
const NOOP_SNAPSHOT = () => false;

/**
 * Per-item selection hook for thread leaves.
 *
 * Uses `useSyncExternalStore` so only the previously- and
 * newly-selected rows re-render on a selection change (≤2 rows).
 *
 * Returns `null` when `ThreadSelectionContext` is absent (DD-011:
 * opt-in, backward compatible). Callers should guard:
 *
 * ```tsx
 * const selection = useThreadSelection("tool-call", tc.id);
 * // selection is null when no provider → no selection affordance
 * ```
 */
export function useThreadSelection(
  kind: SelectedThreadItem["kind"],
  id: string,
): ThreadSelectionHandle | null {
  const store = useContext(ThreadSelectionContext);

  const subscribe = store?.subscribe ?? NOOP_SUBSCRIBE;
  const getSnapshot = store
    ? () => store.isSelected(kind, id)
    : NOOP_SNAPSHOT;

  const isSelected = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const select = useCallback(() => {
    if (!store) return;
    const item = buildItem(kind, id);
    store.toggle(item);
  }, [store, kind, id]);

  if (!store) return null;

  return { isSelected, select };
}

/**
 * Hook to read the full selection from the store (for the InspectTab).
 *
 * Returns `null` when no provider is present or nothing is selected.
 */
export function useSelectedThreadItem(): SelectedThreadItem | null {
  const store = useContext(ThreadSelectionContext);

  const subscribe = store?.subscribe ?? NOOP_SUBSCRIBE;
  const getSnapshot = store
    ? store.getSelection
    : () => null;

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildItem(
  kind: SelectedThreadItem["kind"],
  id: string,
): SelectedThreadItem {
  switch (kind) {
    case "tool-call":
      return { kind: "tool-call", toolCallId: id };
    case "sub-agent":
      return { kind: "sub-agent", subAgentId: id };
    case "artifact":
      return { kind: "artifact", artifactKey: id };
    case "write-back":
      return { kind: "write-back", workspaceEntryName: id };
  }
}
