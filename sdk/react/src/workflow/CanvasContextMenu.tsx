"use client";

import { memo, useCallback, useMemo } from "react";
import { Menu } from "@base-ui/react/menu";
import { Separator } from "@base-ui/react/separator";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container";
import { TrashIcon, DuplicateIcon, PlusIcon } from "./canvas-icons";
import { getShortcutHint } from "./shortcut-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Describes what was right-clicked on the canvas. */
export type CanvasContextMenuTarget =
  | { readonly type: "node"; readonly id: string; readonly taskName: string }
  | { readonly type: "edge"; readonly id: string }
  | { readonly type: "pane" }
  | { readonly type: "selection"; readonly count: number };

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
  /** Called to toggle disabled state on a node. */
  readonly onToggleDisabled?: (nodeId: string) => void;
  /** Called to wrap a node in try/catch. */
  readonly onWrapInTryCatch?: (nodeId: string) => void;
  /** Called to copy a single node to clipboard. */
  readonly onCopyNode?: (nodeId: string) => void;
  /** Called to rename a node (triggers inline rename in inspector). */
  readonly onRenameNode?: (nodeId: string) => void;
  /** Called to view a node's YAML representation. */
  readonly onViewYaml?: (nodeId: string) => void;
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
  /** Called to paste from clipboard at current position. */
  readonly onPaste?: () => void;
  /** Whether the internal clipboard has content available to paste. */
  readonly hasClipboard?: boolean;
  /** Called to zoom/fit the canvas. */
  readonly onFitView?: () => void;
  /** Called to copy the current selection (multi-select). */
  readonly onCopySelection?: () => void;
  /** Called to duplicate the current selection (multi-select). */
  readonly onDuplicateSelection?: () => void;
  /** Called to disable/enable the current selection (multi-select). */
  readonly onDisableSelection?: () => void;
  /** Called to delete the current selection (multi-select). */
  readonly onDeleteSelection?: () => void;
  /** Additional CSS class names for the popup. */
  readonly className?: string;
}

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

