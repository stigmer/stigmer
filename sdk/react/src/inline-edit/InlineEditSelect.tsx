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
      <div className={cn("stg:group/inline-edit", className)}>
        <button
          type="button"
          onClick={() => { if (!disabled) setIsEditing(true); }}
          disabled={disabled}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-1.5 stg:py-0.5 stg:text-left stg:transition-colors",
            !disabled && "stg:hover:bg-accent-hover stg:cursor-pointer",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
          )}
        >
          <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
            {currentLabel}
          </span>
          {!disabled && (
            <ChevronDownIcon className="stg:size-3 stg:shrink-0 stg:text-muted-foreground stg:opacity-0 stg:transition-opacity stg:group-hover/inline-edit:opacity-100" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("stg:flex stg:flex-col stg:gap-1", className)}>
      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-background stg:p-1" role="radiogroup">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={isSaving}
            onClick={() => handleSelect(option.value)}
            className={cn(
              "stg:flex stg:w-full stg:items-start stg:gap-2 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-left stg:transition-colors",
              option.value === value
                ? "stg:bg-muted-subtle stg:text-foreground"
                : "stg:hover:bg-accent-hover stg:text-foreground",
              "stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
            )}
          >
            <div className={cn(
              "stg:mt-0.5 stg:flex stg:size-4 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:border",
              option.value === value
                ? "stg:border-primary stg:bg-primary"
                : "stg:border-muted-foreground",
            )}>
              {option.value === value && (
                <div className="stg:size-1.5 stg:rounded-full stg:bg-primary-foreground" />
              )}
            </div>
            <div className="stg:min-w-0 stg:flex-1">
              <span className="stg:text-sm stg:font-medium">{option.label}</span>
              {option.description && (
                <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">{option.description}</p>
              )}
            </div>
            {isSaving && option.value !== value && (
              <Spinner />
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="stg:px-1 stg:text-xs stg:text-destructive" role="alert">{error}</p>
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="stg:animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
