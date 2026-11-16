"use client";

// One choice among a few, drawn one of two ways: `segmented`, a row of
// choices on a muted 32px track (28px at `xs`) for short words (Hourly,
// Daily, Weekly; Rendered, Source), or `list`, a framed list of radio rows
// with a line under each name for choices that need saying (Any website,
// Listed websites only). Either is one radiogroup: Tab reaches the chosen
// one, the arrow keys move the choice and wrap, Home and End go to the ends,
// a disabled choice is skipped.

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import type { FieldSize } from "./fieldClasses.js";

/** One choice: its value, its words, an optional line under it (list), and whether it can be chosen. */
export interface ChoiceOption<T extends string | number> {
  readonly value: T;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** Its accessible name when `label` is an icon alone. */
  readonly "aria-label"?: string;
}

/** Props for {@link ChoiceGroup}. */
export interface ChoiceGroupProps<T extends string | number> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly ChoiceOption<T>[];
  /** `segmented` (a row on a track, the default) or `list` (radio rows with their lines). */
  readonly variant?: "segmented" | "list";
  /** The segmented row's size: `sm` 32px at 14/20, `xs` 28px at 12/16. */
  readonly size?: FieldSize;
  readonly disabled?: boolean;
  /** The group's name, unless `aria-labelledby` points at a visible one. */
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
  readonly className?: string;
}

/** A choice of one among a few, as a segmented row or a list of radio rows. */
export function ChoiceGroup<T extends string | number>({
  value,
  onChange,
  options,
  variant = "segmented",
  size = "sm",
  disabled,
  className,
  ...aria
}: ChoiceGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled || disabled ? -1 : i)).filter((i) => i >= 0);
  const chosen = options.findIndex((o) => o.value === value);
  // Tab lands on the chosen choice, or the first that can be chosen.
  const tabStop = chosen >= 0 && !options[chosen].disabled ? chosen : (enabled[0] ?? -1);

  function move(e: KeyboardEvent<HTMLButtonElement>, from: number) {
    const at = enabled.indexOf(from);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  if (variant === "list") {
    return (
      <div
        role="radiogroup"
        {...aria}
        className={cn("stg:flex stg:flex-col stg:overflow-hidden stg:rounded-xl stg:border stg:border-border stg:bg-card", className)}
      >
        {options.map((o, i) => {
          const on = o.value === value;
          const off = o.disabled || disabled;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o["aria-label"]}
              disabled={off}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => move(e, i)}
              className={cn(
                "stg:flex stg:w-full stg:items-start stg:gap-3 stg:px-3.5 stg:py-2.5 stg:text-left",
                "stg:border-t stg:border-border-muted stg:first:border-t-0",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
                "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
                on && "stg:bg-faint",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "stg:mt-0.5 stg:grid stg:size-4 stg:shrink-0 stg:place-items-center stg:rounded-full stg:border stg:bg-input-bg",
                  on ? "stg:border-primary" : "stg:border-border-strong",
                )}
              >
                {on && <span className="stg:size-2 stg:rounded-full stg:bg-primary" />}
              </span>
              <span className="stg:flex stg:min-w-0 stg:flex-col">
                <span className="stg:text-sm stg:font-medium stg:text-foreground">{o.label}</span>
                {o.description !== undefined && <span className="stg:text-xs stg:text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      {...aria}
      className={cn(
        "stg:inline-flex stg:max-w-full stg:gap-0.5 stg:overflow-x-auto stg:rounded-lg stg:border stg:border-input stg:bg-muted stg:p-px",
        className,
      )}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o["aria-label"]}
            disabled={o.disabled || disabled}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:font-medium stg:whitespace-nowrap stg:transition-colors stg:motion-reduce:transition-none",
              size === "xs" ? "stg:h-6 stg:px-2 stg:text-xs" : "stg:h-7 stg:px-2.5 stg:text-sm",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
              on ? "stg:bg-card stg:text-foreground stg:shadow-sm" : "stg:text-muted-foreground stg:hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
