"use client";

import {
  memo,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container";
import { useTaskKindRegistry } from "./useTaskKindRegistry";
import type { TaskKindDescriptor, TaskKindCategory } from "./types";
import {
  CATEGORY_COLORS,
  CATEGORY_DISPLAY_NAMES,
  CATEGORY_ORDER,
} from "./canvas-constants";

/** Props for {@link TaskPickerPopover}. */
export interface TaskPickerPopoverProps {
  /** Whether the popover is currently visible. */
  readonly open: boolean;
  /** Called when the popover requests open/close state changes. */
  readonly onOpenChange: (open: boolean) => void;
  /** Called when the user selects a task kind from the list. */
  readonly onSelectKind: (kindString: string) => void;
  /** Ref to the element the popover should anchor to. */
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  /** Which side of the anchor to position the popover. */
  readonly side?: "top" | "bottom" | "right" | "left";
  /** Alignment along the anchor edge. */
  readonly align?: "start" | "center" | "end";
  /** Additional CSS class names for the popup container. */
  readonly className?: string;
}

/**
 * Searchable, categorized popover for selecting a workflow task kind.
 *
 * Shared between the node "+" button (add successor), the edge "+"
 * button (insert on edge), and later the right-click context menu.
 * Callers provide their own trigger element and control open state
 * via the `open` / `onOpenChange` props.
 *
 * Uses `@base-ui/react/popover` for positioning and focus management,
 * `useTaskKindRegistry()` for the available task kinds, and `--stgm-*`
 * tokens for all styling (DD-005).
 *
 * @since T02 (Workflow Canvas Interaction UX)
 */
export const TaskPickerPopover = memo(function TaskPickerPopover({
  open,
  onOpenChange,
  onSelectKind,
  anchorRef,
  side = "bottom",
  align = "center",
  className,
}: TaskPickerPopoverProps) {
  const portalContainer = useStigmerPortalContainer();
  const { categories, isLoading } = useTaskKindRegistry();
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Reset search and focus when the popover opens/closes
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setFocusedIndex(-1);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

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

  const flatItems = useMemo(
    () => filteredCategories.flatMap((g) => g.descriptors),
    [filteredCategories],
  );

  const handleSelect = useCallback(
    (kind: string) => {
      onSelectKind(kind);
      onOpenChange(false);
    },
    [onSelectKind, onOpenChange],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      setFocusedIndex(-1);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flatItems.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev < flatItems.length - 1 ? prev + 1 : 0,
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev > 0 ? prev - 1 : flatItems.length - 1,
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          const target = focusedIndex >= 0 ? flatItems[focusedIndex] : flatItems[0];
          if (target) handleSelect(target.kind);
          break;
        }
      }
    },
    [flatItems, focusedIndex, handleSelect],
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner
          anchor={anchorRef}
          side={side}
          align={align}
          sideOffset={8}
        >
          <Popover.Popup
            className={cn(
              "stgm z-popover w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-md text-popover-foreground",
              className,
            )}
          >
            <div
              className="flex flex-col"
              role="dialog"
              aria-label="Select task type"
              onKeyDown={handleKeyDown}
            >
              <div className="border-b border-border p-2">
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search tasks…"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="w-full rounded border border-border bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#737373)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
                  aria-label="Search task types"
                />
              </div>

              <div
                className="max-h-64 overflow-y-auto p-1.5"
                role="listbox"
                aria-label="Task types"
              >
                {isLoading && (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-8 animate-pulse rounded bg-[var(--stgm-muted,#f5f5f5)]"
                      />
                    ))}
                  </div>
                )}

                {!isLoading && filteredCategories.length === 0 && (
                  <div className="py-4 text-center text-xs text-[var(--stgm-muted-foreground,#737373)]">
                    {searchQuery ? "No matching tasks" : "No task types available"}
                  </div>
                )}

                {!isLoading &&
                  filteredCategories.map(({ category, descriptors }) => (
                    <PickerCategory
                      key={category}
                      category={category}
                      descriptors={descriptors}
                      focusedKind={
                        focusedIndex >= 0
                          ? flatItems[focusedIndex]?.kind
                          : undefined
                      }
                      onSelect={handleSelect}
                    />
                  ))}
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
});

// ---------------------------------------------------------------------------
// PickerCategory
// ---------------------------------------------------------------------------

function PickerCategory({
  category,
  descriptors,
  focusedKind,
  onSelect,
}: {
  category: TaskKindCategory;
  descriptors: readonly TaskKindDescriptor[];
  focusedKind: string | undefined;
  onSelect: (kind: string) => void;
}) {
  const categoryColor =
    CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unspecified;

  return (
    <div className="mb-1 last:mb-0">
      <div className="flex items-center gap-1.5 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--stgm-muted-foreground,#737373)]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
        {CATEGORY_DISPLAY_NAMES[category]}
      </div>
      {descriptors.map((descriptor) => (
        <PickerItem
          key={descriptor.kind}
          descriptor={descriptor}
          categoryColor={categoryColor}
          isFocused={descriptor.kind === focusedKind}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PickerItem
// ---------------------------------------------------------------------------

function PickerItem({
  descriptor,
  categoryColor,
  isFocused,
  onSelect,
}: {
  descriptor: TaskKindDescriptor;
  categoryColor: string;
  isFocused: boolean;
  onSelect: (kind: string) => void;
}) {
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isFocused) {
      itemRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isFocused]);

  return (
    <button
      ref={itemRef}
      type="button"
      role="option"
      aria-selected={isFocused}
      onClick={() => onSelect(descriptor.kind)}
      className={cn(
        "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
        "hover:bg-[var(--stgm-muted,#f5f5f5)]",
        isFocused && "bg-[var(--stgm-muted,#f5f5f5)]",
      )}
    >
      <span
        className="mt-1 inline-block h-2 w-0.5 shrink-0 rounded-full"
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
    </button>
  );
}
