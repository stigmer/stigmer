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
import { useStigmerPortalContainer } from "../portal-container.js";
import { useTaskKindRegistry } from "./useTaskKindRegistry.js";
import type { TaskKindCategory } from "./types.js";
import {
  CATEGORY_COLORS,
  CATEGORY_DISPLAY_NAMES,
} from "./canvas-constants.js";
import type { InsertionContext } from "./picker/insertion-context.js";
import { recordRecentKind } from "./picker/recents.js";
import { usePickerData, type PickerItem, type PickerSection } from "./picker/usePickerData.js";
import type { WorkflowGraphModel } from "./workflow-graph-model.js";

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
  /** Context for contextual header/suggestions/compatibility checks. */
  readonly insertionContext?: InsertionContext | null;
  /** Current graph model used for compatibility filtering. */
  readonly graph?: WorkflowGraphModel | null;
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
  insertionContext,
  graph,
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

  const pickerData = usePickerData(
    insertionContext ?? null,
    categories,
    graph ?? null,
    isLoading,
    searchQuery,
  );

  const handleSelect = useCallback(
    (kind: string) => {
      recordRecentKind(kind);
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
      const items = pickerData.selectableItems;
      if (items.length === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev < items.length - 1 ? prev + 1 : 0,
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev > 0 ? prev - 1 : items.length - 1,
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          const target = focusedIndex >= 0 ? items[focusedIndex] : items[0];
          if (target) handleSelect(target.descriptor.kind);
          break;
        }
      }
    },
    [pickerData.selectableItems, focusedIndex, handleSelect],
  );

  const focusedKind = useMemo(() => {
    const items = pickerData.selectableItems;
    if (focusedIndex >= 0 && focusedIndex < items.length) {
      return items[focusedIndex].descriptor.kind;
    }
    return undefined;
  }, [pickerData.selectableItems, focusedIndex]);

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
              "stgm stg:z-popover stg:w-56 stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:shadow-md stg:text-popover-foreground",
              className,
            )}
          >
            <div
              className="stg:flex stg:flex-col"
              role="dialog"
              aria-label="Select task type"
              onKeyDown={handleKeyDown}
            >
              {insertionContext && (
                <div className="stg:border-b stg:border-border stg:px-3 stg:py-2">
                  <div className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                    {pickerData.header}
                  </div>
                </div>
              )}

              <div className="stg:border-b stg:border-border stg:p-2">
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search tasks…"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="stg:w-full stg:rounded stg:border stg:border-border stg:bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#737373)] stg:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
                  aria-label="Search task types"
                />
              </div>

              <div
                className="stg:max-h-64 stg:overflow-y-auto stg:p-1.5"
                role="listbox"
                aria-label="Task types"
              >
                {isLoading && (
                  <div className="stg:space-y-2 stg:p-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="stg:h-8 stg:animate-pulse stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)]"
                      />
                    ))}
                  </div>
                )}

                {!isLoading && pickerData.sections.length === 0 && (
                  <div className="stg:py-4 stg:text-center stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
                    {searchQuery ? "No matching tasks" : "No task types available"}
                  </div>
                )}

                {!isLoading &&
                  pickerData.sections.map((section) => (
                    <PickerCategory
                      key={section.id}
                      section={section}
                      focusedKind={focusedKind}
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
  section,
  focusedKind,
  onSelect,
}: {
  section: PickerSection;
  focusedKind: string | undefined;
  onSelect: (kind: string) => void;
}) {
  const isSpecial = section.isSpecial === true;
  const category = section.id as TaskKindCategory;
  const categoryColor = !isSpecial
    ? (CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unspecified)
    : undefined;
  const label = isSpecial
    ? section.label
    : (CATEGORY_DISPLAY_NAMES[category] ?? section.label);

  return (
    <div className="stg:mb-1 stg:last:mb-0">
      <div className="stg:flex stg:items-center stg:gap-1.5 stg:px-1.5 stg:py-1 stg:text-[10px] stg:font-semibold stg:uppercase stg:tracking-wider stg:text-[var(--stgm-muted-foreground,#737373)]">
        {categoryColor ? (
          <span
            className="stg:inline-block stg:h-1.5 stg:w-1.5 stg:rounded-full"
            style={{ backgroundColor: categoryColor }}
            aria-hidden="true"
          />
        ) : (
          <span className="stg:inline-block stg:h-1.5 stg:w-1.5 stg:rounded-full stg:bg-[var(--stgm-muted-foreground,#737373)]" aria-hidden="true" />
        )}
        {label}
      </div>
      {section.items.map((item) => (
        <PickerItem
          key={item.descriptor.kind}
          item={item}
          categoryColor={categoryColor}
          isFocused={item.descriptor.kind === focusedKind}
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
  item,
  categoryColor,
  isFocused,
  onSelect,
}: {
  item: PickerItem;
  categoryColor?: string;
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
      aria-disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onClick={item.disabled ? undefined : () => onSelect(item.descriptor.kind)}
      className={cn(
        "stg:flex stg:w-full stg:items-start stg:gap-2 stg:rounded stg:px-2 stg:py-1.5 stg:text-left stg:transition-colors",
        item.disabled
          ? "stg:cursor-not-allowed stg:opacity-55"
          : "stg:hover:bg-[var(--stgm-muted,#f5f5f5)]",
        isFocused && !item.disabled && "stg:bg-[var(--stgm-muted,#f5f5f5)]",
      )}
    >
      {categoryColor && (
        <span
          className="stg:mt-1 stg:inline-block stg:h-2 stg:w-0.5 stg:shrink-0 stg:rounded-full"
          style={{ backgroundColor: categoryColor }}
          aria-hidden="true"
        />
      )}
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:truncate stg:text-xs stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
          {item.descriptor.displayName}
        </div>
        <div className="stg:truncate stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">
          {item.disabled ? item.disabledReason : item.descriptor.description}
        </div>
      </div>
    </button>
  );
}
