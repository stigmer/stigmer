"use client";

// The always-mounted toggle chip for a collapsible WorkspaceSurface panel.
// Domain: workspace (shared by the session and workflow execution viewers).

import { useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link PanelChip}. */
export interface PanelChipProps {
  /** Whether the panel is currently expanded. */
  readonly isOpen: boolean;
  /** Toggles the panel open/collapsed. */
  readonly onToggle: () => void;
  /**
   * Aggregate count of panel items awaiting the user (write-backs +
   * artifacts on the session side; artifacts on the workflow side). Rendered
   * as a dot-count while collapsed — the panel's only "something arrived"
   * signal, since arrivals never auto-open the panel.
   */
  readonly badgeCount?: number;
}

/**
 * The always-mounted toggle for a collapsible workspace panel — the Cursor
 * "Show panel" chip. Collapsed, it carries the pending-item count; open, it
 * is the hide affordance. Being a small leaf, it is also the one place that
 * may safely carry per-arrival re-renders while the panel subtree is
 * unmounted. Execution status deliberately does not surface here (or
 * anywhere else in viewer chrome) — the thread/graph itself communicates run
 * state.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function PanelChip({ isOpen, onToggle, badgeCount }: PanelChipProps) {
  const showCount = !isOpen && badgeCount != null && badgeCount > 0;

  // Focus restoration: collapsing unmounts the panel subtree, so keyboard
  // focus that lived inside it (rail, tabs, viewer) falls to <body>. Reclaim
  // it here — the chip is the collapse's logical origin. Focus resting
  // anywhere else (e.g. the composer) is respected. Opening deliberately does
  // NOT move focus: the chip is a standard disclosure trigger.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevOpenRef.current && !isOpen && document.activeElement === document.body) {
      buttonRef.current?.focus();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-label={isOpen ? "Hide panel" : "Show panel"}
      title={isOpen ? "Hide panel" : "Show panel"}
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-1",
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {showCount && (
        <span
          aria-label={`${badgeCount} new items`}
          className="inline-flex min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 py-px text-[10px] font-medium leading-none text-primary-foreground"
        >
          {badgeCount}
        </span>
      )}
      <PanelIcon open={isOpen} />
    </button>
  );
}

/**
 * Panel-layout glyph: a frame with its right region filled while the panel is
 * open, hollow while collapsed — mirroring the state it toggles to at a glance.
 */
function PanelIcon({ open }: { readonly open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M9.5 2.5v11" />
      {open && (
        <rect x="9.5" y="2.5" width="5" height="11" rx="1.5" fill="currentColor" stroke="none" />
      )}
    </svg>
  );
}
