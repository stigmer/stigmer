"use client";

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowTemplate } from "./types.js";
import { WORKFLOW_CATEGORY_LABELS } from "./types.js";
import { useTemplateFilter } from "../../resource-creation/useTemplateFilter.js";
import type { WorkflowTemplateData } from "./types.js";
import { WorkflowTemplateCard } from "./WorkflowTemplateCard.js";
import { WorkflowTemplatePreview } from "./WorkflowTemplatePreview.js";

export interface WorkflowTemplateGalleryProps {
  readonly templates: readonly WorkflowTemplate[];
  readonly onSelect: (template: WorkflowTemplate) => void;
  readonly emptyContent?: ReactNode;
  readonly className?: string;
}

/**
 * Searchable, filterable gallery of workflow templates.
 *
 * Composes the headless `useTemplateFilter` hook with workflow-specific
 * `WorkflowTemplateCard` components. Includes an integrated preview
 * dialog — clicking the eye icon on a card opens a graph preview
 * before committing to the template.
 *
 * Keyboard navigation follows the same pattern as the generic
 * `TemplateGallery`: Tab between search/tabs/cards, Arrow keys
 * navigate tabs, Enter/Space activates.
 */
export function WorkflowTemplateGallery({
  templates,
  onSelect,
  emptyContent,
  className,
}: WorkflowTemplateGalleryProps) {
  const {
    filtered,
    query,
    setQuery,
    activeCategory,
    setActiveCategory,
    availableCategories,
  } = useTemplateFilter<WorkflowTemplateData>({ templates });

  const [previewTemplate, setPreviewTemplate] =
    useState<WorkflowTemplate | null>(null);

  const handlePreview = useCallback((template: WorkflowTemplate) => {
    setPreviewTemplate(template);
  }, []);

  const handlePreviewClose = useCallback(() => {
    setPreviewTemplate(null);
  }, []);

  const handlePreviewSelect = useCallback(
    (template: WorkflowTemplate) => {
      setPreviewTemplate(null);
      onSelect(template);
    },
    [onSelect],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const tabs =
        e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      if (!tabs.length) return;

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
    },
    [],
  );

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
          aria-label="Search workflow templates"
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
              label={WORKFLOW_CATEGORY_LABELS[cat] ?? cat}
              isActive={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>
      )}

      {/* Card grid */}
      {filtered.length > 0 ? (
        <div
          role="list"
          aria-label="Workflow templates"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((template) => (
            <div key={template.id} role="listitem">
              <WorkflowTemplateCard
                template={template}
                onSelect={onSelect}
                onPreview={handlePreview}
              />
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

      {/* Preview dialog */}
      <WorkflowTemplatePreview
        template={previewTemplate}
        open={previewTemplate !== null}
        onClose={handlePreviewClose}
        onSelect={handlePreviewSelect}
      />
    </div>
  );
}

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
