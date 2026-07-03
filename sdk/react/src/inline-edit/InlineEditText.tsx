"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps } from "./types.js";

/** Props for {@link InlineEditText}. */
export interface InlineEditTextProps extends InlineEditBaseProps {
  /** Current field value. */
  readonly value: string;
  /** Called with the new value when the user confirms the edit. */
  readonly onSave: (newValue: string) => Promise<boolean>;
  /** Placeholder shown when value is empty (in both read and edit mode). */
  readonly placeholder?: string;
  /** Optional client-side validation. Return an error string to block save. */
  readonly validate?: (value: string) => string | null;
  /** Render as heading text (larger, bolder). */
  readonly variant?: "default" | "heading";
}

/**
 * Click-to-edit single-line text field.
 *
 * Displays the value as styled text. On click, transitions to an input
 * with inline confirm/cancel controls. Confirm triggers `onSave`;
 * cancel reverts. Escape key also cancels.
 */
export function InlineEditText({
  value,
  onSave,
  placeholder = "Click to edit",
  validate,
  variant = "default",
  disabled,
  isSaving,
  error,
  className,
}: InlineEditTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(value);
      setLocalError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isEditing, value]);

  const handleConfirm = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setIsEditing(false);
      return;
    }
    if (validate) {
      const err = validate(trimmed);
      if (err) {
        setLocalError(err);
        return;
      }
    }
    const ok = await onSave(trimmed);
    if (ok) setIsEditing(false);
  }, [draft, value, validate, onSave]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft(value);
    setLocalError(null);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleConfirm, handleCancel],
  );

  const displayError = localError || error;

  if (disabled || !isEditing) {
    return (
      <div className={cn("group/inline-edit", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors",
            !disabled && "hover:bg-accent-hover cursor-pointer",
            disabled && "cursor-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              variant === "heading"
                ? "text-lg font-semibold text-foreground"
                : "text-sm text-foreground",
              !value && "text-muted-foreground italic",
            )}
          >
            {value || placeholder}
          </span>
          {!disabled && (
            <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-100" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setLocalError(null); }}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          placeholder={placeholder}
          className={cn(
            "flex-1 rounded-md border border-border bg-input-bg px-2 py-1 text-sm text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:opacity-50",
            variant === "heading" && "text-lg font-semibold",
            displayError && "border-destructive",
          )}
        />
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSaving}
          aria-label="Save"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {isSaving ? <Spinner /> : <CheckIcon className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          aria-label="Cancel"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
            "disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {displayError && (
        <p className="px-1 text-xs text-destructive" role="alert">{displayError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4Z" />
    </svg>
  );
}

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 8.5 3.5 3.5 6.5-8" />
    </svg>
  );
}

function XIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
