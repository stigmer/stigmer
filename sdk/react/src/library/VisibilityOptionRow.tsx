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
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground";

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
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        isHighlighted ? "bg-accent text-foreground" : "hover:bg-accent-hover",
      )}
    >
      <VisibilityIcon
        tone={option.tone}
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-foreground">
          {option.label}
        </span>
        <span className="block text-[0.65rem] leading-snug text-muted-foreground">
          {option.description}
        </span>
      </span>
      {isSelected && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Tone styling — one row per visibility tone, keyed by VisibilityLevelOption
// ---------------------------------------------------------------------------

/** Selected-segment / active-tone treatment (also used by the inline confirm). */
export const SELECTED_STYLES: Record<VisibilityTone, string> = {
  private:
    "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  platform:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  public:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

/** Inline-confirm (escalation prompt) treatment, keyed by tone. */
export const PROMPT_STYLES: Record<
  VisibilityTone,
  { container: string; text: string; confirm: string; cancel: string }
> = {
  // Private never escalates, but the row keeps the Record total.
  private: {
    container:
      "border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-200",
    confirm:
      "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500",
    cancel:
      "text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100",
  },
  org: {
    container:
      "border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/30",
    text: "text-blue-800 dark:text-blue-200",
    confirm:
      "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
    cancel:
      "text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100",
  },
  platform: {
    container:
      "border-violet-200 bg-violet-50 dark:border-violet-800/50 dark:bg-violet-950/30",
    text: "text-violet-800 dark:text-violet-200",
    confirm:
      "bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500",
    cancel:
      "text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100",
  },
  public: {
    container:
      "border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/30",
    text: "text-emerald-800 dark:text-emerald-200",
    confirm:
      "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
    cancel:
      "text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100",
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