const DISABLED_ITEM_CLASS = cn(
  "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--stgm-muted-foreground,#737373)] outline-none",
  "opacity-50",
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
  onToggleDisabled,
  onWrapInTryCatch,
  onCopyNode,
  onRenameNode,
  onViewYaml,
  onDeleteEdge,
  onInsertTaskOnEdge,
  onAddTaskAtPosition,
  onSelectAll,
  onAutoLayout,
  onPaste,
  hasClipboard,
  onFitView,
  onCopySelection,
  onDuplicateSelection,
  onDisableSelection,
  onDeleteSelection,
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
                onToggleDisabled={onToggleDisabled}
                onWrapInTryCatch={onWrapInTryCatch}
                onCopy={onCopyNode}
                onRename={onRenameNode}
                onViewYaml={onViewYaml}
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
                onPaste={onPaste}
                hasClipboard={hasClipboard}
                onFitView={onFitView}
              />
            )}
            {target.type === "selection" && (
              <SelectionMenuItems
                count={target.count}
                onCopy={onCopySelection}
                onDuplicate={onDuplicateSelection}
                onDisable={onDisableSelection}
                onDelete={onDeleteSelection}
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
  onToggleDisabled,
  onWrapInTryCatch,
  onCopy,
  onRename,
  onViewYaml,
}: {
  nodeId: string;
  taskName: string;
  onDelete?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onAddTaskAfter?: (nodeId: string) => void;
  onToggleDisabled?: (nodeId: string) => void;
  onWrapInTryCatch?: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onRename?: (nodeId: string) => void;
  onViewYaml?: (nodeId: string) => void;
}) {
  return (
    <>
      {onRename && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onRename(nodeId)}
          label="Rename task"
        >
          <RenameIcon />
          Rename
        </Menu.Item>
      )}
      {onDuplicate && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onDuplicate(nodeId)}
          label="Duplicate task"
        >
          <DuplicateIcon />
          Duplicate
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("duplicate")}</span>
        </Menu.Item>
      )}
      {onCopy && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onCopy(nodeId)}
          label="Copy task"
        >
          <CopyIcon />
          Copy
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("copy")}</span>
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
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("addTaskAfter")}</span>
        </Menu.Item>
      )}
      <Separator className={SEPARATOR_CLASS} />
      {onToggleDisabled && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onToggleDisabled(nodeId)}
          label="Toggle disabled"
        >
          <DisableIcon />
          Disable / Bypass
        </Menu.Item>
      )}
      {onWrapInTryCatch && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onWrapInTryCatch(nodeId)}
          label="Wrap in try/catch"
        >
          <ShieldIcon />
          Wrap in Try/Catch
        </Menu.Item>
      )}
      {onViewYaml && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={() => onViewYaml(nodeId)}
          label="View YAML"
        >
          <CodeIcon />
          View YAML
        </Menu.Item>
      )}
      <Separator className={SEPARATOR_CLASS} />
      {onDelete && (
        <Menu.Item
          className={DESTRUCTIVE_ITEM_CLASS}
          onClick={() => onDelete(nodeId)}
          aria-label={`Delete task ${taskName}`}
          label="Delete task"
        >
          <TrashIcon />
          Delete
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("delete")}</span>
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
  onPaste,
  hasClipboard,
  onFitView,
}: {
  onAddTask?: () => void;
  onSelectAll?: () => void;
  onAutoLayout?: () => void;
  onPaste?: () => void;
  hasClipboard?: boolean;
  onFitView?: () => void;
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
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("addTaskAfter")}</span>
        </Menu.Item>
      )}
      {onPaste && (
        <Menu.Item
          className={hasClipboard ? ITEM_CLASS : DISABLED_ITEM_CLASS}
          onClick={hasClipboard ? onPaste : undefined}
          label="Paste"
          aria-disabled={!hasClipboard}
        >
          <PasteIcon />
          Paste
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("paste")}</span>
        </Menu.Item>
      )}
      <Separator className={SEPARATOR_CLASS} />
      {onSelectAll && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={onSelectAll}
          label="Select all"
        >
          <SelectAllIcon />
          Select all
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("selectAll")}</span>
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
      {onFitView && (
        <Menu.Item
          className={ITEM_CLASS}
          onClick={onFitView}
          label="Zoom to fit"
        >
          <FitViewIcon />
          Zoom to fit
        </Menu.Item>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Selection menu items (multi-select right-click)
// ---------------------------------------------------------------------------

function SelectionMenuItems({
  count,
  onCopy,
  onDuplicate,
  onDisable,
  onDelete,
}: {
  count: number;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onDisable?: () => void;
  onDelete?: () => void;
}) {
  const label = `${count} task${count > 1 ? "s" : ""}`;
  return (
    <>
      {onCopy && (
        <Menu.Item className={ITEM_CLASS} onClick={onCopy} label={`Copy ${label}`}>
          <CopyIcon />
          Copy {label}
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("copy")}</span>
        </Menu.Item>
      )}
      {onDuplicate && (
        <Menu.Item className={ITEM_CLASS} onClick={onDuplicate} label={`Duplicate ${label}`}>
          <DuplicateIcon />
          Duplicate {label}
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("duplicate")}</span>
        </Menu.Item>
      )}
      {onDisable && (
        <Menu.Item className={ITEM_CLASS} onClick={onDisable} label={`Disable ${label}`}>
          <DisableIcon />
          Disable {label}
        </Menu.Item>
      )}
      {(onCopy || onDuplicate || onDisable) && onDelete && (
        <Separator className={SEPARATOR_CLASS} />
      )}
      {onDelete && (
        <Menu.Item
          className={DESTRUCTIVE_ITEM_CLASS}
          onClick={onDelete}
          label={`Delete ${label}`}
        >
          <TrashIcon />
          Delete {label}
          <span className={SHORTCUT_HINT_CLASS}>{getShortcutHint("delete")}</span>
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

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="7" height="7" rx="1" />
      <path d="M9 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 2H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H8.5" />
      <rect x="5" y="1" width="4" height="2.5" rx="0.5" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 2.5l3 3M2 12l.7-2.8L9.6 2.3a1 1 0 0 1 1.4 0l1.7 1.7a1 1 0 0 1 0 1.4L5.8 12.3 3 13z" />
    </svg>
  );
}

function DisableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5" />
      <path d="M3.5 10.5l7-7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 1.5L2 3.5v3c0 3.5 2.2 5.5 5 6.5 2.8-1 5-3 5-6.5v-3L7 1.5z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 4L1.5 7l3 3M9.5 4l3 3-3 3M8 2l-2 10" />
    </svg>
  );
}

function FitViewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.5 5V2.5a1 1 0 0 1 1-1H5M9 1.5h2.5a1 1 0 0 1 1 1V5M12.5 9v2.5a1 1 0 0 1-1 1H9M5 12.5H2.5a1 1 0 0 1-1-1V9" />
      <rect x="4" y="4" width="6" height="6" rx="0.5" />
    </svg>
  );
}
