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
      <div className={cn("stgm flex w-60 flex-col gap-3 border-r border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] p-3", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-20 animate-pulse rounded bg-[var(--stgm-muted,#f5f5f5)]" />
            <div className="h-10 w-full animate-pulse rounded bg-[var(--stgm-muted,#f5f5f5)]" />
            <div className="h-10 w-full animate-pulse rounded bg-[var(--stgm-muted,#f5f5f5)]" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("stgm flex w-60 flex-col items-center justify-center gap-2 border-r border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] p-4", className)}>
        <span className="text-xs text-[var(--stgm-destructive,#ef4444)]">
          Failed to load task types
        </span>
        <button
          type="button"
          onClick={refetch}
          className="rounded border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-2 py-1 text-xs text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "stgm flex w-60 shrink-0 flex-col border-r border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))]",
        className,
      )}
    >
      <div className="border-b border-[var(--stgm-border-prominent,#d4d4d8)] p-2">
        <input
          type="search"
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={handleSearchChange}
          className="w-full rounded border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#737373)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          aria-label="Search task types"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filteredCategories.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--stgm-muted-foreground,#737373)]">
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
    <div className="mb-2">
      <button
        type="button"
        onClick={() => onToggle(category)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
        aria-expanded={!isCollapsed}
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
        {CATEGORY_DISPLAY_NAMES[category]}
        <span className="ml-auto text-[10px]">{isCollapsed ? "+" : "\u2212"}</span>
      </button>

      {!isCollapsed && (
        <div className="mt-0.5 space-y-0.5" role="listbox" aria-label={CATEGORY_DISPLAY_NAMES[category]}>
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
      className="flex cursor-grab items-start gap-2 rounded border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 transition-colors hover:bg-[var(--stgm-muted,#f5f5f5)] active:cursor-grabbing"
      role="option"
      aria-label={`Drag to add ${descriptor.displayName} task`}
    >
      <span
        className="mt-0.5 inline-block h-2.5 w-0.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryColor }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)]">
          {descriptor.displayName}
        </div>
        <div className="truncate text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          {descriptor.description}
        </div>
      </div>
    </div>
  );
}
