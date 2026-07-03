"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps } from "./types.js";

/** Props for {@link InlineEditTextarea}. */
export interface InlineEditTextareaProps extends InlineEditBaseProps {
  /** Current field value. */
  readonly value: string;
  /** Called with the new value when the user confirms. */
  readonly onSave: (newValue: string) => Promise<boolean>;
  /** Placeholder shown when value is empty. */
  readonly placeholder?: string;
  /** Optional client-side validation. */
  readonly validate?: (value: string) => string | null;
  /** Minimum rows for the textarea. @default 3 */
  readonly minRows?: number;
}

/**
 * Click-to-edit multiline text field.
 *
 * In read mode, renders the value as preformatted text with expand/collapse.
 * On click, opens a textarea with confirm/cancel. Ctrl+Enter confirms.
 */
export function InlineEditTextarea({
  value,
  onSave,
  placeholder = "Click to edit",
  validate,
  minRows = 3,
  disabled,
  isSaving,
  error,
  className,
}: InlineEditTextareaProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(value);
      setLocalError(null);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.value.length;
        }
      });
    }
  }, [isEditing, value]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [draft, isEditing]);

  const handleConfirm = useCallback(async () => {
    if (draft === value) {
      setIsEditing(false);
      return;
    }
    if (validate) {
      const err = validate(draft);
      if (err) {
        setLocalError(err);
        return;
      }
    }
    const ok = await onSave(draft);
    if (ok) setIsEditing(false);
  }, [draft, value, validate, onSave]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft(value);
    setLocalError(null);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
            "w-full rounded-md px-2 py-1.5 text-left transition-colors",
            !disabled && "hover:bg-accent-hover cursor-pointer",
            disabled && "cursor-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <pre
              className={cn(
                "min-w-0 whitespace-pre-wrap break-words font-mono text-sm text-foreground",
                !value && "text-muted-foreground italic font-sans",
              )}
            >
              {value || placeholder}
            </pre>
            {!disabled && (
              <PencilIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-100" />
            )}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setLocalError(null); }}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        placeholder={placeholder}
        rows={minRows}
        className={cn(
          "w-full resize-y rounded-md border border-border bg-input-bg px-3 py-2 font-mono text-sm text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:opacity-50",
          displayError && "border-destructive",
        )}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {isSaving ? "Saving..." : "Ctrl+Enter to save, Escape to cancel"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium",
              "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
              "disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {isSaving && <Spinner />}
            Save
          </button>
        </div>
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

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
