"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceTemplate, TemplateCategory } from "./templates/types";
import { TEMPLATE_CATEGORY_LABELS } from "./templates/types";
import { useTemplateFilter } from "./useTemplateFilter";
import { TemplateCard } from "./TemplateCard";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link TemplateGallery}. */
export interface TemplateGalleryProps<TData> {
  /** Templates to display in the gallery. */
  readonly templates: readonly ResourceTemplate<TData>[];
  /** Called when the user selects a template. */
  readonly onSelect: (template: ResourceTemplate<TData>) => void;
  /**
   * Content to render when no templates match the search/filter.
   * Falls back to a built-in empty message if not provided.
   */
  readonly emptyContent?: ReactNode;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A searchable, filterable gallery of resource templates.
 *
 * Renders category tabs, a search input, and a responsive card grid.
 * Uses the headless `useTemplateFilter` hook for state — platform
 * builders who want custom rendering can use the hook directly.
 *
 * Keyboard navigation:
 * - Tab moves focus between the search input, category tabs, and cards
 * - Arrow keys (Left/Right) navigate between category tabs
 * - Enter/Space activates the focused tab or card
 *
 * All structural styling via `--stgm-*` tokens. Zero Console or
 * framework dependencies.
 *
 * @typeParam TData - The wizard data shape (e.g. `AgentWizardData`).
 *
 * @example
 * ```tsx
 * <TemplateGallery
 *   templates={AGENT_TEMPLATES}
 *   onSelect={(template) => startWizardWithTemplate(template)}
 * />
 * ```
 */
export function TemplateGallery<TData>({
  templates,
  onSelect,
  emptyContent,
  className,
}: TemplateGalleryProps<TData>) {
  const {
    filtered,
    query,
    setQuery,
    activeCategory,
    setActiveCategory,
    availableCategories,
  } = useTemplateFilter({ templates });

  const tabListRef = useRef<HTMLDivElement>(null);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tabs =
      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!tabs?.length) return;

    const currentIndex = Array.from(tabs).findIndex(
      (t) => t === document.activeElement,
    );
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      tabs[nextIndex]!.focus();
      tabs[nextIndex]!.click();
    }
  }, []);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Search input */}
      <div className="relative">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          aria-label="Search templates"
          className={cn(
            "w-full rounded-md border border-input bg-input-bg py-2 pl-9 pr-3 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      </div>

      {/* Category tabs */}
      {availableCategories.length > 1 && (
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Template categories"
          onKeyDown={handleTabKeyDown}
          className="flex flex-wrap gap-1"
        >
          <CategoryTab
            label="All"
            isActive={activeCategory === null}
            onClick={() => setActiveCategory(null)}
          />
          {availableCategories.map((cat) => (
            <CategoryTab
              key={cat}
              label={TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
              isActive={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>
      )}

      {/* Card grid or empty state */}
      {filtered.length > 0 ? (
        <div
          role="list"
          aria-label="Templates"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((template) => (
            <div key={template.id} role="listitem">
              <TemplateCard template={template} onSelect={onSelect} />
            </div>
          ))}
        </div>
      ) : (
        (emptyContent ?? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No templates match your search.
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function CategoryTab({
  label,
  isActive,
  onClick,
}: {
  readonly label: string;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx={11} cy={11} r={8} />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
