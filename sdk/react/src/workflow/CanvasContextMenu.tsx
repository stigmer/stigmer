"use client";

import { memo, useCallback, useMemo } from "react";
import { Menu } from "@base-ui/react/menu";
import { Separator } from "@base-ui/react/separator";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container";
import { TrashIcon, DuplicateIcon, PlusIcon } from "./canvas-icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Describes what was right-clicked on the canvas. */
export type CanvasContextMenuTarget =
  | { readonly type: "node"; readonly id: string; readonly taskName: string }
  | { readonly type: "edge"; readonly id: string }
  | { readonly type: "pane" };

/** Props for {@link CanvasContextMenu}. */
export interface CanvasContextMenuProps {
  /** Whether the context menu is open. */
  readonly open: boolean;
  /** Called when the menu open state changes (e.g. clicking outside, pressing Escape). */
  readonly onOpenChange: (open: boolean) => void;
  /** What was right-clicked — determines which menu items are shown. */
  readonly target: CanvasContextMenuTarget | null;
  /** Screen-coordinate position where the menu should appear. */
  readonly position: { readonly x: number; readonly y: number } | null;
  /** Called to delete a node. */
  readonly onDeleteNode?: (nodeId: string) => void;
  /** Called to duplicate a node. */
  readonly onDuplicateNode?: (nodeId: string) => void;
  /** Called to trigger the "add task after" flow (opens TaskPicker). */
  readonly onAddTaskAfter?: (nodeId: string) => void;
  /** Called to delete an edge. */
  readonly onDeleteEdge?: (edgeId: string) => void;
  /** Called to trigger the "insert task on edge" flow (opens TaskPicker). */
  readonly onInsertTaskOnEdge?: (edgeId: string) => void;
  /** Called to trigger the "add task at position" flow (opens TaskPicker). */
  readonly onAddTaskAtPosition?: () => void;
  /** Called to select all non-sentinel nodes. */
  readonly onSelectAll?: () => void;
  /** Called to trigger auto-layout. */
  readonly onAutoLayout?: () => void;
  /** Additional CSS class names for the popup. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Platform detection & shortcut labels
// ---------------------------------------------------------------------------

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const MOD_LABEL = isMac ? "\u2318" : "Ctrl+";

const SHORTCUT_LABELS = {
  duplicate: `${MOD_LABEL}D`,
  selectAll: `${MOD_LABEL}A`,
  delete: isMac ? "\u232B" : "Del",
  addTask: "N",
} as const;

// ---------------------------------------------------------------------------
// Styling constants
// ---------------------------------------------------------------------------

const POPUP_CLASS = cn(
  "stgm z-50 min-w-[160px] rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-popover,var(--stgm-background,#fff))] p-1 shadow-md",
  "outline-none",
);

const ITEM_CLASS = cn(
  "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--stgm-popover-foreground,var(--stgm-foreground,#1a1a2e))] outline-none",
  "data-[highlighted]:bg-[var(--stgm-accent,#e5e5e5)]",
);

const DESTRUCTIVE_ITEM_CLASS = cn(
  "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--stgm-destructive,#ef4444)] outline-none",
  "data-[highlighted]:bg-[var(--stgm-destructive,#ef4444)]/10",
);

const SHORTCUT_HINT_CLASS =
  "ml-auto pl-4 text-[10px] tracking-wide text-[var(--stgm-muted-foreground,#737373)]";

const SEPARATOR_CLASS =
  "my-1 h-px bg-[var(--stgm-border,#e5e5e5)]";

// ---------------------------------------------------------------------------
// CanvasContextMenu
// ---------------------------------------------------------------------------

/**
 * Right-click context menu for the workflow canvas editor.
 *
 * Renders different menu items depending on the {@link CanvasContextMenuTarget}:
 * - **Node**: Delete Task, Duplicate Task, Add Task After
 * - **Edge**: Delete Connection, Insert Task
 * - **Pane**: Add Task, Select All, Auto-layout
 *
 * Uses `@base-ui/react/menu` in controlled mode with a virtual anchor
 * positioned at the right-click coordinates. Portaled via
 * `useStigmerPortalContainer()` to inherit `--stgm-*` tokens.
 *
 * @since T05 (Context Menu + Duplicate)
 */
export const CanvasContextMenu = memo(function CanvasContextMenu({
  open,
  onOpenChange,
  target,
  position,
  onDeleteNode,
  onDuplicateNode,
  onAddTaskAfter,
  onDeleteEdge,
  onInsertTaskOnEdge,
  onAddTaskAtPosition,
  onSelectAll,
  onAutoLayout,
  className,
}: CanvasContextMenuProps) {
  const portalContainer = useStigmerPortalContainer();

  const virtualAnchor = useMemo(() => {
    if (!position) return undefined;
    const { x, y } = position;
    return {
      getBoundingClientRect: () => ({
        x,
        y,
        width: 0,
        height: 0,
        top: y,
        right: x,
        bottom: y,
        left: x,
      }),
    };
  }, [position]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  if (!target || !position) return null;

  return (
    <Menu.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <Menu.Portal container={portalContainer}>
        <Menu.Positioner anchor={virtualAnchor} side="bottom" align="start" sideOffset={0}>
          <Menu.Popup className={cn(POPUP_CLASS, className)}>
            {target.type === "node" && (
              <NodeMenuItems
                nodeId={target.id}
                taskName={target.taskName}
                onDelete={onDeleteNode}
                onDuplicate={onDuplicateNode}
                onAddTaskAfter={onAddTaskAfter}
              />
            )}
            {target.type === "edge" && (
              <EdgeMenuItems
                edgeId={target.id}
                onDelete={onDeleteEdge}
                onInsertTask={onInsertTaskOnEdge}
              />
            )}
            {target.type === "pane" && (
              <PaneMenuItems
                onAddTask={onAddTaskAtPosition}
                onSelectAll={onSelectAll}
                onAutoLayout={onAutoLayout}
              />
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
});

// ---------------------------------------------------------------------------
// Node menu items
// ---------------------------------------------------------------------------

function NodeMenuItems({
  nodeId,
  taskName,
  onDelete,
  onDuplicate,
  onAddTaskAfter,
}: {
  nodeId: string;
  taskName: string;
  onDelete?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onAddTaskAfter?: (nodeId: string) => void;
}) {
  return (
    <>
      {onDuplicate && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onDuplicate(nodeId)}
          label="Duplicate task"
        >
          <DuplicateIcon />
          Duplicate
          <span className={SHORTCUT_HINT_CLASS}>{SHORTCUT_LABELS.duplicate}</span>
        </Menu.Item>
      )}
      {onAddTaskAfter && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onAddTaskAfter(nodeId)}
          label="Add task after"
        >
          <PlusIcon />
          Add task after…
        </Menu.Item>
      )}
      {(onDuplicate || onAddTaskAfter) && onDelete && (
        <Separator className={SEPARATOR_CLASS} />
      )}
      {onDelete && (
        <Menu.Item
          className={DESTRUCTIVE_ITEM_CLASS}
          onClick={() => onDelete(nodeId)}
          aria-label={`Delete task ${taskName}`}
          label="Delete task"
        >
          <TrashIcon />
          Delete
          <span className={SHORTCUT_HINT_CLASS}>{SHORTCUT_LABELS.delete}</span>
        </Menu.Item>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edge menu items
// ---------------------------------------------------------------------------

function EdgeMenuItems({
  edgeId,
  onDelete,
  onInsertTask,
}: {
  edgeId: string;
  onDelete?: (edgeId: string) => void;
  onInsertTask?: (edgeId: string) => void;
}) {
  return (
    <>
      {onInsertTask && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onInsertTask(edgeId)}
          label="Insert task"
        >
          <PlusIcon />
          Insert task…
        </Menu.Item>
      )}
      {onInsertTask && onDelete && (
        <Separator className={SEPARATOR_CLASS} />
      )}
      {onDelete && (
        <Menu.Item
          className={DESTRUCTIVE_ITEM_CLASS}
          onClick={() => onDelete(edgeId)}
          label="Delete connection"
        >
          <TrashIcon />
          Delete connection
        </Menu.Item>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pane menu items
// ---------------------------------------------------------------------------

function PaneMenuItems({
  onAddTask,
  onSelectAll,
  onAutoLayout,
}: {
  onAddTask?: () => void;
  onSelectAll?: () => void;
  onAutoLayout?: () => void;
}) {
  return (
    <>
      {onAddTask && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={onAddTask}
          label="Add task"
        >
          <PlusIcon />
          Add task…
          <span className={SHORTCUT_HINT_CLASS}>{SHORTCUT_LABELS.addTask}</span>
        </Menu.Item>
      )}
      {onAddTask && (onSelectAll || onAutoLayout) && (
        <Separator className={SEPARATOR_CLASS} />
      )}
      {onSelectAll && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={onSelectAll}
          label="Select all"
        >
          <SelectAllIcon />
          Select all
          <span className={SHORTCUT_HINT_CLASS}>{SHORTCUT_LABELS.selectAll}</span>
        </Menu.Item>
      )}
      {onAutoLayout && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={onAutoLayout}
          label="Auto-layout"
        >
          <LayoutIcon />
          Auto-layout
        </Menu.Item>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Icons (context-menu-specific; shared icons imported from canvas-icons.tsx)
// ---------------------------------------------------------------------------

function SelectAllIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="10" height="10" rx="1" strokeDasharray="2 2" />
      <path d="M5 7l1.5 1.5L9 5.5" />
    </svg>
  );
}

function LayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="1.5" width="6" height="3" rx="0.5" />
      <rect x="1" y="9.5" width="5" height="3" rx="0.5" />
      <rect x="8" y="9.5" width="5" height="3" rx="0.5" />
      <path d="M7 4.5V7M7 7H3.5M7 7h3.5M3.5 7v2.5M10.5 7v2.5" />
    </svg>
  );
}
