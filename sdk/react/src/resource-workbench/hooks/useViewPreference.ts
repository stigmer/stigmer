"use client";

import { useCallback, useState } from "react";
import type { ViewMode } from "../types";

/** Return value of {@link useViewPreference}. */
export interface UseViewPreferenceReturn {
  /** The currently active view mode. */
  readonly viewMode: ViewMode;
  /** Update the view mode. Persists to localStorage when a storage key is provided. */
  readonly setViewMode: (mode: ViewMode) => void;
}

const VALID_MODES: ReadonlySet<string> = new Set<ViewMode>([
  "table",
  "cards",
  "list",
]);

function isValidMode(value: string): value is ViewMode {
  return VALID_MODES.has(value);
}

/**
 * Persists the user's preferred view mode (table / cards / list) in
 * localStorage, scoped by a caller-provided storage key.
 *
 * Falls back to `defaultMode` when no persisted value exists or when
 * the stored value is invalid (forward-compatible with future modes).
 *
 * Pass `undefined` for `storageKey` to use an ephemeral (non-persisted)
 * view mode that resets on unmount.
 *
 * @param storageKey  localStorage key (e.g. `"stigmer:workbench:agents:viewMode"`).
 *                    Pass `undefined` to disable persistence.
 * @param defaultMode The view mode to use when no persisted value exists.
 *
 * @example
 * ```tsx
 * const { viewMode, setViewMode } = useViewPreference(
 *   "stigmer:workbench:agents:viewMode",
 *   "table",
 * );
 * ```
 */
export function useViewPreference(
  storageKey: string | undefined,
  defaultMode: ViewMode,
): UseViewPreferenceReturn {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    if (!storageKey || typeof window === "undefined") return defaultMode;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && isValidMode(stored)) return stored;
    } catch {
      // localStorage may be unavailable (e.g. sandboxed iframe).
    }
    return defaultMode;
  });

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeState(mode);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, mode);
      } catch {
        // Silently ignore write failures.
      }
    },
    [storageKey],
  );

  return { viewMode, setViewMode };
}
