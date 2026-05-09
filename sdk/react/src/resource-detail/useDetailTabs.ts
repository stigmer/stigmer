"use client";

import { useCallback, useMemo, useState } from "react";
import type { TabItem } from "../tabs/Tabs";
import type { AdditionalTab } from "./types";

/**
 * Return type for the internal detail tabs hook.
 *
 * When `effectiveTabs` is `undefined`, the consumer should NOT render
 * a tab bar (single-tab suppression per DD-T05A-002).
 */
export interface UseDetailTabsReturn {
  /** Tab items to pass to ResourceDetailShell. `undefined` = suppress tab bar. */
  readonly effectiveTabs: readonly TabItem[] | undefined;
  /** The currently active tab ID. */
  readonly effectiveActiveTab: string;
  /** Handler to pass to ResourceDetailShell's `onTabChange`. */
  readonly effectiveOnTabChange: (tabId: string) => void;
  /** The additional tab whose content should be rendered, or `undefined` if a built-in tab is active. */
  readonly activeAdditionalTab: AdditionalTab | undefined;
}

interface UseDetailTabsOptions {
  /** Built-in tabs defined by the SDK component (e.g., [{ id: "overview", label: "Overview" }]). */
  readonly builtInTabs: readonly TabItem[];
  /** Consumer-provided extension tabs. */
  readonly additionalTabs?: readonly AdditionalTab[];
  /** Controlled active tab (enables controlled mode when paired with `onTabChange`). */
  readonly activeTab?: string;
  /** Controlled tab change handler (enables controlled mode when paired with `activeTab`). */
  readonly onTabChange?: (tabId: string) => void;
  /** Default tab to show when in uncontrolled mode. Defaults to the first built-in tab's ID. */
  readonly defaultTab?: string;
}

/**
 * Internal hook that manages tab state for detail view components.
 *
 * Implements the uncontrolled-by-default / controlled-when-specified
 * pattern (DD-T05A-001):
 * - When both `activeTab` and `onTabChange` are provided, the component
 *   operates in controlled mode (consumer owns the state).
 * - Otherwise, the component manages its own internal tab state.
 *
 * Single-tab suppression (DD-T05A-002):
 * - When only one tab exists (no additionalTabs), `effectiveTabs` is
 *   `undefined` so the consumer skips rendering the tab bar entirely.
 */
export function useDetailTabs({
  builtInTabs,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
}: UseDetailTabsOptions): UseDetailTabsReturn {
  const isControlled = activeTab !== undefined && onTabChange !== undefined;

  const allTabs = useMemo<readonly TabItem[]>(() => {
    if (!additionalTabs || additionalTabs.length === 0) return builtInTabs;
    return [...builtInTabs, ...additionalTabs];
  }, [builtInTabs, additionalTabs]);

  const initialTab = defaultTab ?? builtInTabs[0]?.id ?? "";
  const [internalTab, setInternalTab] = useState(initialTab);

  const effectiveActiveTab = isControlled ? activeTab : internalTab;

  const effectiveOnTabChange = useCallback(
    (tabId: string) => {
      if (isControlled) {
        onTabChange(tabId);
      } else {
        setInternalTab(tabId);
      }
    },
    [isControlled, onTabChange],
  );

  const effectiveTabs = allTabs.length > 1 ? allTabs : undefined;

  const activeAdditionalTab = useMemo(() => {
    if (!additionalTabs) return undefined;
    return additionalTabs.find((t) => t.id === effectiveActiveTab);
  }, [additionalTabs, effectiveActiveTab]);

  return {
    effectiveTabs,
    effectiveActiveTab,
    effectiveOnTabChange,
    activeAdditionalTab,
  };
}
