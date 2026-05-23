"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowGraphModel } from "../workflow-graph-model";
import { TASK_NAME_PATTERN, TASK_NAME_PATTERN_ERROR } from "../canvas-constants";
import type { InspectorNodeIdentity, InspectorMutations } from "./types";

/** Props for {@link InspectorHeader}. */
export interface InspectorHeaderProps {
  /** Resolved node identity for the selected task. */
  readonly identity: InspectorNodeIdentity;
  /** Graph model for name uniqueness validation. */
  readonly graph: WorkflowGraphModel;
  /** Mutation callbacks for node actions. */
  readonly mutations: InspectorMutations;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Inspector panel header showing node identity and an actions overflow menu.
 *
 * Displays the task name (click-to-rename), kind badge with category color,
 * and a `...` overflow menu for structural actions (Duplicate, Delete, etc.).
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const InspectorHeader = memo(function InspectorHeader({
  identity,
  graph,
  mutations,
  className,
}: InspectorHeaderProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(identity.taskName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const existingNames = new Set(
    graph.nodes.filter((n) => n.id !== identity.nodeId).map((n) => n.taskName),
  );

  const startEditing = useCallback(() => {
    setEditingName(true);
    setNameValue(identity.taskName);
    setNameError(null);
    setMenuOpen(false);
  }, [identity.taskName]);

  const commitName = useCallback(() => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (!TASK_NAME_PATTERN.test(trimmed)) {
      setNameError(TASK_NAME_PATTERN_ERROR);
      return;
    }
    if (existingNames.has(trimmed)) {
      setNameError("A task with this name already exists");
      return;
    }
    setEditingName(false);
    setNameError(null);
    if (trimmed !== identity.taskName) {
      mutations.onRenameNode(identity.nodeId, trimmed);
    }
  }, [nameValue, existingNames, identity.nodeId, identity.taskName, mutations.onRenameNode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commitName();
      if (e.key === "Escape") {
        setEditingName(false);
        setNameError(null);
      }
    },
    [commitName],
  );

  const toggleMenu = useCallback(() => setMenuOpen((prev) => !prev), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className={cn("flex flex-col gap-1.5 border-b border-[var(--stgm-border,#e5e5e5)] px-3 py-2.5", className)}>
      {/* Row 1: task name + overflow menu */}
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex flex-col gap-0.5">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => { setNameValue(e.target.value); setNameError(null); }}
                onBlur={commitName}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1 text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
              />
              {nameError && (
                <span className="text-[10px] text-[var(--stgm-destructive,#ef4444)]">{nameError}</span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={startEditing}
              className="w-fit max-w-full truncate text-left text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)] hover:underline"
              title="Click to rename"
            >
              {identity.taskName}
            </button>
          )}
        </div>

        {/* Overflow menu trigger */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={toggleMenu}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
            aria-label="Node actions"
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <MoreIcon />
          </button>

          {menuOpen && (
            <ActionsMenu
              nodeId={identity.nodeId}
              mutations={mutations}
              onRename={startEditing}
              onClose={closeMenu}
            />
          )}
        </div>
      </div>

      {/* Row 2: kind badge + category */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight"
          style={{
            color: identity.categoryColor,
            backgroundColor: `color-mix(in srgb, ${identity.categoryColor} 12%, transparent)`,
          }}
        >
          {identity.kindString.replace(/_/g, " ")}
        </span>
        {identity.description && (
          <span className="truncate text-[10px] text-[var(--stgm-muted-foreground,#737373)]" title={identity.description}>
            {identity.description}
          </span>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Actions menu
// ---------------------------------------------------------------------------

function ActionsMenu({
  nodeId,
  mutations,
  onRename,
  onClose,
}: {
  nodeId: string;
  mutations: InspectorMutations;
  onRename: () => void;
  onClose: () => void;
}) {
  const handleAction = useCallback(
    (action: () => void) => {
      onClose();
      action();
    },
    [onClose],
  );

  return (
    <>
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      <div
        role="menu"
        className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-popover,var(--stgm-background,#fff))] py-1 shadow-md"
      >
        <MenuItem label="Rename" onClick={() => handleAction(onRename)} />
        {mutations.onDuplicateNode && (
          <MenuItem label="Duplicate" onClick={() => handleAction(() => mutations.onDuplicateNode!(nodeId))} />
        )}
        {mutations.onToggleDisabled && (
          <MenuItem label="Disable / Bypass" onClick={() => handleAction(() => mutations.onToggleDisabled!(nodeId))} />
        )}
        {mutations.onWrapInTryCatch && (
          <MenuItem label="Wrap in Try/Catch" onClick={() => handleAction(() => mutations.onWrapInTryCatch!(nodeId))} />
        )}
        <MenuDivider />
        {mutations.onDeleteNode && (
          <MenuItem
            label="Delete task"
            destructive
            onClick={() => handleAction(() => mutations.onDeleteNode!(nodeId))}
          />
        )}
      </div>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  destructive,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors",
        destructive
          ? "text-[var(--stgm-destructive,#ef4444)] hover:bg-[var(--stgm-destructive,#ef4444)]/10"
          : "text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-muted,#f5f5f5)]",
      )}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-[var(--stgm-border,#e5e5e5)]" />;
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}
