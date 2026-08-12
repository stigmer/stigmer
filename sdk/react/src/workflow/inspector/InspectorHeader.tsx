"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowGraphModel } from "../workflow-graph-model.js";
import { TASK_NAME_PATTERN, TASK_NAME_PATTERN_ERROR } from "../canvas-constants.js";
import type { InspectorNodeIdentity, InspectorMutations } from "./types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../internal/tooltip.js";
import { TruncatedText } from "../../internal/truncated-text.js";

/** Props for {@link InspectorHeader}. */
export interface InspectorHeaderProps {
  /** Resolved node identity for the selected task. */
  readonly identity: InspectorNodeIdentity;
  /** Graph model for name uniqueness validation. */
  readonly graph: WorkflowGraphModel;
  /** Mutation callbacks for node actions. */
  readonly mutations: InspectorMutations;
  /** Called to open the View YAML dialog for this node. */
  readonly onViewYaml?: (nodeId: string) => void;
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
  onViewYaml,
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
    <div className={cn("stg:flex stg:flex-col stg:gap-1.5 stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:px-3 stg:py-2.5", className)}>
      {/* Row 1: task name + overflow menu */}
      <div className="stg:flex stg:items-center stg:gap-1">
        <div className="stg:min-w-0 stg:flex-1">
          {editingName ? (
            <div className="stg:flex stg:flex-col stg:gap-0.5">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => { setNameValue(e.target.value); setNameError(null); }}
                onBlur={commitName}
                onKeyDown={handleKeyDown}
                autoFocus
                className="stg:w-full stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1 stg:text-sm stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
              />
              {nameError && (
                <span className="stg:text-[10px] stg:text-[var(--stgm-destructive,#ef4444)]">{nameError}</span>
              )}
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={startEditing}
                    className="stg:w-fit stg:max-w-full stg:truncate stg:text-left stg:text-sm stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:hover:underline"
                  />
                }
              >
                {identity.taskName}
              </TooltipTrigger>
              <TooltipContent side="top">Click to rename</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Overflow menu trigger */}
        <div className="stg:relative stg:shrink-0">
          <button
            type="button"
            onClick={toggleMenu}
            className="stg:flex stg:h-6 stg:w-6 stg:items-center stg:justify-center stg:rounded stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
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
              onViewYaml={onViewYaml}
              onClose={closeMenu}
            />
          )}
        </div>
      </div>

      {/* Row 2: kind badge + category */}
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <span
          className="stg:inline-block stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-tight"
          style={{
            color: identity.categoryColor,
            backgroundColor: `color-mix(in srgb, ${identity.categoryColor} 12%, transparent)`,
          }}
        >
          {identity.kindString.replace(/_/g, " ")}
        </span>
        {identity.description && (
          <TruncatedText
            text={identity.description}
            className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]"
          />
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
  onViewYaml,
  onClose,
}: {
  nodeId: string;
  mutations: InspectorMutations;
  onRename: () => void;
  onViewYaml?: (nodeId: string) => void;
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
      <div className="stg:fixed stg:inset-0 stg:z-40" onClick={onClose} aria-hidden="true" />

      <div
        role="menu"
        className="stg:absolute stg:right-0 stg:top-full stg:z-50 stg:mt-1 stg:min-w-[160px] stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-popover,var(--stgm-background,#fff))] stg:py-1 stg:shadow-md"
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
        {onViewYaml && (
          <MenuItem label="View YAML" onClick={() => handleAction(() => onViewYaml(nodeId))} />
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
        "stg:flex stg:w-full stg:items-center stg:px-3 stg:py-1.5 stg:text-left stg:text-xs stg:transition-colors",
        destructive
          ? "stg:text-[var(--stgm-destructive,#ef4444)] stg:hover:bg-[var(--stgm-destructive,#ef4444)]/10"
          : "stg:text-[var(--stgm-foreground,#1a1a2e)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)]",
      )}
    >
      {label}
    </button>
  );
}

function MenuDivider() {
  return <div className="stg:my-1 stg:border-t stg:border-[var(--stgm-border,#e5e5e5)]" />;
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
