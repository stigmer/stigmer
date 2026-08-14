"use client";

import { forwardRef } from "react";
import { cn } from "@stigmer/theme";
import type { VisibilityLevelOption } from "./visibilityLevels.js";

/** Color treatment key shared by every visibility surface. */
export type VisibilityTone = VisibilityLevelOption["tone"];

// ---------------------------------------------------------------------------
// Chip — the read-only badge and the editable trigger share this base so the
// two states are visually identical apart from the trigger's caret affordance.
// ---------------------------------------------------------------------------

/** Base classes for the visibility chip (badge + selector trigger). */
export const VISIBILITY_CHIP_CLASS =
  "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1 stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground";

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
        <span className="stg:block stg:text-[0.65rem] stg:leading-snug stg:text-muted-foreground">
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
// Tone styling — one row per visibility tone, keyed by VisibilityLevelOption
// ---------------------------------------------------------------------------

/** Selected-segment / active-tone treatment (also used by the inline confirm). */
export const SELECTED_STYLES: Record<VisibilityTone, string> = {
  private:
    "stg:bg-amber-50 stg:text-amber-800 stg:dark:bg-amber-900/30 stg:dark:text-amber-300",
  org: "stg:bg-blue-100 stg:text-blue-800 stg:dark:bg-blue-900/40 stg:dark:text-blue-300",
  platform:
    "stg:bg-violet-100 stg:text-violet-800 stg:dark:bg-violet-900/40 stg:dark:text-violet-300",
  public:
    "stg:bg-emerald-100 stg:text-emerald-800 stg:dark:bg-emerald-900/40 stg:dark:text-emerald-300",
};

/** Inline-confirm (escalation prompt) treatment, keyed by tone. */
export const PROMPT_STYLES: Record<
  VisibilityTone,
  { container: string; text: string; confirm: string; cancel: string }
> = {
  // Private never escalates, but the row keeps the Record total.
  private: {
    container:
      "stg:border-amber-200 stg:bg-amber-50 stg:dark:border-amber-800/50 stg:dark:bg-amber-950/30",
    text: "stg:text-amber-800 stg:dark:text-amber-200",
    confirm:
      "stg:bg-amber-600 stg:hover:bg-amber-700 stg:dark:bg-amber-600 stg:dark:hover:bg-amber-500",
    cancel:
      "stg:text-amber-700 stg:hover:text-amber-900 stg:dark:text-amber-300 stg:dark:hover:text-amber-100",
  },
  org: {
    container:
      "stg:border-blue-200 stg:bg-blue-50 stg:dark:border-blue-800/50 stg:dark:bg-blue-950/30",
    text: "stg:text-blue-800 stg:dark:text-blue-200",
    confirm:
      "stg:bg-blue-600 stg:hover:bg-blue-700 stg:dark:bg-blue-600 stg:dark:hover:bg-blue-500",
    cancel:
      "stg:text-blue-700 stg:hover:text-blue-900 stg:dark:text-blue-300 stg:dark:hover:text-blue-100",
  },
  platform: {
    container:
      "stg:border-violet-200 stg:bg-violet-50 stg:dark:border-violet-800/50 stg:dark:bg-violet-950/30",
    text: "stg:text-violet-800 stg:dark:text-violet-200",
    confirm:
      "stg:bg-violet-600 stg:hover:bg-violet-700 stg:dark:bg-violet-600 stg:dark:hover:bg-violet-500",
    cancel:
      "stg:text-violet-700 stg:hover:text-violet-900 stg:dark:text-violet-300 stg:dark:hover:text-violet-100",
  },
  public: {
    container:
      "stg:border-emerald-200 stg:bg-emerald-50 stg:dark:border-emerald-800/50 stg:dark:bg-emerald-950/30",
    text: "stg:text-emerald-800 stg:dark:text-emerald-200",
    confirm:
      "stg:bg-emerald-600 stg:hover:bg-emerald-700 stg:dark:bg-emerald-600 stg:dark:hover:bg-emerald-500",
    cancel:
      "stg:text-emerald-700 stg:hover:text-emerald-900 stg:dark:text-emerald-300 stg:dark:hover:text-emerald-100",
  },
};

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
    case "platform":
      return <BuildingsIcon className={className} />;
    case "public":
      return <GlobeIcon className={className} />;
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

function GlobeIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.66 1.46 2.6 3.63 2.6 6s-.94 4.54-2.6 6c-1.66-1.46-2.6-3.63-2.6-6s.94-4.54 2.6-6Z" />
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
