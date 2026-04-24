"use client";

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@stigmer/theme";

export interface TabItem {
  /** Unique identifier for the tab, used as the `activeTab` value. */
  readonly id: string;
  /** Display label shown in the tab trigger. */
  readonly label: string;
  /** Optional numeric badge rendered next to the label (e.g. item count). */
  readonly badge?: number;
}

export interface TabsProps {
  /** Ordered list of tabs to render. Tabs with no matching content are still clickable. */
  readonly tabs: readonly TabItem[];
  /** The `id` of the currently active tab. */
  readonly activeTab: string;
  /** Called when the user selects a different tab. */
  readonly onTabChange: (tabId: string) => void;
  /**
   * Content to render in the active tab panel.
   * Typically a switch/map over `activeTab`.
   */
  readonly children: ReactNode;
  /** Accessible label for the tab list (e.g. "Capability sections"). */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Accessible tabbed panel with badge support.
 *
 * Implements the WAI-ARIA Tabs pattern:
 * - `role="tablist"` / `role="tab"` / `role="tabpanel"`
 * - Arrow-key navigation (Left/Right), Home/End to jump
 * - `aria-selected`, `aria-controls`, `aria-labelledby` wiring
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * No external dependencies — safe for platform builder embedding.
 *
 * @internal — not yet part of the public `@stigmer/react` API.
 */
export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  children,
  "aria-label": ariaLabel,
  className,
}: TabsProps) {
  const instanceId = useId();
  const tabRefsMap = useRef<Map<string, HTMLButtonElement>>(new Map());

  const tabId = (id: string) => `${instanceId}-tab-${id}`;
  const panelId = (id: string) => `${instanceId}-panel-${id}`;

  const focusTab = useCallback(
    (id: string) => {
      tabRefsMap.current.get(id)?.focus();
      onTabChange(id);
    },
    [onTabChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      if (currentIndex === -1) return;

      let nextIndex: number | null = null;

      switch (e.key) {
        case "ArrowRight":
          nextIndex = (currentIndex + 1) % tabs.length;
          break;
        case "ArrowLeft":
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      focusTab(tabs[nextIndex].id);
    },
    [tabs, activeTab, focusTab],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className="flex border-b border-border"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefsMap.current.set(tab.id, el);
                else tabRefsMap.current.delete(tab.id);
              }}
              id={tabId(tab.id)}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={panelId(tab.id)}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              data-cursor-target={`tab-${tab.id}`}
              className={cn(
                "relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span
                  className={cn(
                    "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 py-px text-[10px] font-medium leading-none",
                    isActive
                      ? "bg-primary-subtle text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              )}
              {isActive && (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        id={panelId(activeTab)}
        role="tabpanel"
        aria-labelledby={tabId(activeTab)}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
