"use client";

import { useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhaseBadge } from "../execution/ExecutionPhaseBadge.js";

/** Props for {@link SessionPanelChip}. */
export interface SessionPanelChipProps {
  /** Whether the panel is currently expanded. */
  readonly isOpen: boolean;
  /** Toggles the panel open/collapsed. */
  readonly onToggle: () => void;
  /**
   * The display execution's phase. Shown inside the chip while the panel is
   * collapsed (the panel's own top strip carries it while open); omitted in
   * execution-less hosts like the launcher.
   */
  readonly phase?: ExecutionPhase;
  /**
   * Aggregate count of facet items (write-backs + artifacts) awaiting the
   * user. Rendered as a dot-count while collapsed — the panel's only "something
   * arrived" signal, since arrivals never auto-open the panel.
   */
  readonly badgeCount?: number;
}

/**
 * The always-mounted top-right toggle for the unified session panel — the
 * Cursor "Show panel" chip. Collapsed, it is the session's status surface
 * (phase badge + pending-item count); open, it is the hide affordance. Being a
 * small leaf, it is also the one place that may safely carry per-arrival
 * re-renders while the panel subtree is unmounted.
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function SessionPanelChip({
  isOpen,
  onToggle,
  phase,
  badgeCount,
}: SessionPanelChipProps) {
  const showPhase =
    !isOpen && phase != null && phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
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
      {showPhase && <ExecutionPhaseBadge phase={phase} />}
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
