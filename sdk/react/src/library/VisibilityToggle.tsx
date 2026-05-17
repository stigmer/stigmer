"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

/** Props for {@link VisibilityToggle}. */
export interface VisibilityToggleProps {
  /** Current visibility of the resource. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Called when the user confirms a visibility change.
   * The toggle shows an inline confirmation before invoking this
   * callback when switching to PUBLIC.
   */
  readonly onVisibilityChange: (v: ApiResourceVisibility) => void;
  /** Shows a spinner/disabled state while the RPC is in flight. */
  readonly isPending?: boolean;
  /** Disables all interaction (e.g., when the user lacks can_edit). */
  readonly disabled?: boolean;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

const OPTIONS: readonly {
  readonly value: ApiResourceVisibility;
  readonly label: string;
}[] = [
  { value: ApiResourceVisibility.visibility_private, label: "Private" },
  { value: ApiResourceVisibility.visibility_public, label: "Public" },
];

/**
 * Segmented control for toggling resource visibility between
 * Private and Public.
 *
 * Switching to PUBLIC shows a brief inline confirmation prompt
 * since making a resource publicly visible is a consequential
 * action. Switching to PRIVATE applies immediately without
 * confirmation (revoking access is always safe).
 *
 * Follows the same visual pattern as {@link ScopeToggle} —
 * WAI-ARIA Radio Group with roving tabindex. All visual
 * properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <VisibilityToggle
 *   visibility={skill.metadata.visibility}
 *   onVisibilityChange={handleVisibilityChange}
 *   isPending={isPending}
 * />
 * ```
 */
export function VisibilityToggle({
  visibility,
  onVisibilityChange,
  isPending = false,
  disabled = false,
  className,
}: VisibilityToggleProps) {
  const [confirming, setConfirming] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isPublic =
    visibility === ApiResourceVisibility.visibility_public;
  const effectivelyDisabled = disabled || isPending;

  const handleSelect = useCallback(
    (value: ApiResourceVisibility) => {
      if (value === visibility) return;

      if (value === ApiResourceVisibility.visibility_public) {
        setConfirming(true);
        return;
      }

      onVisibilityChange(value);
    },
    [visibility, onVisibilityChange],
  );

  const confirmPublic = useCallback(() => {
    setConfirming(false);
    onVisibilityChange(ApiResourceVisibility.visibility_public);
  }, [onVisibilityChange]);

  const cancelConfirm = useCallback(() => {
    setConfirming(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
      }

      if (nextIndex !== null) {
        optionRefs.current[nextIndex]?.focus();
        handleSelect(OPTIONS[nextIndex].value);
      }
    },
    [handleSelect],
  );

  return (
    <div className={cn("inline-flex flex-col gap-1.5", className)}>
      <div
        role="radiogroup"
        aria-label="Resource visibility"
        aria-disabled={effectivelyDisabled || undefined}
        className={cn(
          "inline-flex rounded-md bg-muted p-0.5",
          effectivelyDisabled && "pointer-events-none opacity-50",
        )}
      >
        {OPTIONS.map((option, index) => {
          const isSelected = visibility === option.value;
          const isPublicOption =
            option.value === ApiResourceVisibility.visibility_public;

          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={effectivelyDisabled}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected && isPublicOption
                  ? "bg-emerald-100 text-emerald-800 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-300"
                  : isSelected
                    ? "bg-amber-50 text-amber-800 shadow-sm dark:bg-amber-900/30 dark:text-amber-300"
                    : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isPending && isSelected ? (
                <span
                  className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              ) : isPublicOption ? (
                <GlobeIcon className="size-3" />
              ) : (
                <LockIcon className="size-3" />
              )}
              {option.label}
            </button>
          );
        })}
      </div>

      {confirming && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs",
            "dark:border-amber-800/50 dark:bg-amber-950/30",
          )}
          role="alert"
        >
          <span className="text-amber-800 dark:text-amber-200">
            Make visible to all users?
          </span>
          <button
            type="button"
            onClick={confirmPublic}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              "bg-amber-600 text-white hover:bg-amber-700",
              "dark:bg-amber-600 dark:hover:bg-amber-500",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              "text-amber-700 hover:text-amber-900",
              "dark:text-amber-300 dark:hover:text-amber-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function GlobeIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.66 1.46 2.6 3.63 2.6 6s-.94 4.54-2.6 6c-1.66-1.46-2.6-3.63-2.6-6s.94-4.54 2.6-6Z" />
    </svg>
  );
}
