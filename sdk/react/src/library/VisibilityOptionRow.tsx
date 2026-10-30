"use client";

import { forwardRef } from "react";
import { cn } from "@stigmer/design-tokens";
import type { VisibilityLevelOption } from "./visibilityLevels.js";

/** Icon key shared by every visibility surface. */
export type VisibilityTone = VisibilityLevelOption["tone"];

// ---------------------------------------------------------------------------
// Chip — the read-only badge and the editable trigger share this base so the
// two states are visually identical apart from the trigger's caret affordance.
// ---------------------------------------------------------------------------

/** Base classes for the visibility chip (badge + selector trigger). */
export const VISIBILITY_CHIP_CLASS =
  "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1 stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:text-muted-foreground";

// ---------------------------------------------------------------------------
// Option row — one selectable level inside the popover (role="option") or the
// create-mode inline list (role="radio"). Pure presentation; the parent owns
// selection, focus management, and confirmation.
// ---------------------------------------------------------------------------

/** Props for {@link VisibilityOptionRow}. */
export interface VisibilityOptionRowProps {
  /** The level this row represents. */
  readonly option: VisibilityLevelOption;
  /** Whether this row is the resource's current visibility. */
  readonly isSelected: boolean;
  /**
   * ARIA role for the row. `"option"` inside the popover listbox,
   * `"radio"` inside the create-mode radiogroup — the matching selection
   * attribute (`aria-selected` / `aria-checked`) is applied automatically.
   */
  readonly role: "option" | "radio";
  /** Visually highlighted by keyboard/pointer navigation (popover only). */
  readonly isHighlighted?: boolean;
  /** Disables interaction (e.g. while a change is in flight). */
  readonly disabled?: boolean;
  /** Roving-tabindex value; the focused row is `0`, the rest `-1`. */
  readonly tabIndex?: number;
  /** Fires when the row is activated (click / Enter / Space). */
  readonly onSelect: () => void;
  /** Pointer hover, used to sync the keyboard highlight. */
  readonly onMouseEnter?: () => void;
  /** Keydown handler owned by the parent for roving focus. */
  readonly onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * A single visibility level rendered as a left-aligned row: tone icon,
 * label, one-line description, and a check when current. Shared by the
 * {@link VisibilitySelector} popover and its create-mode inline list so
 * option presentation has exactly one source.
 *
 * A level carrying {@link VisibilityLevelOption.lockedReason} renders
 * non-interactive with a lock affordance and the reason as its detail line
 * — the level stays discoverable (the reason names the path forward)
 * without being selectable. The locked row keeps its normal opacity: it is
 * informative, not in a transient disabled state.
 */
export const VisibilityOptionRow = forwardRef<
  HTMLButtonElement,
  VisibilityOptionRowProps
>(function VisibilityOptionRow(
  {
    option,
    isSelected,
    role,
    isHighlighted,
    disabled,
    tabIndex,
    onSelect,
    onMouseEnter,
    onKeyDown,
  },
  ref,
) {
  const locked = option.lockedReason !== undefined;
  const selectionAttr =
    role === "radio"
      ? { "aria-checked": isSelected }
      : { "aria-selected": isSelected };

  return (
    <button
      ref={ref}
      type="button"
      role={role}
      {...selectionAttr}
      aria-disabled={locked || undefined}
      tabIndex={tabIndex}
      disabled={disabled || locked}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onKeyDown={onKeyDown}
      className={cn(
        "stg:flex stg:w-full stg:items-start stg:gap-2 stg:rounded-md stg:px-2.5 stg:py-2 stg:text-left stg:transition-colors",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        locked
          ? "stg:disabled:pointer-events-none stg:cursor-default"
          : "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        !locked &&
          (isHighlighted ? "stg:bg-accent stg:text-foreground" : "stg:hover:bg-accent-hover"),
      )}
    >
      <VisibilityIcon
        tone={option.tone}
        className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-muted-foreground"
      />
      <span className="stg:min-w-0 stg:flex-1">
        <span
          className={cn(
            "stg:block stg:text-xs stg:font-medium",
            locked ? "stg:text-muted-foreground" : "stg:text-foreground",
          )}
        >
          {option.label}
        </span>
        <span className="stg:block stg:text-2xs stg:leading-snug stg:text-muted-foreground">
          {locked ? option.lockedReason : option.description}
        </span>
      </span>
      {locked ? (
        <LockIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-muted-foreground" />
      ) : (
        isSelected && (
          <CheckIcon className="stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:text-primary" />
        )
      )}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Escalation prompt — the inline confirm shown before access widens
// ---------------------------------------------------------------------------

/**
 * Inline-confirm (escalation prompt) treatment. Widening access is a
 * caution, so every level draws the kit's caution notice: the theme's
 * at-risk status fill with foreground text, which the contrast contract
 * audits in every preset and mode, and the kit's primary button to confirm.
 */
export const ESCALATION_PROMPT_STYLES = {
  container: "stg:bg-status-degraded-subtle",
  text: "stg:text-foreground",
  confirm: "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
  cancel: "stg:text-foreground stg:hover:underline",
} as const;

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

/** Icon for a visibility tone; shared by the row, badge, and trigger. */
export function VisibilityIcon({
  tone,
  className,
}: {
  readonly tone: VisibilityTone;
  readonly className?: string;
}) {
  switch (tone) {
    case "org":
      return <UsersIcon className={className} />;
    case "childOrgs":
      return <BuildingsIcon className={className} />;
    default:
      return <LockIcon className={className} />;
  }
}

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function UsersIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" />
      <circle cx="11.5" cy="5.5" r="2" />
      <path d="M14 13c0-1.66-1.12-3-2.5-3-.5 0-1 .14-1.4.4" />
    </svg>
  );
}

function BuildingsIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14V4.5L6.5 2v12" />
      <path d="M6.5 6.5 14 8.5V14" />
      <path d="M2 14h12" />
      <path d="M4.25 6h.01M4.25 8.5h.01M4.25 11h.01M10.5 10.5h.01M10.5 12.5h.01" />
    </svg>
  );
}

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}
