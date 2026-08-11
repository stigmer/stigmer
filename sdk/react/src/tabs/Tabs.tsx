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
  /** Optional icon rendered before the label. */
  readonly icon?: ReactNode;
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
  /** Accessible label for the tab list (e.g. "Agent detail sections"). */
  readonly "aria-label"?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Accessible tabbed panel with badge and icon support.
 *
 * Implements the WAI-ARIA Tabs pattern:
 * - `role="tablist"` / `role="tab"` / `role="tabpanel"`
 * - Arrow-key navigation (Left/Right), Home/End to jump
 * - `aria-selected`, `aria-controls`, `aria-labelledby` wiring
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * No external dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const [tab, setTab] = useState("overview");
 *
 * <Tabs
 *   tabs={[
 *     { id: "overview", label: "Overview" },
 *     { id: "activity", label: "Activity", badge: 3 },
 *   ]}
 *   activeTab={tab}
 *   onTabChange={setTab}
 *   aria-label="Agent sections"
 * >
 *   {tab === "overview" ? <Overview /> : <Activity />}
 * </Tabs>
 * ```
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
    <div className={cn("stg:flex stg:flex-col", className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className="stg:flex stg:border-b stg:border-border"
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
                "stg:relative stg:inline-flex stg:items-center stg:gap-1.5 stg:px-3 stg:py-2 stg:text-xs stg:font-medium stg:transition-colors",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-1",
                isActive
                  ? "stg:text-foreground"
                  : "stg:text-muted-foreground stg:hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "stg:inline-flex stg:min-w-[1.25rem] stg:items-center stg:justify-center stg:rounded-full stg:px-1 stg:py-px stg:text-[10px] stg:font-medium stg:leading-none",
                    isActive
                      ? "stg:bg-primary-subtle stg:text-primary"
                      : "stg:bg-muted stg:text-muted-foreground",
                  )}
                >
                  {tab.badge}
                </span>
              )}
              {isActive && (
                <span
                  className="stg:absolute stg:inset-x-0 stg:-bottom-px stg:h-0.5 stg:bg-primary"
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
        className="stg:min-h-0 stg:flex-1 stg:pt-4 stg:focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
