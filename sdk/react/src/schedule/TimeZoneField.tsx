"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link TimeZoneField}. */
export interface TimeZoneFieldProps {
  /** Element ID, for association with an external `<label htmlFor>`. */
  readonly id?: string;
  /** The selected IANA time zone name. */
  readonly value: string;
  /** Called with the new zone when the user picks one. */
  readonly onChange: (timeZone: string) => void;
  /** Prevents interaction when `true`. */
  readonly disabled?: boolean;
}

const LIST_ID = "stgm-timezone-list";
const MAX_VISIBLE = 100;

/**
 * Searchable IANA time zone selector for the schedule form.
 *
 * The IANA database has ~400 zones — far too many for a plain
 * `<select>` — so this follows the SDK's searchable-picker idiom
 * (search input + listbox, as in `AgentPicker`): the input shows the
 * selected zone; typing filters the list; Enter or click selects.
 *
 * The zone list comes from the runtime's own tz database
 * (`Intl.supportedValuesOf`), which is also what {@link validateTimeZone}
 * checks against — the offered choices and the accepted choices cannot
 * drift.
 *
 * Internal to the schedule folder by design: public API surface is a
 * contract, and this earns a barrel export only when a second consumer
 * appears.
 */
export function TimeZoneField({
  id,
  value,
  onChange,
  disabled,
}: TimeZoneFieldProps) {
  const zones = useMemo(() => allTimeZones(), []);

  const [query, setQuery] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = query !== null;

  const filtered = useMemo(() => {
    if (query === null) return [];
    const needle = query.trim().toLowerCase().replace(/\s+/g, "_");
    const matches = needle
      ? zones.filter((z) => z.toLowerCase().includes(needle))
      : zones;
    return matches.slice(0, MAX_VISIBLE);
  }, [zones, query]);

  const close = useCallback(() => {
    setQuery(null);
    setFocusIndex(-1);
  }, []);

  const select = useCallback(
    (zone: string) => {
      onChange(zone);
      close();
    },
    [onChange, close],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (!isOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (focusIndex >= 0 && focusIndex < filtered.length) {
          select(filtered[focusIndex]);
        } else if (filtered.length === 1) {
          select(filtered[0]);
        }
      }
    },
    [isOpen, filtered, focusIndex, select, close],
  );

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={LIST_ID}
        aria-activedescendant={
          focusIndex >= 0 ? `stgm-timezone-${focusIndex}` : undefined
        }
        aria-label="Time zone"
        placeholder="Search time zones…"
        value={query ?? value}
        onChange={(e) => {
          setQuery(e.target.value);
          setFocusIndex(-1);
        }}
        onFocus={() => setQuery("")}
        // Closing on blur reverts the input to the committed value —
        // free-typed text is never submitted, only list selections.
        onBlur={close}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />

      {isOpen && (
        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Time zones"
          className={cn(
            "absolute z-popover mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border",
            "bg-popover p-1 text-popover-foreground shadow-md",
          )}
        >
          {filtered.length === 0 ? (
            <div className="py-3 text-center text-xs text-muted-foreground">
              No time zones match
            </div>
          ) : (
            filtered.map((zone, idx) => (
              <button
                key={zone}
                id={`stgm-timezone-${idx}`}
                type="button"
                role="option"
                aria-selected={zone === value}
                // Runs before the input's blur, so selection wins over
                // the close-on-blur revert.
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(zone);
                }}
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
                  idx === focusIndex
                    ? "bg-accent text-foreground"
                    : "text-popover-foreground hover:bg-accent-hover",
                  zone === value && "font-medium",
                )}
              >
                {zone}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function allTimeZones(): readonly string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    // Pre-2022 runtimes without supportedValuesOf: offer the browser's
    // own zone plus UTC rather than an empty list.
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return own && own !== "UTC" ? [own, "UTC"] : ["UTC"];
  }
}

/** The browser's own IANA time zone — the form's default. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
