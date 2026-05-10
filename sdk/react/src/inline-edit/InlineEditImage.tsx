"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps } from "./types";

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

  const sizeClasses = size === "sm" ? "size-6" : "size-8";
  const displayError = localError || error;

  if (disabled || !isEditing) {
    return (
      <div className={cn("group/inline-edit inline-flex", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "relative rounded-md p-0.5 transition-colors",
            !disabled && "hover:bg-accent-hover cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Change icon"
        >
          {value ? (
            <img
              src={value}
              alt=""
              className={cn(sizeClasses, "shrink-0 rounded object-cover")}
            />
          ) : (
            fallback ?? <ImagePlaceholder className={cn(sizeClasses, "text-muted-foreground")} />
          )}
          {!disabled && (
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-100">
              <PencilIcon className="size-2.5" />
            </span>
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
          type="url"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setLocalError(null); }}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          placeholder="https://example.com/icon.png"
          className={cn(
            "flex-1 rounded-md border border-border bg-input-bg px-2 py-1 text-sm text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "disabled:opacity-50",
            displayError && "border-destructive",
          )}
        />
        <button type="button" onClick={handleConfirm} disabled={isSaving} aria-label="Save"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}>
          {isSaving ? <Spinner /> : <CheckIcon className="size-3.5" />}
        </button>
        <button type="button" onClick={handleCancel} disabled={isSaving} aria-label="Cancel"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md",
            "border border-border bg-background text-foreground hover:bg-accent disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}>
          <XIcon className="size-3.5" />
        </button>
        {draft && (
          <button type="button" onClick={() => setDraft("")} disabled={isSaving} aria-label="Clear"
            className="text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground">
            Clear
          </button>
        )}
      </div>
      {displayError && (
        <p className="px-1 text-xs text-destructive" role="alert">{displayError}</p>
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
