"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceTemplate, TemplateCategory } from "./templates/types.js";
import { TEMPLATE_CATEGORY_LABELS } from "./templates/types.js";
import { useTemplateFilter } from "./useTemplateFilter.js";
import { TemplateCard } from "./TemplateCard.js";

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
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {/* Search input */}
      <div className="stg:relative">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          aria-label="Search templates"
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:py-2 stg:pl-9 stg:pr-3 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
          className="stg:flex stg:flex-wrap stg:gap-1"
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
          className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-3"
        >
          {filtered.map((template) => (
            <div key={template.id} role="listitem">
              <TemplateCard template={template} onSelect={onSelect} />
            </div>
          ))}
        </div>
      ) : (
        (emptyContent ?? (
          <div className="stg:py-8 stg:text-center stg:text-sm stg:text-muted-foreground">
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
        "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        isActive
          ? "stg:bg-primary stg:text-primary-foreground"
          : "stg:bg-muted stg:text-muted-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      className="stg:pointer-events-none stg:absolute stg:left-3 stg:top-1/2 stg:size-4 stg:-translate-y-1/2 stg:text-muted-foreground"
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
