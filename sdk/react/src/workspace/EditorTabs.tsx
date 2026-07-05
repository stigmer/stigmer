"use client";

import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@stigmer/theme";
import { editorKey, type OpenEditor } from "../internal/store/index.js";

/**
 * Deterministic, space-free DOM id for a tab, built from an instance-scoped
 * `prefix` (a `useId()` value) and the editor `key`. Shared by the tab (its
 * `id`) and the editor body (its `aria-labelledby`) so the two associate; the
 * key is percent-encoded because editor keys embed file paths that may contain
 * characters (spaces) illegal in a space-separated IDREF.
 */
export function editorTabDomId(prefix: string, key: string): string {
  return `${prefix}${encodeURIComponent(key)}`;
}

/** Props for {@link EditorTabs}. */
export interface EditorTabsProps {
  /** Open editors in tab order. */
  readonly editors: readonly OpenEditor[];
  /** Key of the active editor (`editorKey(entryId, path)`), or `null`. */
  readonly activeKey: string | null;
  /** Focus an open editor (single click). */
  readonly onActivate: (entryId: string, path: string) => void;
  /** Pin an editor (double-click) so it stops being the reusable preview tab. */
  readonly onPin: (entryId: string, path: string) => void;
  /** Close an editor (close button or middle click). */
  readonly onClose: (entryId: string, path: string) => void;
  /**
   * DOM id of the editor body (`role="tabpanel"`). When provided together with
   * {@link tabIdPrefix}, each tab gets a stable `id` and `aria-controls` linking
   * it to that panel. Optional so the strip degrades gracefully without a panel.
   */
  readonly panelId?: string;
  /** Instance-scoped prefix for per-tab ids (see {@link editorTabDomId}). */
  readonly tabIdPrefix?: string;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The editor group's tab strip, following VS Code preview-tab semantics:
 * a single-click preview tab renders in italics and is reused as the user
 * browses; double-clicking a tab pins it (persistent). Each tab has a close
 * control, also reachable by middle-click.
 *
 * A `role="tablist"` of `role="tab"` items; the matching `tabpanel` is the
 * editor body rendered by the surface. Arrow keys move focus between tabs and
 * activate; Delete/Backspace closes the focused tab. The visual close "X" is a
 * presentational (`aria-hidden`) mouse affordance — assistive tech closes via
 * the keyboard, so the X is not a nested interactive control (WCAG 4.1.2). All
 * visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function EditorTabs({
  editors,
  activeKey,
  onActivate,
  onPin,
  onClose,
  panelId,
  tabIdPrefix,
  className,
}: EditorTabsProps) {
  const move = useCallback(
    (from: number, delta: number) => {
      const next = from + delta;
      if (next < 0 || next >= editors.length) return;
      const editor = editors[next];
      onActivate(editor.entryId, editor.path);
    },
    [editors, onActivate],
  );

  return (
    <div
      role="tablist"
      aria-label="Open editors"
      aria-orientation="horizontal"
      className={cn(
        "flex shrink-0 items-stretch overflow-x-auto border-b border-border",
        className,
      )}
    >
      {editors.map((editor, index) => {
        const key = editorKey(editor.entryId, editor.path);
        const isActive = key === activeKey;
        const lastSlash = editor.path.lastIndexOf("/");
        const basename =
          lastSlash >= 0 ? editor.path.slice(lastSlash + 1) : editor.path;

        const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            move(index, 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            move(index, -1);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate(editor.entryId, editor.path);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onClose(editor.entryId, editor.path);
          }
        };

        const handleAuxClick = (e: MouseEvent<HTMLDivElement>) => {
          // Middle click closes, matching browser/editor tab conventions.
          if (e.button === 1) {
            e.preventDefault();
            onClose(editor.entryId, editor.path);
          }
        };

        return (
          <div
            key={key}
            role="tab"
            id={tabIdPrefix ? editorTabDomId(tabIdPrefix, key) : undefined}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            title={editor.path}
            onClick={() => onActivate(editor.entryId, editor.path)}
            onDoubleClick={() => onPin(editor.entryId, editor.path)}
            onAuxClick={handleAuxClick}
            onKeyDown={handleKeyDown}
            className={cn(
              "group flex max-w-[12rem] shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              isActive
                ? "bg-background text-foreground"
                : "bg-muted-faint text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className={cn("truncate", editor.preview && "italic")}>
              {basename}
            </span>
            {/* The visual close "X" is a presentational mouse affordance, NOT a
                nested interactive control: a `<button>` inside `role="tab"` would
                violate WCAG 4.1.2 (axe `nested-interactive`). Assistive tech and
                keyboard users close the focused tab via Delete/Backspace (handled
                above), so `aria-hidden` here removes the redundant nested control
                without losing the close action for anyone. */}
            <span
              aria-hidden="true"
              title={`Close ${basename}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(editor.entryId, editor.path);
              }}
              className={cn(
                "shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground transition-opacity hover:bg-accent-hover hover:text-foreground",
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <CloseIcon />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 3.5L10.5 10.5" />
      <path d="M10.5 3.5L3.5 10.5" />
    </svg>
  );
}
