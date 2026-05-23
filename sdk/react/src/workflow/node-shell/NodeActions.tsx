"use client";

import { forwardRef, memo, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Position, NodeToolbar } from "@xyflow/react";
import { cn } from "@stigmer/theme";
import { CanvasActionsContext } from "../CanvasActionsContext";
import { TaskPickerPopover } from "../TaskPickerPopover";
import { BranchAddPopover } from "../picker/BranchAddPopover";
import type { BranchAddMode, BranchAddResult } from "../picker/BranchAddPopover";
import type { InsertionContext } from "../picker/insertion-context";
import { TrashIcon, DuplicateIcon, PlusIcon } from "../canvas-icons";

export interface NodeActionsProps {
  nodeId: string;
  taskName: string;
  kindString?: string;
}

/**
 * Interaction layer for workflow nodes in design mode.
 *
 * Renders:
 * - Selection toolbar (duplicate, add after, delete) via React Flow NodeToolbar
 * - Hover delete button (top-right corner)
 * - Hover add-successor button (bottom-center)
 * - TaskPickerPopover for adding downstream nodes
 *
 * This component is only relevant in design mode; overview and execution
 * modes should not render it.
 */
export const NodeActions = memo(function NodeActions({
  nodeId,
  taskName,
  kindString,
}: NodeActionsProps) {
  const actions = useContext(CanvasActionsContext);

  const handleDelete = useCallback(() => {
    actions?.deleteNode(nodeId);
  }, [actions, nodeId]);

  const handleDuplicate = useCallback(() => {
    actions?.duplicateNode(nodeId);
  }, [actions, nodeId]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const hoverAddRef = useRef<HTMLButtonElement>(null);
  const toolbarAddRef = useRef<HTMLButtonElement>(null);
  const branchAddRef = useRef<HTMLButtonElement>(null);
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);

  const branchMode: BranchAddMode | null = useMemo(() => {
    switch (kindString) {
      case "switch_case":
        return "switch-case";
      case "fork":
        return "fork-branch";
      case "try_catch":
        return "catch-handler";
      default:
        return null;
    }
  }, [kindString]);

  const insertionContext: InsertionContext | null = useMemo(() => {
    if (!kindString) return null;
    return {
      mode: "append-after",
      sourceNodeId: nodeId,
      sourceKind: kindString,
      sourceDisplayName: taskName,
    };
  }, [nodeId, kindString, taskName]);

  const openPickerFrom = useCallback(
    (ref: React.RefObject<HTMLButtonElement | null>) => {
      pickerAnchorRef.current = ref.current;
      setPickerOpen(true);
    },
    [],
  );

  const handleHoverAddClick = useCallback(() => {
    openPickerFrom(hoverAddRef);
  }, [openPickerFrom]);

  const handleToolbarAddClick = useCallback(() => {
    openPickerFrom(toolbarAddRef);
  }, [openPickerFrom]);

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
  }, []);

  const handleKindSelected = useCallback(
    (kindString: string) => {
      actions?.addSuccessorTask(nodeId, kindString);
    },
    [actions, nodeId],
  );

  const handleBranchSubmit = useCallback(
    (result: BranchAddResult) => {
      if (!actions || !branchMode) return;
      switch (branchMode) {
        case "switch-case":
          actions.addSwitchCase(nodeId, result.name, result.condition ?? "");
          break;
        case "fork-branch":
          actions.addForkBranch(nodeId, result.name);
          break;
        case "catch-handler":
          actions.addCatchHandler(nodeId, result.errorType ?? "");
          break;
      }
    },
    [actions, branchMode, nodeId],
  );

  const graphModel = actions?.getGraphModel() ?? null;

  const existingBranchNames: ReadonlySet<string> = useMemo(() => {
    if (!graphModel || !branchMode) return new Set<string>();
    const node = graphModel.nodes.find((n) => n.id === nodeId);
    if (!node) return new Set<string>();
    const config = node.config as Record<string, unknown>;

    switch (branchMode) {
      case "switch-case": {
        const cases = config.cases;
        if (!Array.isArray(cases)) return new Set<string>();
        return new Set(
          cases
            .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
            .map((c) => c.name as string)
            .filter(Boolean),
        );
      }
      case "fork-branch": {
        const branches = config.branches;
        if (!Array.isArray(branches)) return new Set<string>();
        return new Set(
          branches
            .filter((b): b is Record<string, unknown> => b != null && typeof b === "object")
            .map((b) => b.name as string)
            .filter(Boolean),
        );
      }
      default:
        return new Set<string>();
    }
  }, [graphModel, branchMode, nodeId]);

  return (
    <>
      {/* Selection toolbar — auto-shown by React Flow when selected */}
      <NodeToolbar position={Position.Top} offset={8} align="center">
        <div
          className="stgm flex items-center gap-0.5 rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-popover,var(--stgm-background,#fff))] p-0.5 shadow-md"
          role="toolbar"
          aria-label="Task actions"
          aria-orientation="horizontal"
        >
          <ToolbarButton
            icon={<DuplicateIcon />}
            label={`Duplicate task ${taskName}`}
            title="Duplicate"
            onClick={handleDuplicate}
          />
          <ToolbarButton
            ref={toolbarAddRef}
            icon={<PlusIcon />}
            label={`Add task after ${taskName}`}
            title="Add task after"
            onClick={handleToolbarAddClick}
          />
          <div className="mx-0.5 h-4 w-px bg-[var(--stgm-border,#e5e5e5)]" aria-hidden="true" />
          <ToolbarButton
            icon={<TrashIcon />}
            label={`Delete task ${taskName}`}
            title="Delete"
            onClick={handleDelete}
            destructive
          />
        </div>
      </NodeToolbar>

      {/* Delete button — revealed on hover via CSS group */}
      <button
        type="button"
        onClick={handleDelete}
        className={cn(
          "absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
          "hover:border-[var(--stgm-destructive,#ef4444)] hover:bg-[var(--stgm-destructive,#ef4444)] hover:text-[var(--stgm-primary-foreground,#fff)]",
          "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100",
        )}
        aria-label={`Delete task ${taskName}`}
        title="Delete task"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2 3h6M3.5 3V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V3M4 4.5v2.5M6 4.5v2.5M3 3l.5 5h3l.5-5" />
        </svg>
      </button>

      {/* Add successor button — revealed on hover via CSS group */}
      <button
        ref={hoverAddRef}
        type="button"
        onClick={handleHoverAddClick}
        className={cn(
          "absolute -bottom-3 left-1/2 z-10 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
          "hover:border-[var(--stgm-primary,#6366f1)] hover:bg-[var(--stgm-primary,#6366f1)] hover:text-[var(--stgm-primary-foreground,#fff)]",
          "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100",
        )}
        aria-label={`Add task after ${taskName}`}
        title="Add task"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M5 2v6M2 5h6" />
        </svg>
      </button>

      <TaskPickerPopover
        open={pickerOpen}
        onOpenChange={handlePickerOpenChange}
        onSelectKind={handleKindSelected}
        anchorRef={pickerAnchorRef as React.RefObject<HTMLElement | null>}
        insertionContext={insertionContext}
        graph={graphModel}
        side="bottom"
      />

      {branchMode && (
        <>
          <button
            ref={branchAddRef}
            type="button"
            onClick={() => setBranchPopoverOpen(true)}
            className={cn(
              "absolute -bottom-3 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--stgm-border-prominent,#d4d4d8)] bg-[var(--stgm-card,var(--stgm-background,#fff))] px-2 text-[9px] font-medium text-[var(--stgm-muted-foreground,#737373)] shadow-sm transition-all",
              "hover:border-[var(--stgm-primary,#6366f1)] hover:bg-[var(--stgm-primary,#6366f1)] hover:text-[var(--stgm-primary-foreground,#fff)]",
              "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100",
            )}
            aria-label={
              branchMode === "switch-case"
                ? "Add case"
                : branchMode === "fork-branch"
                  ? "Add branch"
                  : "Add catch"
            }
            title={
              branchMode === "switch-case"
                ? "Add case"
                : branchMode === "fork-branch"
                  ? "Add branch"
                  : "Add catch"
            }
          >
            +
          </button>

          <BranchAddPopover
            open={branchPopoverOpen}
            onOpenChange={setBranchPopoverOpen}
            onSubmit={handleBranchSubmit}
            anchorRef={branchAddRef as React.RefObject<HTMLElement | null>}
            mode={branchMode}
            existingNames={existingBranchNames}
          />
        </>
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// ToolbarButton
// ---------------------------------------------------------------------------

const TOOLBAR_BTN_CLASS = cn(
  "flex h-7 w-7 items-center justify-center rounded text-[var(--stgm-popover-foreground,var(--stgm-foreground,#1a1a2e))] outline-none transition-colors",
  "hover:bg-[var(--stgm-accent,#e5e5e5)] focus-visible:ring-1 focus-visible:ring-[var(--stgm-ring,#3b82f6)]",
);

const TOOLBAR_BTN_DESTRUCTIVE_CLASS = cn(
  "flex h-7 w-7 items-center justify-center rounded text-[var(--stgm-popover-foreground,var(--stgm-foreground,#1a1a2e))] outline-none transition-colors",
  "hover:bg-[var(--stgm-destructive,#ef4444)]/10 hover:text-[var(--stgm-destructive,#ef4444)] focus-visible:ring-1 focus-visible:ring-[var(--stgm-ring,#3b82f6)]",
);

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton({ icon, label, title, onClick, destructive }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={destructive ? TOOLBAR_BTN_DESTRUCTIVE_CLASS : TOOLBAR_BTN_CLASS}
        aria-label={label}
        title={title}
      >
        {icon}
      </button>
    );
  },
);
