"use client";

import { memo, useState, useCallback, useMemo } from "react";
import type { DragEvent } from "react";
import { cn } from "@stigmer/theme";
import { useTaskKindRegistry } from "./useTaskKindRegistry.js";
import type { TaskKindDescriptor, TaskKindCategory } from "./types.js";
import { CATEGORY_COLORS, CATEGORY_DISPLAY_NAMES, CATEGORY_ORDER } from "./canvas-constants.js";

/** MIME type for the drag transfer carrying the task kind identifier. */
export const TASK_KIND_DRAG_MIME = "application/stigmer-task-kind";

/** Props for {@link WorkflowTaskPalette}. */
export interface WorkflowTaskPaletteProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Categorized sidebar listing all available workflow task kinds.
 *
 * Each task kind entry is draggable. The drop target (the canvas)
 * reads the task kind from the drag transfer data using
 * {@link TASK_KIND_DRAG_MIME} and creates a new node.
 *
 * Self-contained SDK component (DD-001, AD-T15-B2-005): depends only
 * on `useTaskKindRegistry()` and `--stgm-*` theme tokens. No canvas
 * or React Flow dependency.
 *
 * @since T15 Batch 2 (Node Authoring)
 */
export const WorkflowTaskPalette = memo(function WorkflowTaskPalette({
  className,
}: WorkflowTaskPaletteProps) {
  const { categories, isLoading, error, refetch } = useTaskKindRegistry();
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const filteredCategories = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const result: Array<{
      category: TaskKindCategory;
      descriptors: readonly TaskKindDescriptor[];
    }> = [];

    for (const cat of CATEGORY_ORDER) {
      const descriptors = categories.get(cat);
      if (!descriptors || descriptors.length === 0) continue;

      const filtered = query
        ? descriptors.filter(
            (d) =>
              d.displayName.toLowerCase().includes(query) ||
              d.description.toLowerCase().includes(query),
          )
        : descriptors;

      if (filtered.length > 0) {
        result.push({ category: cat, descriptors: filtered });
      }
    }

    return result;
  }, [categories, searchQuery]);

  if (isLoading) {
    return (
      <div className={cn("stgm stg:flex stg:w-60 stg:flex-col stg:gap-3 stg:border-r stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:p-3", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stg:space-y-2">
            <div className="stg:h-4 stg:w-20 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)]" />
            <div className="stg:h-10 stg:w-full stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)]" />
            <div className="stg:h-10 stg:w-full stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)]" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("stgm stg:flex stg:w-60 stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:border-r stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:p-4", className)}>
        <span className="stg:text-xs stg:text-[var(--stgm-destructive,#ef4444)]">
          Failed to load task types
        </span>
        <button
          type="button"
          onClick={refetch}
          className="stg:rounded stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))] stg:px-2 stg:py-1 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "stgm stg:flex stg:w-60 stg:shrink-0 stg:flex-col stg:border-r stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-card,var(--stgm-background,#fff))]",
        className,
      )}
    >
      <div className="stg:border-b stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:p-2">
        <input
          type="search"
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={handleSearchChange}
          className="stg:w-full stg:rounded stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#737373)] stg:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label="Search task types"
        />
      </div>

      <div className="stg:flex-1 stg:overflow-y-auto stg:p-2">
        {filteredCategories.length === 0 ? (
          <div className="stg:py-6 stg:text-center stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
            {searchQuery ? "No matching tasks" : "No task types available"}
          </div>
        ) : (
          filteredCategories.map(({ category, descriptors }) => (
            <PaletteCategory
              key={category}
              category={category}
              descriptors={descriptors}
              isCollapsed={collapsedCategories.has(category)}
              onToggle={toggleCategory}
            />
          ))
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// PaletteCategory
// ---------------------------------------------------------------------------

function PaletteCategory({
  category,
  descriptors,
  isCollapsed,
  onToggle,
}: {
  category: TaskKindCategory;
  descriptors: readonly TaskKindDescriptor[];
  isCollapsed: boolean;
  onToggle: (category: string) => void;
}) {
  const categoryColor = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unspecified;

  return (
    <div className="stg:mb-2">
      <button
        type="button"
        onClick={() => onToggle(category)}
        className="stg:flex stg:w-full stg:items-center stg:gap-1.5 stg:rounded stg:px-1 stg:py-1 stg:text-left stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wider stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)]"
        aria-expanded={!isCollapsed}
      >
        <span
          className="stg:inline-block stg:h-2 stg:w-2 stg:rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
        {CATEGORY_DISPLAY_NAMES[category]}
        <span className="stg:ml-auto stg:text-[10px]">{isCollapsed ? "+" : "\u2212"}</span>
      </button>

      {!isCollapsed && (
        <div className="stg:mt-0.5 stg:space-y-0.5" role="listbox" aria-label={CATEGORY_DISPLAY_NAMES[category]}>
          {descriptors.map((descriptor) => (
            <PaletteItem
              key={descriptor.kind}
              descriptor={descriptor}
              categoryColor={categoryColor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaletteItem
// ---------------------------------------------------------------------------

function PaletteItem({
  descriptor,
  categoryColor,
}: {
  descriptor: TaskKindDescriptor;
  categoryColor: string;
}) {
  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.dataTransfer.setData(TASK_KIND_DRAG_MIME, descriptor.kind);
      e.dataTransfer.effectAllowed = "move";
    },
    [descriptor.kind],
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="stg:flex stg:cursor-grab stg:items-start stg:gap-2 stg:rounded stg:border stg:border-[var(--stgm-border-prominent,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1.5 stg:transition-colors stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:active:cursor-grabbing"
      role="option"
      aria-label={`Drag to add ${descriptor.displayName} task`}
    >
      <span
        className="stg:mt-0.5 stg:inline-block stg:h-2.5 stg:w-0.5 stg:shrink-0 stg:rounded-full"
        style={{ backgroundColor: categoryColor }}
        aria-hidden="true"
      />
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:truncate stg:text-xs stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
          {descriptor.displayName}
        </div>
        <div className="stg:truncate stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">
          {descriptor.description}
        </div>
      </div>
    </div>
  );
}
