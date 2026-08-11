"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps } from "./types.js";

/** Props for {@link InlineEditImage}. */
export interface InlineEditImageProps extends InlineEditBaseProps {
  /** Current icon/image URL (empty string = no icon). */
  readonly value: string;
  /** Called with the new URL when the user confirms. */
  readonly onSave: (newValue: string) => Promise<boolean>;
  /** Fallback element when there is no image URL. */
  readonly fallback?: React.ReactNode;
  /** Size of the avatar. @default "md" */
  readonly size?: "sm" | "md";
}

/**
 * Click-to-edit image URL field, displayed as an avatar.
 *
 * Shows the current image (or fallback icon). On click, reveals
 * an input for entering a new image URL with confirm/cancel.
 */
export function InlineEditImage({
  value,
  onSave,
  fallback,
  size = "md",
  disabled,
  isSaving,
  error,
  className,
}: InlineEditImageProps) {
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
    if (trimmed && !isValidUrl(trimmed)) {
      setLocalError("Enter a valid URL");
      return;
    }
    const ok = await onSave(trimmed);
    if (ok) setIsEditing(false);
  }, [draft, value, onSave]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft(value);
    setLocalError(null);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
      else if (e.key === "Escape") handleCancel();
    },
    [handleConfirm, handleCancel],
  );

  const sizeClasses = size === "sm" ? "stg:size-6" : "stg:size-8";
  const displayError = localError || error;

  if (disabled || !isEditing) {
    return (
      <div className={cn("stg:group/inline-edit stg:inline-flex", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "stg:relative stg:rounded-md stg:p-0.5 stg:transition-colors",
            !disabled && "stg:hover:bg-accent-hover stg:cursor-pointer",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
          aria-label="Change icon"
        >
          {value ? (
            <img
              src={value}
              alt=""
              className={cn(sizeClasses, "stg:shrink-0 stg:rounded stg:object-cover")}
            />
          ) : (
            fallback ?? <ImagePlaceholder className={cn(sizeClasses, "stg:text-muted-foreground")} />
          )}
          {!disabled && (
            <span className="stg:absolute stg:-bottom-0.5 stg:-right-0.5 stg:flex stg:size-4 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-muted-foreground stg:opacity-0 stg:transition-opacity stg:group-hover/inline-edit:opacity-100">
              <PencilIcon className="stg:size-2.5" />
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-1", className)}>
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <input
          ref={inputRef}
          type="url"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setLocalError(null); }}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          placeholder="https://example.com/icon.png"
          className={cn(
            "stg:flex-1 stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1 stg:text-sm stg:text-foreground",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            "stg:disabled:opacity-50",
            displayError && "stg:border-destructive",
          )}
        />
        <button type="button" onClick={handleConfirm} disabled={isSaving} aria-label="Save"
          className={cn(
            "stg:inline-flex stg:size-7 stg:items-center stg:justify-center stg:rounded-md",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}>
          {isSaving ? <Spinner /> : <CheckIcon className="stg:size-3.5" />}
        </button>
        <button type="button" onClick={handleCancel} disabled={isSaving} aria-label="Cancel"
          className={cn(
            "stg:inline-flex stg:size-7 stg:items-center stg:justify-center stg:rounded-md",
            "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}>
          <XIcon className="stg:size-3.5" />
        </button>
        {draft && (
          <button type="button" onClick={() => setDraft("")} disabled={isSaving} aria-label="Clear"
            className="stg:text-xs stg:text-muted-foreground stg:underline stg:decoration-muted-foreground/40 stg:underline-offset-2 stg:hover:text-foreground">
            Clear
          </button>
        )}
      </div>
      {displayError && (
        <p className="stg:px-1 stg:text-xs stg:text-destructive" role="alert">{displayError}</p>
      )}
    </div>
  );
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
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

function ImagePlaceholder({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <circle cx="5.5" cy="5.5" r="1" />
      <path d="m14 10.5-3-3L4 14" />
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
