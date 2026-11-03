"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/design-tokens";

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
 * Searchable IANA time zone selector for the routine form.
 *
 * The IANA database has ~400 zones — far too many for a plain
 * `<select>` — so this follows the SDK's searchable-picker idiom
 * (search input + listbox, as in `AgentPicker`): the input shows the
 * selected zone; typing filters the list; Enter or click selects.
 *
 * The zone list comes from the runtime's own tz database
 * (`Intl.supportedValuesOf`), which is also what {@link validateTimeZone}
 * checks against — the offered choices and the accepted choices cannot
 * drift. Each zone is offered by its current IANA name
 * ({@link currentTimeZoneName}), and a search finds it by its old one too.
 *
 * Internal to the routine folder by design: public API surface is a
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
      ? zones.filter((z) =>
          [z, FORMER_NAME[z] ?? ""].some((name) => name.toLowerCase().includes(needle)),
        )
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
    <div className="stg:relative">
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
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:placeholder:text-muted-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      />

      {isOpen && (
        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Time zones"
          className={cn(
            "stg:absolute stg:z-popover stg:mt-1 stg:max-h-52 stg:w-full stg:overflow-y-auto stg:rounded-md stg:border stg:border-border",
            "stg:bg-popover stg:p-1 stg:text-popover-foreground stg:shadow-md",
          )}
        >
          {filtered.length === 0 ? (
            <div className="stg:py-3 stg:text-center stg:text-xs stg:text-muted-foreground">
              No time zones match
            </div>
          ) : (
            filtered.map((zone, idx) => (
              <button
                key={zone}
                id={`stgm-timezone-${idx}`}
                type="button"
                role="option"
                aria-selected={zone === currentTimeZoneName(value)}
                // Runs before the input's blur, so selection wins over
                // the close-on-blur revert.
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(zone);
                }}
                className={cn(
                  "stg:flex stg:w-full stg:items-center stg:rounded-sm stg:px-2 stg:py-1.5 stg:text-left stg:text-xs stg:transition-colors",
                  idx === focusIndex
                    ? "stg:bg-accent stg:text-foreground"
                    : "stg:text-popover-foreground stg:hover:bg-accent-hover",
                  zone === currentTimeZoneName(value) && "stg:font-medium",
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

/**
 * The zones IANA renamed whose old names the runtime's tz database still
 * returns, each to its current name. Chromium's ICU follows CLDR, which keeps
 * a renamed zone's first id: Chromium 148 offers `Asia/Calcutta` and no
 * `Asia/Kolkata`, so a person searching for Kolkata found nothing, though the
 * runtime, the server and the docs all accept and print the current name
 * (stigmer#2888). Measured: each old name below is in Chromium 148's and
 * Node 22's lists, and none of the current ones is.
 */
const RENAMED_ZONES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** Each renamed zone's current name to its old one, so a search by the old name still finds it. */
const FORMER_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RENAMED_ZONES).map(([former, current]) => [current, former]),
);

/** The current IANA name of `zone`: itself, unless IANA renamed it. */
export function currentTimeZoneName(zone: string): string {
  return RENAMED_ZONES[zone] ?? zone;
}

/** Every zone the runtime knows, by its current name, sorted, each once. */
export function allTimeZones(): readonly string[] {
  try {
    return [...new Set(Intl.supportedValuesOf("timeZone").map(currentTimeZoneName))].sort();
  } catch {
    // Pre-2022 runtimes without supportedValuesOf: offer the browser's
    // own zone plus UTC rather than an empty list.
    const own = browserTimeZone();
    return own !== "UTC" ? [own, "UTC"] : ["UTC"];
  }
}

/** The browser's own IANA time zone, by its current name — the form's default. */
export function browserTimeZone(): string {
  return currentTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
}
