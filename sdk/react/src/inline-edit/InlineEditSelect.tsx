"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps, SelectOption } from "./types.js";

/** Props for {@link InlineEditSelect}. */
export interface InlineEditSelectProps extends InlineEditBaseProps {
  /** Current selected value. */
  readonly value: string;
  /** Available options. */
  readonly options: readonly SelectOption[];
  /** Called when the user selects a new option. */
  readonly onSave: (newValue: string) => Promise<boolean>;
}

/**
 * Click-to-edit single-choice selector.
 *
 * In read mode, shows the current option label. On click, opens a radio
 * group with all options. Selection triggers immediate save.
 */
export function InlineEditSelect({
  value,
  options,
  onSave,
  disabled,
  isSaving,
  error,
  className,
}: InlineEditSelectProps) {
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!isEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditing(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing]);

  const handleSelect = useCallback(
    async (newValue: string) => {
      if (newValue === value) {
        setIsEditing(false);
        return;
      }
      const ok = await onSave(newValue);
      if (ok) setIsEditing(false);
    },
    [value, onSave],
  );

  if (disabled || !isEditing) {
    return (
      <div className={cn("group/inline-edit", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors",
            !disabled && "hover:bg-accent-hover cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
            {currentLabel}
          </span>
          {!disabled && (
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline-edit:opacity-100" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-1", className)}>
      <div className="rounded-lg border border-border bg-background p-1" role="radiogroup">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={isSaving}
            onClick={() => handleSelect(option.value)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
              option.value === value
                ? "bg-muted-subtle text-foreground"
                : "hover:bg-accent-hover text-foreground",
              "disabled:opacity-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            <div className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
              option.value === value
                ? "border-primary bg-primary"
                : "border-muted-foreground",
            )}>
              {option.value === value && (
                <div className="size-1.5 rounded-full bg-primary-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">{option.label}</span>
              {option.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
              )}
            </div>
            {isSaving && option.value !== value && (
              <Spinner />
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="px-1 text-xs text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronDownIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
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
