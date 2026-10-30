"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { ResizableSplit } from "../internal/ResizableSplit.js";

/** Props for {@link SessionViewerLayout}. */
export interface SessionViewerLayoutProps {
  /**
   * The conversation column — the layout's primary (left) pane. Stays
   * mounted at a stable tree position across every panel open/close, so
   * streaming and scroll state survive the toggle.
   */
  readonly conversation: ReactNode;
  /**
   * The session panel content, or `null` while the panel is collapsed.
   * This is the single source of truth for the collapsed state: passing
   * `null` collapses the split (the conversation fills the row) and hides
   * the drag separator; passing content expands the panel into the
   * flexible region. Hosts derive it from their panel controller, e.g.
   * `panel.isOpen ? <WorkspaceSurface … /> : null`.
   */
  readonly panel: ReactNode | null;
  /**
   * The panel's toggle chip, rendered at the end of the layout's control
   * row (typically the session panel chip, {@link PanelChip}). Omit it to
   * render no toggle — how hosts express audiences that must never open
   * the panel (the guest case in {@link SessionViewer} and
   * {@link NewSessionViewer}).
   */
  readonly chip?: ReactNode;
  /**
   * Host-injected header actions, rendered beside the chip in the
   * control row at the top of the conversation pane (slot injection, as {@link SessionViewerProps.headerActions}).
   */
  readonly headerActions?: ReactNode;
  /**
   * `localStorage` key persisting the chat pane's drag-resized width
   * across sessions. Each host passes its own key so the two shipped
   * viewers keep distinct widths. **Omit it in deterministic hosts**
   * (documentation embeds, video export): with no key the width always
   * starts at the default, so every render of the same input is
   * pixel-identical instead of depending on previously persisted state.
   */
  readonly splitStorageKey?: string;
  /**
   * Whether the conversation pane collapses while the panel is open and
   * the layout's own box is narrower than 48rem, leaving the panel
   * full-width — the shipped console behavior in tight quarters.
   *
   * The narrowness check is a CSS container query against the layout's
   * box, never the viewport (stigmer/stigmer#301), so it is equally
   * correct full-window and docked in a narrow pane of a wide window.
   *
   * Pass `false` in hosts that must never trade the conversation for the
   * panel regardless of available space — e.g. a scripted documentation
   * tour rendered on a narrow fixed canvas, where the collapse would hide
   * the conversation on exactly the beats that open the panel.
   *
   * @default true
   */
  readonly responsive?: boolean;
  /**
   * Accessible label for the split's drag separator. Name the pane being
   * resized in the host's vocabulary (the session viewer's chat pane vs
   * the launcher's composer pane).
   *
   * @default "Resize chat panel"
   */
  readonly resizeAriaLabel?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * The one conversation-plus-panel frame every session viewer shares —
 * {@link SessionViewer} and {@link NewSessionViewer} both render it, so the
 * two surfaces cannot drift apart (their behave-identically contract), and
 * platform builders composing a custom session surface from
 * {@link WorkspaceSurface}, {@link PanelChip}, and the session facets get
 * the same geometry the shipped console uses.
 *
 * The layout owns exactly three things:
 *
 * - **The control row** — the host's `headerActions` beside the panel
 *   toggle `chip`, a row at the top of the conversation pane, so it never
 *   covers the thread or the panel (stigmer#2709, #2726).
 * - **The split geometry** — chat fills the row while the panel is
 *   collapsed; opening makes the chat the fixed, drag-resizable pane
 *   (420px default, 320–640px) and hands the flexible region to the panel.
 * - **The collapse mechanics** — collapse goes through the split's
 *   `collapsedPane` (CSS, not conditional structure), so the conversation
 *   is always the same first child and an open/close toggle never
 *   remounts it.
 *
 * Everything rendered inside the panes belongs to the host: the layout
 * takes opaque `ReactNode`s and never inspects them.
 */
export function SessionViewerLayout({
  conversation,
  panel,
  chip,
  headerActions,
  splitStorageKey,
  responsive = true,
  resizeAriaLabel = "Resize chat panel",
  className,
}: SessionViewerLayoutProps) {
  const isPanelOpen = panel != null;

  return (
    <div className={cn("stg:relative stg:flex stg:h-full stg:w-full stg:flex-col", className)}>

      <ResizableSplit
        resizablePane="primary"
        collapsedPane={isPanelOpen ? "none" : "secondary"}
        defaultSize={420}
        minSize={320}
        maxSize={640}
        storageKey={splitStorageKey}
        responsiveCollapse={responsive && isPanelOpen ? "primary" : "none"}
        ariaLabel={resizeAriaLabel}
        className="stg:min-h-0 stg:flex-1"
        primary={
          headerActions != null || chip != null ? (
            <div className="stg:flex stg:h-full stg:min-w-0 stg:flex-col">
              <div className="stg:flex stg:shrink-0 stg:items-center stg:justify-end stg:gap-2 stg:px-4 stg:pt-2">
                {headerActions}
                {chip}
              </div>
              <div className="stg:min-h-0 stg:flex-1">{conversation}</div>
            </div>
          ) : (
            conversation
          )
        }
        secondary={panel}
      />
    </div>
  );
}
