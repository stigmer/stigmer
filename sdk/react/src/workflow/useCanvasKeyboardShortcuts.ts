"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { CanvasSelection } from "./useWorkflowCanvas";

/** Options for {@link useCanvasKeyboardShortcuts}. */
export interface UseCanvasKeyboardShortcutsOptions {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly selection: CanvasSelection | null;
  readonly duplicateNode: (nodeId: string) => void;
  readonly selectAll: () => void;
  readonly clearSelection: () => void;
  readonly onRequestTaskPicker: (
    position: { x: number; y: number },
    sourceNodeId?: string,
  ) => void;
  readonly onDismiss: () => void;
  readonly copySelection?: () => void;
  readonly pasteAtCenter?: () => void;
  readonly cutSelection?: () => void;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

function isFocusInsideContainer(container: HTMLElement): boolean {
  const active = document.activeElement;
  return active === container || container.contains(active);
}

/**
 * Canvas-scoped keyboard shortcuts for the workflow editor.
 *
 * Binds shortcuts that are only active when focus is inside the canvas
 * container, using the same capture-phase listener pattern as
 * {@link useGraphHistory} (undo/redo). Bare-key shortcuts (N, Escape)
 * are suppressed when a text input has focus.
 *
 * | Shortcut          | Action                                |
 * |-------------------|---------------------------------------|
 * | `Ctrl/Cmd+D`      | Duplicate selected node               |
 * | `Ctrl/Cmd+A`      | Select all non-sentinel nodes         |
 * | `Ctrl/Cmd+C`      | Copy selected node(s) to clipboard    |
 * | `Ctrl/Cmd+V`      | Paste from clipboard                  |
 * | `Ctrl/Cmd+X`      | Cut (copy + delete)                   |
 * | `N` (bare key)    | Open task picker                      |
 * | `Escape`          | Clear selection / close open overlays |
 *
 * @internal Not exported from the SDK barrel.
 */
export function useCanvasKeyboardShortcuts({
  containerRef,
  selection,
  duplicateNode,
  selectAll,
  clearSelection,
  onRequestTaskPicker,
  onDismiss,
  copySelection,
  pasteAtCenter,
  cutSelection,
}: UseCanvasKeyboardShortcutsOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!container || !isFocusInsideContainer(container)) return;

      const isMod = e.metaKey || e.ctrlKey;

      // Ctrl/Cmd+D — duplicate selected node
      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();
        if (selection?.type === "node") {
          duplicateNode(selection.id);
        }
        return;
      }

      // Ctrl/Cmd+A — select all
      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        selectAll();
        return;
      }

      // Ctrl/Cmd+C — copy selection
      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        copySelection?.();
        return;
      }

      // Ctrl/Cmd+V — paste
      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v") {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        pasteAtCenter?.();
        return;
      }

      // Ctrl/Cmd+X — cut
      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "x") {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        cutSelection?.();
        return;
      }

      // Bare-key shortcuts — skip when typing in a text field
      if (isMod || e.altKey) return;

      // Escape — clear selection, close menus/pickers
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        clearSelection();
        return;
      }

      // N — open task picker
      if (!e.shiftKey && e.key.toLowerCase() === "n") {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        if (selection?.type === "node") {
          // Position below the selected node — the editor resolves
          // the actual screen coordinates from the node's React Flow position.
          onRequestTaskPicker({ x: 0, y: 0 }, selection.id);
        } else {
          // Viewport center
          const rect = container.getBoundingClientRect();
          onRequestTaskPicker({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [
    containerRef,
    selection,
    duplicateNode,
    selectAll,
    clearSelection,
    onRequestTaskPicker,
    onDismiss,
    copySelection,
    pasteAtCenter,
    cutSelection,
  ]);
}
