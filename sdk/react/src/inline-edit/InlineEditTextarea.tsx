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
      <div className={cn("stg:group/inline-edit", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "stg:w-full stg:rounded-md stg:px-2 stg:py-1.5 stg:text-left stg:transition-colors",
            !disabled && "stg:hover:bg-accent-hover stg:cursor-pointer",
            disabled && "stg:cursor-default",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
          )}
        >
          <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
            <pre
              className={cn(
                "stg:min-w-0 stg:whitespace-pre-wrap stg:break-words stg:font-mono stg:text-sm stg:text-foreground",
                !value && "stg:text-muted-foreground stg:italic stg:font-sans",
              )}
            >
              {value || placeholder}
            </pre>
            {!disabled && (
              <PencilIcon className="stg:mt-0.5 stg:size-3 stg:shrink-0 stg:text-muted-foreground stg:opacity-0 stg:transition-opacity stg:group-hover/inline-edit:opacity-100" />
            )}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-1.5", className)}>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setLocalError(null); }}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        placeholder={placeholder}
        rows={minRows}
        className={cn(
          "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-3 stg:py-2 stg:font-mono stg:text-sm stg:text-foreground",
          "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
          "stg:disabled:opacity-50",
          displayError && "stg:border-destructive",
        )}
      />
      <div className="stg:flex stg:items-center stg:justify-between">
        <span className="stg:text-[10px] stg:text-muted-foreground">
          {isSaving ? "Saving..." : "Ctrl+Enter to save, Escape to cancel"}
        </span>
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            {isSaving && <Spinner />}
            Save
          </button>
        </div>
      </div>
      {displayError && (
        <p className="stg:px-1 stg:text-xs stg:text-destructive" role="alert">{displayError}</p>
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="stg:animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
